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
    const query = `
      mutation {
        generateShortLink(input: { originUrl: "${originUrl}", subIds: ["bot_auto"] }) {
          shortLink
        }
      }
    `;

    const factor = `${appId}${timestamp}${query}${secret}`;
    const signature = crypto.createHash('sha256').update(factor).digest('hex');

    const response = await axios.post(
      'https://open-api.affiliate.shopee.com.br/graphql',
      { query },
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
   * Encurta uma URL usando is.gd (gratuito, sem API key, links curtos tipo is.gd/xxxxx)
   * Fallback para TinyURL se is.gd falhar
   */
  static async shortenUrl(url: string): Promise<string> {
    // Tenta is.gd — gera links bem curtos (ex: https://is.gd/abc123)
    try {
      const response = await axios.get(
        `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`,
        {
          timeout: 4000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        }
      );
      const shortened = response.data?.trim();
      if (shortened && shortened.startsWith('http') && !shortened.includes('error')) {
        return shortened;
      }
    } catch {
      // continua para o próximo serviço
    }

    // Fallback: TinyURL
    try {
      const response = await axios.get(
        `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
        { timeout: 5000 }
      );
      const shortened = response.data?.trim();
      if (shortened && shortened.startsWith('http')) {
        return shortened;
      }
    } catch {
      // fallback silencioso
    }

    // Último recurso: retorna a URL original
    return url;
  }
}
