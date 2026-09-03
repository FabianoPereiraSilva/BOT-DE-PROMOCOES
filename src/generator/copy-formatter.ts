import { Deal } from '../types/deal.js';
import { getSystemSettings } from '../config/env.js';
import { GeminiCopywriter } from './gemini-copywriter.js';

export class CopyFormatter {
  /**
   * Formata preço em Real brasileiro (R$ 129,90)
   */
  static formatCurrency(value: number): string {
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  /**
   * Obtém a URL de compra (rastreada via /r/:dealId se appBaseUrl configurado ou direta)
   */
  static getBuyUrl(deal: Deal, channelId?: string): string {
    const settings = getSystemSettings();
    if (settings.appBaseUrl) {
      const chParam = channelId ? `?c=${encodeURIComponent(channelId)}` : '';
      return `${settings.appBaseUrl}/r/${deal.id}${chParam}`;
    }
    return deal.affiliateUrl;
  }

  /**
   * Gera a copy promocional para Telegram usando Gemini IA se configurado, ou template padrão
   */
  static async formatTelegramWithAi(deal: Deal, channelId?: string): Promise<string> {
    try {
      return await GeminiCopywriter.generateDealCopy(deal, channelId);
    } catch {
      return await this.formatTelegram(deal, channelId);
    }
  }

  /**
   * Gera a copy promocional para Telegram (em formato HTML do Telegram)
   */
  static async formatTelegram(deal: Deal, channelId?: string): Promise<string> {
    const settings = getSystemSettings();
    const customTemplate = settings.customCopyTemplate?.trim();
    const buyUrl = this.getBuyUrl(deal, channelId);

    const storeEmoji = deal.store === 'shopee' ? '🟠' : '🟡';
    const storeName = deal.store === 'shopee' ? 'SHOPEE' : 'MERCADO LIVRE';
    const formattedCurrentPrice = this.formatCurrency(deal.currentPrice);
    const formattedOriginalPrice = deal.originalPrice ? this.formatCurrency(deal.originalPrice) : null;
    const discountText = deal.discountPercent ? `-${deal.discountPercent}% OFF` : '';

    if (customTemplate) {
      return customTemplate
        .replace(/{titulo}/gi, deal.title)
        .replace(/{loja}/gi, storeName)
        .replace(/{loja_emoji}/gi, storeEmoji)
        .replace(/{preco_atual}/gi, formattedCurrentPrice)
        .replace(/{preco_antigo}/gi, formattedOriginalPrice || '')
        .replace(/{desconto}/gi, discountText)
        .replace(/{link}/gi, buyUrl)
        .replace(/{frete_gratis}/gi, deal.freeShipping ? '🚚 Frete Grátis' : '')
        .replace(/{cupom}/gi, deal.couponCode ? `🎟️ Cupom: <b>${deal.couponCode}</b>` : '');
    }

    // Template padrão limpo e com alta conversão
    const lines: string[] = [];

    // Título do Produto
    lines.push(`📦 <b>${this.escapeHtml(deal.title)}</b>`);

    // Bloco de Preço
    if (formattedOriginalPrice) {
      lines.push(`❌ De: <s>${formattedOriginalPrice}</s>`);
      lines.push(`🔥 <b>Por: ${formattedCurrentPrice}</b>${deal.discountPercent ? ` (${deal.discountPercent}% de desconto!)` : ''}`);
    } else if (deal.discountPercent) {
      lines.push(`🔥 <b>Por: ${formattedCurrentPrice}</b> (${deal.discountPercent}% de desconto!)`);
    } else {
      lines.push(`🔥 <b>Por apenas: ${formattedCurrentPrice}</b>`);
    }

    // Destaques / Vantagens
    const highlights: string[] = [];
    if (deal.freeShipping) {
      highlights.push('🚚 <i>Frete Grátis Disponível</i>');
    }
    if (deal.installments) {
      highlights.push(`💳 <i>${deal.installments}</i>`);
    }
    if (deal.rating) {
      highlights.push(`⭐ <i>Avaliação: ${deal.rating}/5.0</i>`);
    }
    if (deal.couponCode) {
      highlights.push(`🎟️ <i>Use o Cupom:</i> <code>${deal.couponCode}</code>`);
    }

    if (highlights.length > 0) {
      lines.push('');
      lines.push(...highlights);
    }

    // Chamada para Ação
    lines.push('');
    lines.push(`🛒 <b>Compre com Desconto Seguro:</b>`);
    lines.push(`👉 <a href="${buyUrl}">${buyUrl}</a>`);
    lines.push('');
    lines.push(`<i>⚡ O preço e o estoque podem mudar a qualquer momento!</i>`);
    lines.push('');
    lines.push(`#${deal.store === 'shopee' ? 'Shopee' : 'MercadoLivre'} #Promoção #Desconto #Ofertas`);

    return lines.join('\n');
  }

  /**
   * Escapa caracteres especiais para formato HTML do Telegram
   */
  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
