import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { Deal } from '../types/deal.js';
import { fetchHtml, cleanPrice } from './base-scraper.js';
import { LinkConverter } from '../generator/link-converter.js';
import { CATEGORY_PRESETS } from '../config/categories.js';

export class MercadoLivreHunter {
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
      let title = ldJsonData?.name ||
                  $('h1.ui-pdp-title').text().trim() ||
                  $('meta[property="og:title"]').attr('content')?.replace(/ \| Mercado\s*Livre/i, '').trim() ||
                  $('meta[name="twitter:title"]').attr('content')?.replace(/ \| Mercado\s*Livre/i, '').trim() ||
                  $('title').text().replace(/ \| Mercado\s*Livre/i, '').trim();

      if (title && (title.toLowerCase() === 'mercado libre' || title.toLowerCase() === 'mercado livre')) {
        const h1 = $('h1').first().text().trim();
        if (h1) title = h1;
      }

      if (!title || title.toLowerCase() === 'mercado libre' || title.toLowerCase() === 'mercado livre') {
        return null;
      }

      // Imagem
      let imageUrl = ldJsonData?.image ||
                     $('figure.ui-pdp-gallery__figure img').first().attr('src') ||
                     $('meta[property="og:image"]').attr('content') ||
                     $('meta[name="twitter:image"]').attr('content') ||
                     $('.ui-pdp-image').first().attr('src') || '';

      if (Array.isArray(imageUrl)) {
        imageUrl = imageUrl[0] || '';
      }

      if (imageUrl && imageUrl.includes('-I.jpg')) {
        imageUrl = imageUrl.replace('-I.jpg', '-O.jpg');
      }

      // Preço atual
      let currentPrice = cleanPrice(ldJsonData?.offers?.price || ldJsonData?.offers?.lowPrice);
      
      if (!currentPrice) {
        const priceMeta = $('meta[itemprop="price"]').attr('content') ||
                          $('meta[property="product:price:amount"]').attr('content');
        currentPrice = cleanPrice(priceMeta);
      }

      if (!currentPrice) {
        const fraction = $('.ui-pdp-price__second-line .andes-money-amount__fraction, .andes-money-amount--primary .andes-money-amount__fraction').first().text().trim();
        const cents = $('.ui-pdp-price__second-line .andes-money-amount__cents, .andes-money-amount--primary .andes-money-amount__cents').first().text().trim() || '00';
        if (fraction) {
          currentPrice = cleanPrice(`${fraction}.${cents}`);
        }
      }

      // Preço original (riscado)
      let originalPrice: number | undefined;
      const originalFraction = $('.ui-pdp-price__original-value .andes-money-amount__fraction, .andes-money-amount--previous .andes-money-amount__fraction').first().text().trim();
      if (originalFraction) {
        originalPrice = cleanPrice(originalFraction);
      }

      // Desconto percentual
      let discountPercent: number | undefined;
      const discountText = $('.ui-pdp-price__second-line .andes-money-amount__discount, .andes-money-amount__discount').first().text().trim();
      if (discountText) {
        const match = discountText.match(/(\d+)%/);
        if (match) discountPercent = parseInt(match[1], 10);
      }

      if (!discountPercent && originalPrice && originalPrice > currentPrice) {
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
        originalPrice: originalPrice && originalPrice > currentPrice ? originalPrice : undefined,
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

        const cards = $('.poly-card, .promotion-item, .andes-card, .ui-search-result, .ui-search-layout__item');

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

            // Preço atual
            const currentFraction = card.find('.poly-price__current .andes-money-amount__fraction, .promotion-item__price .andes-money-amount__fraction, .ui-search-price__second-line .andes-money-amount__fraction, .andes-money-amount__fraction').first().text().trim();
            const currentCents = card.find('.poly-price__current .andes-money-amount__cents, .promotion-item__price .andes-money-amount__cents, .ui-search-price__second-line .andes-money-amount__cents, .andes-money-amount__cents').first().text().trim() || '00';
            const currentPrice = cleanPrice(`${currentFraction}.${currentCents}`);

            if (currentPrice < minPrice) return;

            // Preço anterior / Desconto
            const originalFraction = card.find('.andes-money-amount--previous .andes-money-amount__fraction, .promotion-item__old-price .andes-money-amount__fraction').first().text().trim();
            const originalPrice = originalFraction ? cleanPrice(originalFraction) : undefined;

            const discountText = card.find('.andes-money-amount__discount, .promotion-item__discount, .ui-search-price__discount').first().text().trim();
            let discountPercent: number | undefined;
            if (discountText) {
              const match = discountText.match(/(\d+)%/);
              if (match) discountPercent = parseInt(match[1], 10);
            }

            if (!discountPercent && originalPrice && originalPrice > currentPrice) {
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
              originalPrice: originalPrice && originalPrice > currentPrice ? originalPrice : undefined,
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

    return deals.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));
  }
}
