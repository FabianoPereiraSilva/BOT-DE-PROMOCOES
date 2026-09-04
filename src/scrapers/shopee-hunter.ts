import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { Deal } from '../types/deal.js';
import { fetchHtml, fetchShopeeApi, cleanPrice, getRandomUserAgent } from './base-scraper.js';
import { LinkConverter } from '../generator/link-converter.js';
import { CATEGORY_PRESETS } from '../config/categories.js';
import { getSystemSettings } from '../config/env.js';

export class ShopeeHunter {
  /**
   * Resolve redirecionamento se for link encurtado (ex: s.shopee.com.br)
   */
  static async resolveRedirect(url: string): Promise<string> {
    if (!url.includes('s.shopee.com.br') && !url.includes('shp.ee')) {
      return url;
    }

    try {
      const resp = await axios.get(url, {
        headers: { 'User-Agent': getRandomUserAgent() },
        maxRedirects: 10,
        timeout: 10000
      });
      return resp.request?.res?.responseUrl || resp.config?.url || url;
    } catch (err: any) {
      if (err.response?.headers?.location) {
        return err.response.headers.location;
      }
      return url;
    }
  }

  /**
   * Extrai dados de um produto da Shopee por URL
   */
  static async extractProductFromUrl(rawUrl: string): Promise<Deal | null> {
    try {
      const finalUrl = await this.resolveRedirect(rawUrl);

      let shopId: string | null = null;
      let itemId: string | null = null;

      const slashMatch = finalUrl.match(/product\/(\d+)\/(\d+)/i);
      const dotMatch = finalUrl.match(/-i\.(\d+)\.(\d+)/i);

      if (slashMatch) {
        shopId = slashMatch[1];
        itemId = slashMatch[2];
      } else if (dotMatch) {
        shopId = dotMatch[1];
        itemId = dotMatch[2];
      }

      // 1. Se temos shopId e itemId, tentar API de itens da Shopee
      if (shopId && itemId) {
        try {
          const apiUrl = `https://shopee.com.br/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`;
          const itemData = await fetchShopeeApi(apiUrl);

          const data = itemData?.data;
          if (data && data.name) {
            const currentPrice = data.price ? data.price / 100000 : (data.price_min ? data.price_min / 100000 : 0);
            const originalPrice = data.price_before_discount ? data.price_before_discount / 100000 : currentPrice;
            const discountPercent = data.discount ? parseInt(data.discount.replace('%', ''), 10) :
                                    (originalPrice > currentPrice ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : 0);

            const imageHash = data.image || (data.images && data.images[0]) || '';
            const imageUrl = imageHash ? `https://down-br.img.susercontent.com/file/${imageHash}` : '';
            const affiliateUrl = await LinkConverter.convertShopee(finalUrl);

            return {
              id: `shopee_${itemId}`,
              store: 'shopee',
              title: data.name,
              originalPrice: originalPrice > currentPrice ? originalPrice : undefined,
              currentPrice,
              discountPercent: discountPercent > 0 ? discountPercent : undefined,
              imageUrl,
              originalUrl: finalUrl,
              affiliateUrl,
              rating: data.item_rating?.rating_star ? parseFloat(data.item_rating.rating_star.toFixed(1)) : undefined,
              reviewCount: data.item_rating?.rating_count ? data.item_rating.rating_count[0] : undefined,
              freeShipping: data.show_free_shipping || false
            };
          }
        } catch {
          // Fallback para scraping HTML
        }
      }

      // 2. Scraping HTML / Meta tags
      const html = await fetchHtml(finalUrl);
      const $ = cheerio.load(html);

      const title = $('meta[property="og:title"]').attr('content')?.replace(' | Shopee Brasil', '').trim() ||
                    $('title').text().replace(' | Shopee Brasil', '').trim();

      if (!title) return null;

      const imageUrl = $('meta[property="og:image"]').attr('content') ||
                       $('meta[name="twitter:image"]').attr('content') || '';

      const priceMeta = $('meta[property="product:price:amount"]').attr('content') ||
                        $('meta[property="og:price:amount"]').attr('content');

      let currentPrice = cleanPrice(priceMeta);
      if (!currentPrice) {
        const textPrice = $('[class*="price"]').first().text();
        currentPrice = cleanPrice(textPrice);
      }

      const id = itemId ? `shopee_${itemId}` : `shopee_${crypto.createHash('md5').update(title + currentPrice).digest('hex').substring(0, 12)}`;
      const affiliateUrl = await LinkConverter.convertShopee(finalUrl);

      return {
        id,
        store: 'shopee',
        title,
        currentPrice: currentPrice || 0,
        imageUrl,
        originalUrl: finalUrl,
        affiliateUrl
      };
    } catch (error) {
      console.error(`Erro ao extrair produto da Shopee (${rawUrl}):`, error);
      return null;
    }
  }

