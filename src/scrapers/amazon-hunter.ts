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
   * Converte string de preço (ex: "R$ 1.299,90" ou "129,99") para número float
   */
  private static parsePrice(priceStr: string): number | null {
    if (!priceStr) return null;
    const clean = priceStr
      .replace(/R\$\s*/gi, '')
      .replace(/\s+/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const val = parseFloat(clean);
    return isNaN(val) ? null : val;
  }

  /**
   * Busca ofertas e produtos em destaque na Amazon Brasil
   */
  static async huntDeals(categoryKey?: string): Promise<Deal[]> {
    const deals: Deal[] = [];
    const url = 'https://www.amazon.com.br/bestsellers';

    try {
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);

      const items = $('.zg-grid-general-faceout, .p13n-sc-uncoverable-faceout, #gridItemRoot, [data-asin]');

      items.each((_, el) => {
        try {
          const item = $(el);
          const asin = item.attr('data-asin') || item.find('[data-asin]').attr('data-asin');
          const title = item.find('.p13n-sc-truncate-desktop-type2, ._cDEzb_p13n-sc-css-line-clamp-1_1Fn1y, ._cDEzb_p13n-sc-css-line-clamp-2_EW2cb, a.a-link-normal span').first().text().trim();
          const img = item.find('img').attr('src') || '';
          const priceRaw = item.find('._cDEzb_p13n-sc-price_3mJ9Z, .a-price .a-offscreen, .p13n-sc-price').first().text().trim();
          const price = this.parsePrice(priceRaw);

          let link = item.find('a.a-link-normal').first().attr('href') || '';
          if (link && !link.startsWith('http')) {
            link = `https://www.amazon.com.br${link}`;
          }

          if (title && price && price > 0 && link) {
            const id = asin ? `amz_${asin}` : `amz_${crypto.createHash('md5').update(title).digest('hex').substring(0, 10)}`;
            deals.push({
              id,
              store: 'amazon',
              category: categoryKey || 'geral',
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
    } catch (err: any) {
      console.warn('[Amazon Hunter] Falha ao buscar lista:', err.message);
    }

    return deals;
  }
}
