import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { Deal } from '../types/deal.js';
import { fetchHtml, cleanPrice } from './base-scraper.js';
import { LinkConverter } from '../generator/link-converter.js';
import { CATEGORY_PRESETS } from '../config/categories.js';

export class MercadoLivreHunter {
  /**
   * Extrai com precisão o valor numérico de um elemento de preço andes-money-amount (lendo aria-label, fração e centavos)
   */
  static extractPriceFromElement($: cheerio.CheerioAPI, elem: cheerio.Cheerio<any>): number | undefined {
    if (!elem || elem.length === 0) return undefined;

    // 1. Tenta extrair pelo aria-label (ex: "Antes: 239 reais com 90 centavos" ou "58 reais com 90 centavos")
    const ariaLabel = elem.attr('aria-label') || '';
    if (ariaLabel) {
      const reaisMatch = ariaLabel.match(/(\d+)\s*reais/i);
      const centavosMatch = ariaLabel.match(/(\d+)\s*centavos/i);
      if (reaisMatch) {
        const reais = reaisMatch[1];
        const centavos = centavosMatch ? centavosMatch[1] : '00';
        return cleanPrice(`${reais}.${centavos}`);
      }
    }

    // 2. Extrai fração + centavos pelos spans filhos
    const fraction = elem.find('.andes-money-amount__fraction').first().text().trim();
    const cents = elem.find('.andes-money-amount__cents').first().text().trim() || '00';
    if (fraction) {
      return cleanPrice(`${fraction}.${cents}`);
    }

    return undefined;
  }