  /**
   * Tenta buscar ofertas via scraping HTML da página de busca da Shopee
   */
  private static async huntViaHtmlScraping(
    keyword: string,
    minDiscount: number,
    minPrice: number,
    categoryKey: string
  ): Promise<Deal[]> {
    const deals: Deal[] = [];

    try {
      const searchUrl = `https://shopee.com.br/search?keyword=${encodeURIComponent(keyword)}&sortBy=sales`;
      const html = await fetchHtml(searchUrl, {
        'Referer': 'https://shopee.com.br/',
        'Cookie': 'SPC_F=undefined; REC_T_ID=undefined;'
      });

      if (!html || html.length < 500) {
        console.warn(`[Shopee HTML] Página de busca retornou vazia para "${keyword}"`);
        return deals;
      }

      const $ = cheerio.load(html);

      // Tenta extrair dados embutidos no JSON do SSR (script tags com dados de busca)
      const scripts = $('script').toArray();
      for (const script of scripts) {
        const scriptContent = $(script).html() || '';

        // Shopee frequentemente embute dados de itens em JSON dentro de <script>
        const jsonMatches = scriptContent.match(/"item_basic"\s*:\s*\{[^}]+\}/g);
        if (!jsonMatches) continue;

        for (const match of jsonMatches) {
          try {
            // Tenta reconstruir o objeto JSON parcial
            const itemJson = `{${match}}`;
            const parsed = JSON.parse(itemJson);
            const item = parsed.item_basic;
            if (!item || !item.name) continue;

            const currentPrice = item.price ? item.price / 100000 : (item.price_min ? item.price_min / 100000 : 0);
            const originalPrice = item.price_before_discount ? item.price_before_discount / 100000 : currentPrice;

            if (currentPrice < minPrice) continue;

            let discountPercent = item.raw_discount || 0;
            if (!discountPercent && originalPrice > currentPrice) {
              discountPercent = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
            }

            if (discountPercent < minDiscount) continue;

            const imageHash = item.image || (item.images && item.images[0]) || '';
            const imageUrl = imageHash ? `https://down-br.img.susercontent.com/file/${imageHash}` : '';
            const originalUrl = `https://shopee.com.br/product/${item.shopid}/${item.itemid}`;
            const affiliateUrl = await LinkConverter.convertShopee(originalUrl);

            deals.push({
              id: `shopee_${item.itemid}`,
              store: 'shopee',
              category: categoryKey,
              title: item.name,
              originalPrice: originalPrice > currentPrice ? originalPrice : undefined,
              currentPrice,
              discountPercent: discountPercent > 0 ? discountPercent : undefined,
              imageUrl,
              originalUrl,
              affiliateUrl,
              freeShipping: item.show_free_shipping || false
            });

            if (deals.length >= 10) break;
          } catch {
            // JSON parcial inválido, pula
          }
        }

        if (deals.length > 0) break;
      }

      // Fallback: tenta extrair de meta tags e links de produto na página
      if (deals.length === 0) {
        const productLinks = $('a[href*="/product/"], a[data-sqe="link"]').toArray();
        console.log(`[Shopee HTML] Encontrados ${productLinks.length} links de produto para "${keyword}"`);

        for (const link of productLinks.slice(0, 5)) {
          const href = $(link).attr('href');
          if (!href) continue;

          const fullUrl = href.startsWith('http') ? href : `https://shopee.com.br${href}`;
          const productMatch = fullUrl.match(/product\/(\d+)\/(\d+)/);
          if (!productMatch) continue;

          // Tenta extrair info do card HTML
          const card = $(link).closest('[data-sqe="item"]').length > 0
            ? $(link).closest('[data-sqe="item"]')
            : $(link).parent();

          const title = card.find('[data-sqe="name"]').text().trim() ||
                       $(link).text().trim() ||
                       card.find('div').first().text().trim();

          if (!title || title.length < 5) continue;

          const priceText = card.find('[class*="price"]').text();
          const currentPrice = cleanPrice(priceText);

          if (currentPrice && currentPrice >= minPrice) {
            const originalUrl = `https://shopee.com.br/product/${productMatch[1]}/${productMatch[2]}`;
            const affiliateUrl = await LinkConverter.convertShopee(originalUrl);

            deals.push({
              id: `shopee_${productMatch[2]}`,
              store: 'shopee',
              category: categoryKey,
              title,
              currentPrice,
              imageUrl: '',
              originalUrl,
              affiliateUrl
            });
          }

          if (deals.length >= 5) break;
        }
      }
    } catch (err: any) {
      console.warn(`[Shopee HTML] Erro ao fazer scraping de busca para "${keyword}":`, err.message);
    }

