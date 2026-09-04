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

    const storeEmoji = deal.store === 'shopee' ? '🟠' : deal.store === 'amazon' ? '📦' : '🟡';
    const storeName = deal.store === 'shopee' ? 'SHOPEE' : deal.store === 'amazon' ? 'AMAZON' : 'MERCADO LIVRE';
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

    // Estilos visuais dinâmicos para diversificar as publicações do canal
    const styles = [
      // Estilo 1: Alerta Relâmpago / Urgência
      () => {
        const lines: string[] = [];
        lines.push(`⚡ <b>ALERTA DE PROMOÇÃO RELÂMPAGO!</b> ⚡`);
        lines.push('');
        lines.push(`📦 <b>${this.escapeHtml(deal.title)}</b>`);
        lines.push('');
        if (formattedOriginalPrice) {
          lines.push(`❌ De: <s>${formattedOriginalPrice}</s>`);
          lines.push(`🔥 <b>Por apenas: ${formattedCurrentPrice}</b>${deal.discountPercent ? ` (${deal.discountPercent}% OFF)` : ''}`);
        } else if (deal.discountPercent) {
          lines.push(`🔥 <b>Por: ${formattedCurrentPrice}</b> (${deal.discountPercent}% OFF)`);
        } else {
          lines.push(`🔥 <b>Por apenas: ${formattedCurrentPrice}</b>`);
        }
        return lines;
      },
      // Estilo 2: Super Oferta / Desconto Quente
      () => {
        const lines: string[] = [];
        lines.push(`${storeEmoji} <b>OFERTA IMPERDÍVEL NA ${storeName}!</b>`);
        lines.push('');
        lines.push(`🔹 <b>${this.escapeHtml(deal.title)}</b>`);
        lines.push('');
        if (formattedOriginalPrice) {
          lines.push(`📉 Economize agora: de <s>${formattedOriginalPrice}</s>`);
          lines.push(`💰 <b>Por: ${formattedCurrentPrice}</b>${deal.discountPercent ? ` (Economia de ${deal.discountPercent}%)` : ''}`);
        } else {
          lines.push(`💰 <b>Preço especial: ${formattedCurrentPrice}</b>`);
        }
        return lines;
      },
      // Estilo 3: Direto ao Ponto / Destaque de Preço
      () => {
        const lines: string[] = [];
        lines.push(`🎯 <b>ACHADO DO DIA!</b>`);
        lines.push('');
        lines.push(`<b>${this.escapeHtml(deal.title)}</b>`);
        lines.push('');
        lines.push(`🏷️ <b>Valor: ${formattedCurrentPrice}</b>${deal.discountPercent ? ` <i>(-${deal.discountPercent}% de desconto)</i>` : ''}`);
        if (formattedOriginalPrice) {
          lines.push(`<i>Preço anterior: <s>${formattedOriginalPrice}</s></i>`);
        }
        return lines;
      }
    ];

    // Escolhe aleatoriamente um dos estilos para o post
    const selectedStyleIndex = Math.floor(Math.random() * styles.length);
    const lines = styles[selectedStyleIndex]();

    // Destaques / Vantagens
    const highlights: string[] = [];
    if (deal.freeShipping) {
      highlights.push(deal.store === 'amazon' ? '🚚 <i>Frete Grátis com Prime</i>' : '🚚 <i>Frete Grátis Disponível</i>');
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

    // Chamada para Ação e Link
    lines.push('');
    lines.push(`🛒 <b>Garanta a sua antes que acabe:</b>`);
    lines.push(`👉 <a href="${buyUrl}">${buyUrl}</a>`);
    lines.push('');
    lines.push(`<i>⚠️ Preço e disponibilidade sujeitos a alteração rápida!</i>`);
    lines.push('');
    const storeTag = deal.store === 'shopee' ? 'Shopee' : deal.store === 'amazon' ? 'Amazon' : 'MercadoLivre';
    lines.push(`#${storeTag} #Promoção #Desconto #Ofertas`);

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