  /**
   * Extrai dados de um produto individual do Mercado Livre via URL
   */
  static async extractProductFromUrl(productUrl: string): Promise<Deal | null> {
    try {
      const mlbMatch = productUrl.match(/MLB-?(\d+)/i);
      const itemId = mlbMatch ? `MLB${mlbMatch[1]}` : null;

      const html = await fetchHtml(productUrl);
      const $ = cheerio.load(html);

      // Tenta ler dados estruturados JSON-LD primeiro (mais confiável)
      let ldJsonData: any = null;
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const parsed = JSON.parse($(el).html() || '{}');
          if (parsed['@type'] === 'Product' || parsed.name) {
            ldJsonData = parsed;
          }
        } catch {}
      });

      // Título
      const title = ldJsonData?.name ||
                    $('h1.ui-pdp-title').text().trim() ||
                    $('meta[property="og:title"]').attr('content')?.replace(/ \| Mercado\s*Livre/i, '').trim() ||
                    $('meta[name="twitter:title"]').attr('content')?.replace(/ \| Mercado\s*Livre/i, '').trim() ||
                    $('title').text().replace(/ \| Mercado\s*Livre/i, '').trim();

      if (!title || title.toLowerCase() === 'mercado libre' || title.toLowerCase() === 'mercado livre') {
        return null;
      }

      // Imagem
      let imageUrl = $('meta[property="og:image:secure_url"]').attr('content') ||
                     $('meta[property="og:image"]').attr('content') ||
                     $('meta[name="twitter:image"]').attr('content') ||
                     $('.ui-pdp-image').first().attr('src') || '';

      if (Array.isArray(imageUrl)) {
        imageUrl = imageUrl[0] || '';
      }

      if (imageUrl && imageUrl.includes('-I.jpg')) {
        imageUrl = imageUrl.replace('-I.jpg', '-O.jpg');
      }

      // Preço original (riscado / antes)
      let originalPrice: number | undefined;
      const originalElem = $('.ui-pdp-price__original-value .andes-money-amount, .andes-money-amount--previous, s.andes-money-amount').first();
      originalPrice = this.extractPriceFromElement($, originalElem);

      // Preço atual promocional (NUNCA pegar o --previous)
      let currentPrice: number | undefined;
      const currentElem = $('.ui-pdp-price__second-line .andes-money-amount, .andes-money-amount--primary, .ui-pdp-price__part:not(.ui-pdp-price__original-value) .andes-money-amount:not(.andes-money-amount--previous), .andes-money-amount:not(.andes-money-amount--previous)').first();
      currentPrice = this.extractPriceFromElement($, currentElem);

      if (!currentPrice && ldJsonData?.offers?.price) {
        currentPrice = Number(ldJsonData.offers.price);
      }

      if (!currentPrice) {
        const priceMeta = $('meta[itemprop="price"]').attr('content') ||
                          $('meta[property="product:price:amount"]').attr('content');
        currentPrice = cleanPrice(priceMeta);
      }

      // Desconto percentual
      let discountPercent: number | undefined;
      const discountText = $('.ui-pdp-price__second-line .andes-money-amount__discount, .andes-money-amount__discount, .ui-pdp-price__discount').first().text().trim();
      if (discountText) {
        const match = discountText.match(/(\d+)%/);
        if (match) discountPercent = parseInt(match[1], 10);
      }

      // Se os preços foram invertidos, corrige colocando o menor em currentPrice
      if (originalPrice && currentPrice && originalPrice < currentPrice) {
        [currentPrice, originalPrice] = [originalPrice, currentPrice];
      }

      // Se não encontrou o preço original mas tem o desconto e preço atual, calcula matematicamente
      if (!originalPrice && currentPrice && discountPercent && discountPercent > 0 && discountPercent < 99) {
        originalPrice = Math.round((currentPrice / (1 - (discountPercent / 100))) * 100) / 100;
      }

      // Se tem os dois preços mas não tem o desconto, calcula a porcentagem
      if (!discountPercent && originalPrice && currentPrice && originalPrice > currentPrice) {
        discountPercent = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
      }

      // Frete grátis
      const freeShipping = $('.ui-pdp-media__title:contains("Frete grátis")').length > 0 ||
                           $('.ui-pdp-color--GREEN:contains("grátis")').length > 0 ||
                           html.includes('Frete grátis');

      // ID único
      const id = itemId ? `ml_${itemId}` : `ml_${crypto.createHash('md5').update(title).digest('hex').substring(0, 12)}`;
      const affiliateUrl = LinkConverter.convertMercadoLivre(productUrl);

      return {
        id,
        store: 'mercadolivre',
        title,
        originalPrice: originalPrice && currentPrice && originalPrice > currentPrice ? originalPrice : undefined,
        currentPrice: currentPrice || 0,
        discountPercent: discountPercent && discountPercent > 0 ? discountPercent : undefined,
        imageUrl,
        originalUrl: productUrl,
        affiliateUrl,
        freeShipping
      };
    } catch (error) {
      console.error(`Erro ao extrair produto do Mercado Livre (${productUrl}):`, error);
      return null;
    }
  }

  /**
   * Caçador automático de Ofertas do Mercado Livre (Geral ou por Categoria/Palavras-chave)
   */
  static async huntDeals(
    minDiscount = 20, 
    minPrice = 15, 
    categoryKey = 'geral', 
    customKeywords: string[] = [],
    searchQuery?: string
  ): Promise<Deal[]> {
    const deals: Deal[] = [];
    const targetUrls: string[] = [];

    // Se houver busca direta por marca/termo (ex: "Fila", "Nike", "Apple", "Growth", "Stanley")
    if (searchQuery && searchQuery.trim().length > 0) {
      const cleanQ = searchQuery.trim().toLowerCase();
      const slug = encodeURIComponent(cleanQ).replace(/%20/g, '-');
      targetUrls.push(`https://lista.mercadolivre.com.br/${slug}_Desconto_${Math.min(minDiscount, 10)}-100`);
      targetUrls.push(`https://lista.mercadolivre.com.br/${slug}`);
      targetUrls.push(`https://www.mercadolivre.com.br/ofertas?q=${encodeURIComponent(cleanQ)}`);
    } else {
      const preset = CATEGORY_PRESETS[categoryKey];

      if (categoryKey === 'geral' || !preset) {
        targetUrls.push('https://www.mercadolivre.com.br/ofertas?promotion_type=deal_of_the_day');
        targetUrls.push('https://www.mercadolivre.com.br/ofertas?promotion_type=lightning');
        targetUrls.push('https://www.mercadolivre.com.br/ofertas');
      } else {
        const keywords = customKeywords.length > 0 ? customKeywords : preset.defaultKeywords;
        
        for (const kw of keywords.slice(0, 3)) {
          const kwSlug = encodeURIComponent(kw.toLowerCase().trim()).replace(/%20/g, '-');
          targetUrls.push(`https://lista.mercadolivre.com.br/${kwSlug}_Desconto_${Math.min(minDiscount, 15)}-100`);
          targetUrls.push(`https://lista.mercadolivre.com.br/${kwSlug}`);
        }

        if (preset.mlCategoryId) {
          targetUrls.push(`https://www.mercadolivre.com.br/ofertas?category=${preset.mlCategoryId}`);
        }
      }
    }

    for (const url of targetUrls) {
      try {
        const html = await fetchHtml(url);
        const $ = cheerio.load(html);

        const cards = $('.poly-card, .promotion-item, .andes-card, .ui-search-result, .ui-search-layout__item, [class*="poly-card"], [class*="promotion-item"]');

        if (cards.length === 0) {
          console.log(`[ML Hunter] ⚠️ 0 cards encontrados em: ${url.substring(0, 80)}...`);
        } else {
          console.log(`[ML Hunter] 📦 ${cards.length} cards encontrados em: ${url.substring(0, 80)}...`);
        }

        cards.each((_, el) => {
          try {
            const card = $(el);
            
            // Link
            let link = card.find('a.poly-component__title, a.promotion-item__link-container, a.ui-search-link, a.ui-search-item__group__element').attr('href') ||
                       card.find('a').first().attr('href');

            if (!link || !link.startsWith('http')) return;
            link = link.split('?')[0].split('#')[0];

            // Título
            const title = card.find('.poly-component__title, .promotion-item__title, .ui-search-item__title, h2').text().trim();
            if (!title || title.length < 5) return;

            // Imagem
            let imageUrl = card.find('img').attr('data-src') ||
                           card.find('img').attr('src') || '';
            if (imageUrl.startsWith('data:')) {
              imageUrl = card.find('img').attr('data-src') || '';
            }

            // Verificação Rigorosa de Relevância por Marca / Termo
            if (searchQuery && searchQuery.trim().length > 0) {
              const qLower = searchQuery.toLowerCase().trim();
              const tLower = title.toLowerCase();
              const queryWords = qLower.split(/\s+/).filter(w => w.length >= 3);
              const hasMatch = tLower.includes(qLower) || (queryWords.length > 0 && queryWords.some(w => tLower.includes(w)));
              if (!hasMatch) return; // Rejeita produtos que não têm a marca buscada no título!
            } else if (categoryKey === 'esportes_suplementos') {
              // Rejeita câmeras, tripés, compressores e itens que não são de esporte/suplementação
              const sportsTerms = [
                'creatina', 'whey', 'proteina', 'suplemento', 'pre treino', 'pre-treino', 'bcaa', 
                'glutamina', 'tenis', 'corrida', 'fitness', 'treino', 'academia', 'halter', 'anilha', 
                'crossfit', 'smartband', 'squeeze', 'coqueteleira', 'albumina', 'hipercalorico', 
                'colageno', 'termogenico', 'bicicleta', 'esportivo', 'esportiva', 'ciclismo', 'kimono',
                'joelheira', 'munhequeira', 'strap', 'faixa elastica', 'corda de pular'
              ];
              const tLower = title.toLowerCase();
              const isRelevant = sportsTerms.some(term => tLower.includes(term));
              if (!isRelevant) return; // Rejeita itens aleatórios fora do nicho!
            } else if (categoryKey === 'eletronicos_tech') {
              const techTerms = ['fone', 'bluetooth', 'smartwatch', 'relogio', 'celular', 'smartphone', 'carregador', 'power bank', 'caixa de som', 'teclado', 'mouse', 'cabo', 'notebook', 'tablet', 'alexa', 'headset', 'ssd', 'monitor'];
              const isRelevant = techTerms.some(term => title.toLowerCase().includes(term));
              if (!isRelevant) return;
            }

            // 1. Preço original (riscado / antes)
            const originalPriceElem = card.find('.andes-money-amount--previous, s.andes-money-amount, .poly-component__price .andes-money-amount--previous, .ui-search-price__original-value .andes-money-amount').first();
            let originalPrice = this.extractPriceFromElement($, originalPriceElem);

            // 2. Preço atual promocional (NUNCA pegar o elemento com classe --previous)
            const currentPriceElem = card.find('.poly-price__current .andes-money-amount, .ui-search-price__second-line .andes-money-amount, .promotion-item__price .andes-money-amount, .poly-component__price .andes-money-amount:not(.andes-money-amount--previous), .andes-money-amount:not(.andes-money-amount--previous)').first();
            let currentPrice = this.extractPriceFromElement($, currentPriceElem);

            if (!currentPrice || currentPrice < minPrice) return;

            // Desconto percentual
            const discountText = card.find('.poly-price__discount-polylabel, .andes-money-amount__discount, .promotion-item__discount, .ui-search-price__discount').first().text().trim();
            let discountPercent: number | undefined;
            if (discountText) {
              const match = discountText.match(/(\d+)%/);
              if (match) discountPercent = parseInt(match[1], 10);
            }

            // Se os preços foram invertidos, corrige colocando o menor em currentPrice
            if (originalPrice && currentPrice && originalPrice < currentPrice) {
              [currentPrice, originalPrice] = [originalPrice, currentPrice];
            }

            // Se não encontrou o preço original mas tem o desconto e preço atual, calcula matematicamente
            if (!originalPrice && currentPrice && discountPercent && discountPercent > 0 && discountPercent < 99) {
              originalPrice = Math.round((currentPrice / (1 - (discountPercent / 100))) * 100) / 100;
            }

            // Se tem os dois preços mas não tem o desconto, calcula a porcentagem
            if (!discountPercent && originalPrice && currentPrice && originalPrice > currentPrice) {
              discountPercent = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
            }

            // Se NÃO for busca direta de marca, aplica o filtro estrito de desconto mínimo
            if (!searchQuery && discountPercent && discountPercent < minDiscount) return;

            const isFreeShipping = card.find('.poly-component__shipping:contains("grátis"), .promotion-item__shipping:contains("grátis"), span:contains("Frete grátis")').length > 0;

            const mlbMatch = link.match(/MLB-?(\d+)/i);
            const id = mlbMatch ? `ml_${mlbMatch[1]}` : `ml_${crypto.createHash('md5').update(title).digest('hex').substring(0, 12)}`;

            deals.push({
              id,
              store: 'mercadolivre',
              category: categoryKey,
              title,
              originalPrice: originalPrice && currentPrice && originalPrice > currentPrice ? originalPrice : undefined,
              currentPrice,
              discountPercent,
              imageUrl,
              originalUrl: link,
              affiliateUrl: LinkConverter.convertMercadoLivre(link),
              freeShipping: isFreeShipping
            });
          } catch {
            // Ignora card com erro
          }
        });

        if (deals.length >= 15) break;
      } catch (err) {
        console.warn(`Erro ao raspar ofertas do Mercado Livre (${url}):`, err);
      }
    }

    if (deals.length === 0) {
      console.log(`[ML Hunter] ⚠️ Nenhuma oferta encontrada para categoria "${categoryKey}" (URLs testadas: ${targetUrls.length})`);
    } else {
      console.log(`[ML Hunter] ✅ ${deals.length} ofertas encontradas para categoria "${categoryKey}"`);
    }

    return deals.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));
  }
}
