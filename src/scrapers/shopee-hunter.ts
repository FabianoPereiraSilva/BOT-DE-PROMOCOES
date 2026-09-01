import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { Deal } from '../types/deal.js';
import { fetchHtml, fetchJson, cleanPrice, getRandomUserAgent } from './base-scraper.js';
import { LinkConverter } from '../generator/link-converter.js';
import { CATEGORY_PRESETS } from '../config/categories.js';

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
          const itemData = await fetchJson(apiUrl, {
            'x-api-source': 'pc',
            'Referer': finalUrl
          });

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
   * Caçador de Ofertas com alto desconto da Shopee (Geral ou por Categoria/Palavras-chave)
   */
  static async huntDeals(
    minDiscount = 20, 
    minPrice = 15, 
    categoryKey = 'geral', 
    customKeywords: string[] = []
  ): Promise<Deal[]> {
    const deals: Deal[] = [];
    const preset = CATEGORY_PRESETS[categoryKey];

    let searchKeywords = ['promocao relampago', 'ofertas do dia', 'desconto'];
    if (preset && categoryKey !== 'geral') {
      searchKeywords = customKeywords.length > 0 ? customKeywords : preset.defaultKeywords;
    }

    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'x-api-source': 'pc',
      'x-shopee-language': 'pt-BR',
      'x-requested-with': 'XMLHttpRequest',
      'Referer': 'https://shopee.com.br/'
    };

    for (const kw of searchKeywords.slice(0, 3)) {
      try {
        const searchUrl = `https://shopee.com.br/api/v4/search/search_items?by=sales&keyword=${encodeURIComponent(kw)}&limit=30&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;
        const response = await fetchJson(searchUrl, browserHeaders);
        const items = response?.items || [];

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

        if (deals.length >= 10) break;
      } catch (err) {
        // Tenta próxima keyword silenciosamente
      }
    }

    return deals.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));
  }
}