    return deals;
  }

  /**
   * Caça ofertas oficiais de alto desconto e conversão através da Shopee Affiliate Open API (GraphQL)
   * 100% oficial, sem bloqueios de scraping/403 e já com links oficiais de afiliado.
   */
  private static async huntViaAffiliateApi(
    minDiscount: number,
    minPrice: number,
    categoryKey: string,
    customKeywords: string[] = [],
    searchQuery?: string
  ): Promise<Deal[]> {
    const settings = getSystemSettings();
    const appId = settings.shopeeAppId?.trim();
    const secret = settings.shopeeSecret?.trim();

    if (!appId || !secret) {
      return [];
    }

    const deals: Deal[] = [];
    const preset = CATEGORY_PRESETS[categoryKey];

    let searchKeywords: string[] = [];
    if (searchQuery && searchQuery.trim().length > 0) {
      searchKeywords = [searchQuery.trim()];
    } else if (customKeywords && customKeywords.length > 0) {
      searchKeywords = customKeywords.slice(0, 3);
    } else if (preset && categoryKey !== 'geral') {
      searchKeywords = preset.defaultKeywords.slice(0, 2);
    } else {
      // Geral: busca vazia (pega as maiores ofertas gerais do catálogo de afiliados) + ofertas do dia
      searchKeywords = ['', 'ofertas do dia'];
    }

    for (const kw of searchKeywords) {
      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const kwParam = kw ? `keyword: "${kw.replace(/"/g, '')}", ` : '';
        const query = `query { productOfferV2(${kwParam}sortType: 1, page: 1, limit: 30) { nodes { itemId productName productLink offerLink imageUrl priceMin priceMax priceDiscountRate sales ratingStar commissionRate } } }`;

        const payloadStr = JSON.stringify({ query });
        const factor = `${appId}${timestamp}${payloadStr}${secret}`;
        const signature = crypto.createHash('sha256').update(factor).digest('hex');

        const response = await axios.post(
          'https://open-api.affiliate.shopee.com.br/graphql',
          payloadStr,
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`
            },
            timeout: 8000
          }
        );

        if (response.data?.errors) {
          console.warn(`[Shopee API] Resposta da API para "${kw || 'geral'}":`, response.data.errors[0]?.message);
          continue;
        }

        const nodes = response.data?.data?.productOfferV2?.nodes || [];
        if (nodes.length > 0) {
          console.log(`[Shopee API] ✅ ${nodes.length} ofertas retornadas para "${kw || 'geral'}"`);
        }

        for (const item of nodes) {
          const currentPrice = parseFloat(item.priceMin || item.priceMax || '0');
          if (isNaN(currentPrice) || currentPrice < minPrice) continue;

          const discountPercent = item.priceDiscountRate || 0;
          // Se houver busca por marca/query aceita desconto >= 10 ou o minDiscount solicitado
          const threshold = searchQuery ? Math.min(minDiscount, 10) : minDiscount;
          if (threshold > 0 && discountPercent < threshold) continue;

          let originalPrice: number | undefined;
          if (discountPercent > 0) {
            originalPrice = Math.round((currentPrice / (1 - discountPercent / 100)) * 100) / 100;
          }

          const affiliateUrl = item.offerLink || item.productLink;
          const pName = (item.productName || '').toLowerCase();
          const pLink = (item.productLink || '').toLowerCase();
          const isInternational = pName.includes('internacional') || 
                                  pName.includes('importado da china') || 
                                  pName.includes('envio internacional') ||
                                  pLink.includes('crossborder') ||
                                  pLink.includes('-i.');

          deals.push({
            id: `shopee_${item.itemId}`,
            store: 'shopee',
            category: categoryKey,
            title: item.productName,
            originalPrice: originalPrice && originalPrice > currentPrice ? originalPrice : undefined,
            currentPrice,
            discountPercent: discountPercent > 0 ? discountPercent : undefined,
            imageUrl: item.imageUrl || '',
            originalUrl: item.productLink,
            affiliateUrl,
            rating: item.ratingStar ? parseFloat(item.ratingStar) : undefined,
            freeShipping: true,
            isInternational
          });
        }

        if (deals.length >= 25) break;
      } catch (err: any) {
        console.warn(`[Shopee API] Falha na consulta de ofertas "${kw}":`, err.message);
      }
    }

    return deals;
  }

  /**
   * Caçador de Ofertas com alto desconto da Shopee (Geral ou por Categoria/Palavras-chave)
   * Estratégia: 1) Shopee Affiliate Open API (GraphQL oficial)  2) Fallback: API v4 / scraping HTML
   */
  static async huntDeals(
    minDiscount = 20, 
    minPrice = 15, 
    categoryKey = 'geral', 
    customKeywords: string[] = [],
    searchQuery?: string
  ): Promise<Deal[]> {
    // === TENTATIVA 1: API Oficial de Afiliados Shopee (GraphQL) ===
    try {
      const apiDeals = await this.huntViaAffiliateApi(minDiscount, minPrice, categoryKey, customKeywords, searchQuery);
      if (apiDeals.length > 0) {
        console.log(`[Shopee Hunter] 🎯 ${apiDeals.length} ofertas de alto desconto encontradas via Shopee Affiliate Open API!`);
        const unique = new Map<string, Deal>();
        apiDeals.forEach(d => { if (!unique.has(d.id)) unique.set(d.id, d); });
        return Array.from(unique.values()).sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));
      }
    } catch (apiErr: any) {
      console.warn('[Shopee Hunter] Falha ao tentar API Oficial de Afiliados, tentando fallbacks:', apiErr.message);
    }

    // === TENTATIVA 2: Fallbacks Legados (Scraping) ===
    const deals: Deal[] = [];
    const preset = CATEGORY_PRESETS[categoryKey];

    let searchKeywords = ['promocao relampago', 'ofertas do dia', 'desconto'];

    if (searchQuery && searchQuery.trim().length > 0) {
      searchKeywords = [searchQuery.trim()];
    } else if (preset && categoryKey !== 'geral') {
      searchKeywords = customKeywords.length > 0 ? customKeywords : preset.defaultKeywords;
    }

    for (const kw of searchKeywords.slice(0, 3)) {
      try {
        // === TENTATIVA 1: API v4 com headers anti-bot melhorados ===
        const searchUrl = `https://shopee.com.br/api/v4/search/search_items?by=sales&keyword=${encodeURIComponent(kw)}&limit=30&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;
        const response = await fetchShopeeApi(searchUrl);
        const items = response?.items || [];

        if (items.length > 0) {
          console.log(`[Shopee API] ✅ ${items.length} itens encontrados para "${kw}"`);
        }

        for (const container of items) {
          try {
            const item = container.item_basic;
            if (!item) continue;

            const currentPrice = item.price ? item.price / 100000 : (item.price_min ? item.price_min / 100000 : 0);
            const originalPrice = item.price_before_discount ? item.price_before_discount / 100000 : currentPrice;

            if (currentPrice < minPrice) continue;

            let discountPercent = item.raw_discount ? item.raw_discount : (item.discount ? parseInt(item.discount.toString().replace('%', ''), 10) : 0);
            if (!discountPercent && originalPrice > currentPrice) {
              discountPercent = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
            }

            if (discountPercent < minDiscount) continue;

            const title = item.name;
            const imageHash = item.image || (item.images && item.images[0]) || '';
            const imageUrl = imageHash ? `https://down-br.img.susercontent.com/file/${imageHash}` : '';
            const originalUrl = `https://shopee.com.br/product/${item.shopid}/${item.itemid}`;
            const affiliateUrl = await LinkConverter.convertShopee(originalUrl);

            deals.push({
              id: `shopee_${item.itemid}`,
              store: 'shopee',
              category: categoryKey,
              title,
              originalPrice: originalPrice > currentPrice ? originalPrice : undefined,
              currentPrice,
              discountPercent: discountPercent > 0 ? discountPercent : undefined,
              imageUrl,
              originalUrl,
              affiliateUrl,
              rating: item.item_rating?.rating_star ? parseFloat(item.item_rating.rating_star.toFixed(1)) : undefined,
              freeShipping: item.show_free_shipping || false
            });

            if (deals.length >= 15) break;
          } catch {
            // Continua para o próximo item
          }
        }

        // === TENTATIVA 2: Se API falhou (0 itens), tenta scraping HTML ===
        if (items.length === 0) {
          console.log(`[Shopee] API v4 retornou 0 itens para "${kw}", tentando scraping HTML...`);
          const htmlDeals = await this.huntViaHtmlScraping(kw, minDiscount, minPrice, categoryKey);
          if (htmlDeals.length > 0) {
            console.log(`[Shopee HTML] ✅ ${htmlDeals.length} ofertas encontradas via HTML para "${kw}"`);
            deals.push(...htmlDeals);
          } else {
            console.log(`[Shopee HTML] ⚠️ Nenhuma oferta encontrada via HTML para "${kw}"`);
          }
        }

        if (deals.length >= 10) break;
      } catch (err: any) {
        console.warn(`[Shopee] Erro geral na busca por "${kw}":`, err.message);
        // Tenta scraping HTML como último recurso
        try {
          const htmlDeals = await this.huntViaHtmlScraping(kw, minDiscount, minPrice, categoryKey);
          deals.push(...htmlDeals);
        } catch {}
      }
    }

    if (deals.length === 0) {
      console.log(`[Shopee Hunter] ⚠️ Nenhuma oferta encontrada para categoria "${categoryKey}" (keywords: ${searchKeywords.slice(0, 3).join(', ')})`);
    }

    return deals.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));
  }
}

