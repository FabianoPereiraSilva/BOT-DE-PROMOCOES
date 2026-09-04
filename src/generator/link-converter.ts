import crypto from 'crypto';
import axios from 'axios';
import { getSystemSettings } from '../config/env.js';

export class LinkConverter {
  /**
   * Converte um link de produto do Mercado Livre em link de afiliado
   */
  static convertMercadoLivre(originalUrl: string): string {
    const settings = getSystemSettings();
    const tag = settings.mercadolivreAffiliateTag?.trim();

    try {
      const urlObj = new URL(originalUrl);

      // Limpar parâmetros de tracking existentes
      urlObj.searchParams.delete('tracking_id');
      urlObj.searchParams.delete('matt_tool');
      urlObj.searchParams.delete('matt_word');

      if (tag) {
        // Se o usuário colocou o código de afiliado (matt_tool ou tag personalizada)
        if (tag.includes('=')) {
          // Se for formato chave=valor (ex: matt_tool=12345&matt_word=promo)
          const params = new URLSearchParams(tag);
          params.forEach((val, key) => urlObj.searchParams.set(key, val));
        } else {
          // Formato padrão Mercado Livre Afiliados
          urlObj.searchParams.set('matt_tool', tag);
        }
      }

      return urlObj.toString();
    } catch {
      return originalUrl;
    }
  }

  /**
   * Converte um link de produto da Shopee em link de afiliado
   */
  static async convertShopee(originalUrl: string): Promise<string> {
    const settings = getSystemSettings();
    const { shopeeAppId, shopeeSecret, shopeeUniversalLinkPrefix } = settings;

    // Se as credenciais da API Oficial de Afiliados da Shopee estiverem configuradas
    if (shopeeAppId && shopeeSecret) {
      try {
        const shortLink = await this.generateShopeeApiShortLink(originalUrl, shopeeAppId, shopeeSecret);
        if (shortLink) return shortLink;
      } catch (err) {
        console.warn('Falha ao gerar link via Shopee Affiliate API, usando método padrão:', err);
      }
    }

    // Se o usuário configurou um prefixo universal ou se o link já é curto
    if (originalUrl.includes('s.shopee.com.br')) {
      return originalUrl;
    }

    // Retorna o link com o prefixo ou o original limpo
    try {
      const urlObj = new URL(originalUrl);
      // Remove parâmetros desnecessários de busca mantendo a rota do produto
      return urlObj.origin + urlObj.pathname;
    } catch {
      return originalUrl;
    }
  }

  /**
   * Geração de link curto via Shopee Affiliate Open API (GraphQL)
   */
  private static async generateShopeeApiShortLink(originUrl: string, appId: string, secret: string): Promise<string | null> {
    const timestamp = Math.floor(Date.now() / 1000);
    const query = `mutation { generateShortLink(input: { originUrl: "${originUrl}" }) { shortLink } }`;
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

    return response.data?.data?.generateShortLink?.shortLink || null;
  }

  /**
   * Converte um link de produto da Amazon em link de afiliado oficial
   * Suporta amazon.com.br/dp/ASIN, amzn.to, etc.
   */
  static convertAmazon(originalUrl: string): string {
    const settings = getSystemSettings();
    const tag = (settings.amazonAffiliateTag || 'fabianopere0d-20').trim();

    try {
      let candidateUrl = originalUrl;

      // 1. Se for link de redirecionamento ou anúncio patrocinado (/sspa/click), decodifica para achar o destino
      if (candidateUrl.includes('/sspa/click') || candidateUrl.includes('%2Fdp%2F')) {
        try {
          candidateUrl = decodeURIComponent(candidateUrl);
        } catch {}
      }

      // 2. Extrair ASIN (10 caracteres alfanuméricos padrão Amazon: B0... ou dígitos)
      const asinMatch = candidateUrl.match(/(?:\/dp\/|\/gp\/product\/|\/product\/|\/d\/|ASIN=|asin%3D|asin=)([A-Z0-9]{10})/i);
      if (asinMatch && asinMatch[1]) {
        const asin = asinMatch[1].toUpperCase();
        return `https://www.amazon.com.br/dp/${asin}?tag=${tag}`;
      }

      // 3. Fallback: Se for uma URL da Amazon sem ASIN identificado, limpa parâmetros sujos e injeta a tag
      const urlObj = new URL(originalUrl);
      urlObj.searchParams.delete('tag');
      urlObj.searchParams.delete('ascsubtag');
      urlObj.searchParams.delete('ref');
      urlObj.searchParams.delete('ref_');
      urlObj.searchParams.delete('linkCode');
      urlObj.searchParams.set('tag', tag);
      return urlObj.toString();
    } catch {
      return originalUrl;
    }
  }
}
