import * as cheerio from 'cheerio';
import crypto from 'crypto';
import axios from 'axios';
import { Deal } from '../types/deal.js';
import { fetchHtml, getRandomUserAgent } from './base-scraper.js';
import { LinkConverter } from '../generator/link-converter.js';

export class AmazonHunter {
  /**
   * Resolve redirecionamento se for link encurtado (ex: amzn.to/xxx ou a.co/xxx)
   */
  static async resolveShortUrl(url: string): Promise<string> {
    if (url.includes('amzn.to') || url.includes('a.co')) {
      try {
        const res = await axios.get(url, {
          maxRedirects: 5,
          timeout: 8000,
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        return res.request?.res?.responseUrl || url;
      } catch (err: any) {
        if (err.response?.headers?.location) {
          return err.response.headers.location;
        }
        return url;
      }
    }
    return url;
  }

  /**
   * Extrai o ASIN (Amazon Standard Identification Number - 10 caracteres)
   */
  static extractAsin(url: string): string | null {
    const match = url.match(/(?:\/dp\/|\/gp\/product\/|\/product\/|\/d\/)([A-Z0-9]{10})/i);
    return match ? match[1].toUpperCase() : null;
  }

  /**
   * Extrai dados completos de um produto da Amazon Brasil via URL
   */
  static async extractProductFromUrl(productUrl: string): Promise<Deal | null> {
    try {
      const resolvedUrl = await this.resolveShortUrl(productUrl);
      const asin = this.extractAsin(resolvedUrl);

      const html = await fetchHtml(resolvedUrl);
      const $ = cheerio.load(html);

      // 1. Título do Produto
      let title = $('#productTitle').text().trim() ||
                  $('#title').text().trim() ||
                  $('meta[property="og:title"]').attr('content')?.trim() ||
                  $('h1').first().text().trim() || '';

      // Limpar título comum da Amazon (ex: "Amazon.com.br: ...")
      title = title.replace(/^Amazon\.com\.br\s*:\s*/i, '').trim();

      if (!title) {
        console.warn('[Amazon Hunter] ⚠️ Não foi possível encontrar o título do produto em:', resolvedUrl);
        return null;
      }

      // 2. Imagem Principal em Alta Resolução
      let imageUrl = '';
      const landingImg = $('#landingImage, #imgBlkFront');
      if (landingImg.length > 0) {
        const dynamicData = landingImg.attr('data-a-dynamic-image');
        if (dynamicData) {
          try {
            const parsed = JSON.parse(dynamicData);
            const urls = Object.keys(parsed);
            if (urls.length > 0) {
              imageUrl = urls[0]; // Maior imagem
            }
          } catch {}
        }
        if (!imageUrl) {
          imageUrl = landingImg.attr('data-old-hires') || landingImg.attr('src') || '';
        }
      }

      if (!imageUrl) {
        imageUrl = $('meta[property="og:image"]').attr('content') || '';
      }

      // 3. Preço Atual
      let currentPrice = 0;
      const priceSelectors = [
        '#corePriceDisplay_desktop_feature_div .apexPriceToPay .a-offscreen',
        '#corePrice_feature_div .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-offscreen',
        '.apexPriceToPay .a-offscreen',
        '#priceblock_ourprice',
        '#priceblock_dealprice',
        '#price_inside_buybox',
        '.a-price:not(.a-text-price) .a-offscreen'
      ];

      for (const sel of priceSelectors) {
        const el = $(sel).first();
        if (el.length > 0) {
          const raw = el.text().trim();
          const parsed = this.parsePrice(raw);
          if (parsed && parsed > 0) {
            currentPrice = parsed;
            break;
          }
        }
      }

      // 4. Preço Original (De / Riscado)
      let originalPrice: number | undefined;
      const origSelectors = [
        '#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen',
        '.basisPrice .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen',
        '.a-text-price .a-offscreen',
        '.a-text-strike'
      ];

      for (const sel of origSelectors) {
        const el = $(sel).first();
        if (el.length > 0) {
          const parentText = el.closest('.basisPrice, .a-text-price, .a-price').text();
          if (/\/(?:kg|g|l|ml|un|unidade|litro|quilo)/i.test(parentText)) {
            continue;
          }
          const raw = el.text().trim();
          const parsed = this.parsePrice(raw);
          if (parsed && parsed > currentPrice) {
            originalPrice = parsed;
            break;
          }
        }
      }

      // 5. Percentual de Desconto
      let discountPercent: number | undefined;
      const discountEl = $('.savingsPercentage, #corePriceDisplay_desktop_feature_div .savingsPercentage').first();
      if (discountEl.length > 0) {
        const dText = discountEl.text().replace(/[^0-9]/g, '');
        if (dText) discountPercent = parseInt(dText, 10);
      }

      if (!discountPercent && originalPrice && currentPrice && originalPrice > currentPrice) {
        discountPercent = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
      }

      // Sanity check: Se o desconto passar de 80%, muito provavelmente é erro de captura de peso/unidade da Amazon
      if (discountPercent && discountPercent > 80) {
        discountPercent = undefined;
        originalPrice = undefined;
      }

      // 6. Frete Grátis / Prime
      const isPrime = $('#primeSavingsUpperMessage').length > 0 ||
                      $('#prime-badge').length > 0 ||
                      html.includes('Frete GRÁTIS') ||
                      html.includes('com Prime');

      // 7. Cupom de desconto na página (se houver)
      let couponCode: string | undefined;
      const couponEl = $('#couponBadge, label[for*="coupon"], .couponDescription').first();
      if (couponEl.length > 0) {
        const couponText = couponEl.text().trim();
        if (couponText) {
          couponCode = couponText.substring(0, 40);
        }
      }

      // 8. Avaliação
      let rating: number | undefined;
      const ratingText = $('#acrPopover, span[data-hook="rating-out-of-text"]').first().text().trim();
      if (ratingText) {
        const rMatch = ratingText.match(/([0-9],[0-9]|[0-9]\.[0-9])/);
        if (rMatch) rating = parseFloat(rMatch[1].replace(',', '.'));
      }

      // 9. ID e URL Afiliada
      const id = asin ? `amz_${asin}` : `amz_${crypto.createHash('md5').update(title).digest('hex').substring(0, 12)}`;
      const affiliateUrl = LinkConverter.convertAmazon(resolvedUrl);

      return {
        id,
        store: 'amazon',
        title,
        originalPrice,
        currentPrice: currentPrice || 0,
        discountPercent: discountPercent && discountPercent > 0 ? discountPercent : undefined,
        imageUrl,
        originalUrl: resolvedUrl,
        affiliateUrl,
        rating,
        freeShipping: isPrime,
        couponCode
      };
    } catch (err: any) {
      console.error('[Amazon Hunter] Erro ao extrair produto:', err.message);
      return null;
    }
  }

  /**
   * Converte string de preço (ex: "R$ 1.299,90" ou "129,99") para número float.
   * Rejeita valores unitários que possuem /kg, /g, /l, /ml, /un etc.
   */
  private static parsePrice(priceStr: string): number | null {
    if (!priceStr) return null;

    // Se contiver indicador de peso/volume unitário, descarta imediatamente
    if (/\/(?:kg|g|l|ml|un|unidade|litro|quilo|metro)/i.test(priceStr)) {
      return null;
    }

    const clean = priceStr
      .replace(/R\$\s*/gi, '')
      .replace(/\s+/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const val = parseFloat(clean);
    return isNaN(val) ? null : val;
  }

  private static readonly CATEGORY_SEARCH_MAP: Record<string, string[]> = {
    esportes_suplementos: ['creatina', 'whey protein', 'tenis corrida', 'suplementos'],
    eletronicos_tech: ['fone bluetooth', 'smartwatch', 'smartphone', 'echo alexa'],
    casa_cozinha: ['air fryer', 'cafeteira', 'panela eletrica', 'aspirador robo'],
    moda_beleza: ['perfume importado', 'skincare', 'relogio masculino', 'hidratante cerave'],
    games_informatica: ['mouse gamer', 'teclado mecanico', 'ssd nvme', 'headset gamer'],
    geral: ['mais vendidos', 'ofertas do dia']
  };

  /**
   * Busca ofertas e produtos em destaque na Amazon Brasil por categoria, busca ou palavras-chave
   */
  static async huntDeals(
    minDiscount = 10,
    minPrice = 15,
    categoryKey = 'geral',
    customKeywords: string[] = [],
    searchQuery?: string
  ): Promise<Deal[]> {
    const deals: Deal[] = [];
    const targetQueries: string[] = [];

    // Se houver busca direta por termo (ex: "Nike", "Apple", "Creatina")
    if (searchQuery && searchQuery.trim().length > 0) {
      targetQueries.push(searchQuery.trim());
    } else {
      const keywords = customKeywords.length > 0 ? customKeywords : (this.CATEGORY_SEARCH_MAP[categoryKey] || ['ofertas']);
      targetQueries.push(...keywords.slice(0, 2));
    }

    for (const q of targetQueries) {
      try {
        const searchUrl = `https://www.amazon.com.br/s?k=${encodeURIComponent(q)}`;
        const html = await fetchHtml(searchUrl);
        if (!html) continue;

        const $ = cheerio.load(html);
        const items = $('[data-asin]');

        items.each((_, el) => {
          try {
            const item = $(el);
            const asin = item.attr('data-asin');
            if (!asin || asin.length !== 10) return;

            // Título completo (combina marca e descrição se divididos em spans)
            let title = '';
            const spans = item.find('h2 span');
            if (spans.length > 1) {
              title = spans.map((_, s) => $(s).text().trim()).get().filter(Boolean).join(' - ');
            } else {
              title = item.find('h2 a span, h2 span, .a-size-base-plus, .a-text-normal').first().text().trim() || item.find('h2').text().trim();
            }
            title = title.replace(/\s+/g, ' ').trim();
            if (!title || title.length < 5) return;

            // Imagem
            const img = item.find('img.s-image').attr('src') || item.find('img').first().attr('src') || '';

            // Preço Atual
            let currentPriceStr = item.find('.a-price:not(.a-text-price) .a-offscreen').first().text().trim();
            if (!currentPriceStr) {
              currentPriceStr = item.find('.a-price .a-offscreen').first().text().trim();
            }
            const currentPrice = this.parsePrice(currentPriceStr);
            if (!currentPrice || currentPrice < minPrice) return;

            // Preço Original Riscado
            let originalPrice: number | undefined;
            const origEl = item.find('.a-text-price:not([data-a-size="mini"]):not(:has(.a-size-mini)) .a-offscreen, .a-price.a-text-price .a-offscreen').first();
            
            // Verifica se o texto pai do elemento original não contém unidade de medida
            const origParentText = origEl.closest('.a-text-price, .a-price').text();
            if (!/\/(?:kg|g|l|ml|un|unidade|litro|quilo)/i.test(origParentText)) {
              const origPriceStr = origEl.text().trim();
              const parsedOrig = this.parsePrice(origPriceStr);
              if (parsedOrig && parsedOrig > currentPrice) {
                originalPrice = parsedOrig;
              }
            }

            let discountPercent: number | undefined;
            if (originalPrice && originalPrice > currentPrice) {
              const calcDiscount = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
              // Sanity check: Se o desconto for absurdo (> 80%), muito provavelmente é bug de extração de peso/unidade da Amazon
              if (calcDiscount <= 80) {
                discountPercent = calcDiscount;
              } else {
                // Descarta o preço original falso
                originalPrice = undefined;
              }
            }

            // Link Limpo com ASIN
            let link = `https://www.amazon.com.br/dp/${asin}`;
            const rawHref = item.find('h2 a.a-link-normal').attr('href') || item.find('a.a-link-normal').first().attr('href') || '';
            if (rawHref && rawHref.includes('/sspa/click')) {
              link = rawHref.startsWith('http') ? rawHref : `https://www.amazon.com.br${rawHref}`;
            } else if (rawHref) {
              link = rawHref.startsWith('http') ? rawHref : `https://www.amazon.com.br${rawHref}`;
            }

            const hasPrime = item.find('i.a-icon-prime, span:contains("Prime"), span:contains("GRÁTIS")').length > 0;

            deals.push({
              id: `amz_${asin}`,
              store: 'amazon',
              category: categoryKey,
              title,
              originalPrice: originalPrice && originalPrice > currentPrice ? originalPrice : undefined,
              currentPrice,
              discountPercent,
              imageUrl: img,
              originalUrl: link,
              affiliateUrl: LinkConverter.convertAmazon(link),
              freeShipping: hasPrime
            });
          } catch {}
        });

        if (deals.length >= 15) break;
      } catch (err: any) {
        console.warn(`[Amazon Hunter] Falha ao buscar "${q}":`, err.message);
      }
    }

    // Se a busca por termos não retornou nada, tenta bestsellers
    if (deals.length === 0) {
      try {
        const html = await fetchHtml('https://www.amazon.com.br/bestsellers');
        if (html) {
          const $ = cheerio.load(html);
          const items = $('.zg-grid-general-faceout, .p13n-sc-uncoverable-faceout, #gridItemRoot, [data-asin]');

          items.each((_, el) => {
            try {
              const item = $(el);
              const asin = item.attr('data-asin') || item.find('[data-asin]').attr('data-asin');
              const title = item.find('.p13n-sc-truncate-desktop-type2, ._cDEzb_p13n-sc-css-line-clamp-1_1Fn1y, a.a-link-normal span').first().text().trim();
              const img = item.find('img').attr('src') || '';
              const priceRaw = item.find('._cDEzb_p13n-sc-price_3mJ9Z, .a-price .a-offscreen, .p13n-sc-price').first().text().trim();
              const price = this.parsePrice(priceRaw);

              let link = item.find('a.a-link-normal').first().attr('href') || '';
              if (link && !link.startsWith('http')) {
                link = `https://www.amazon.com.br${link}`;
              }

              if (title && price && price >= minPrice && link) {
                const id = asin ? `amz_${asin}` : `amz_${crypto.createHash('md5').update(title).digest('hex').substring(0, 10)}`;
                deals.push({
                  id,
                  store: 'amazon',
                  category: categoryKey,
                  title,
                  currentPrice: price,
                  imageUrl: img,
                  originalUrl: link,
                  affiliateUrl: LinkConverter.convertAmazon(link),
                  freeShipping: true
                });
              }
            } catch {}
          });
        }
      } catch {}
    }

    return deals;
  }
}
