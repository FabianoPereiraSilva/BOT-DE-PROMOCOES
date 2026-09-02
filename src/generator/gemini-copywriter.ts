import axios from 'axios';
import { Deal } from '../types/deal.js';
import { getSystemSettings } from '../config/env.js';
import { CopyFormatter } from './copy-formatter.js';

export class GeminiCopywriter {
  // Lista de modelos suportados por ordem de prioridade
  private static readonly MODELS = [
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite-preview',
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-1.5-flash'
  ];

  /**
   * Testa se a chave do Gemini API é válida fazendo uma requisição mínima
   */
  static async testApiKey(apiKey: string): Promise<{ success: boolean; error?: string; modelUsed?: string }> {
    try {
      const key = apiKey.trim();
      if (!key) return { success: false, error: 'Chave do Gemini API não informada.' };

      let lastError = '';
      for (const model of this.MODELS) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
          const payload = {
            contents: [
              {
                parts: [{ text: 'Responda apenas: OK' }]
              }
            ]
          };

          const resp = await axios.post(url, payload, { timeout: 7000 });
          if (resp.status === 200) {
            return { success: true, modelUsed: model };
          }
        } catch (mErr: any) {
          lastError = mErr.response?.data?.error?.message || mErr.message;
        }
      }

      return { success: false, error: lastError || 'Nenhum modelo compatível com esta chave.' };
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.message;
      return { success: false, error: errMsg };
    }
  }

  /**
   * Gera uma copy promocional persuasiva e inteligente usando Google Gemini com estrutura 100% garantida
   */
  static async generateDealCopy(deal: Deal, channelId?: string): Promise<string> {
    const settings = getSystemSettings();
    const apiKey = settings.geminiApiKey?.trim();
    const isEnabled = settings.geminiAiEnabled !== false;
    const buyUrl = CopyFormatter.getBuyUrl(deal, channelId);
    const storeName = deal.store === 'shopee' ? 'Shopee' : 'Mercado Livre';
    const currPriceFormatted = CopyFormatter.formatCurrency(deal.currentPrice);
    const origPriceFormatted = deal.originalPrice ? CopyFormatter.formatCurrency(deal.originalPrice) : null;
    const discountStr = deal.discountPercent ? `${deal.discountPercent}% OFF` : '';

    let aiHook = '';

    // Se Gemini estiver ativado e configurado, busca um gancho persuasivo exclusivo
    if (apiKey && isEnabled) {
      const prompt = `Você é um copywriter profissional e estrategista de vendas de e-commerce brasileiro.
Escreva um gancho de vendas curto (1 ou 2 frases empolgantes com emojis) destacando o principal benefício e desejo de compra deste produto:
- Produto: "${deal.title}"
- Loja: ${storeName}
- Preço com Desconto: ${currPriceFormatted} (${discountStr})

Instruções:
- Seja persuasivo, dinâmico e direto ao ponto.
- Responda APENAS com a frase do benefício em texto puro, sem aspas e sem markdown.`;

      for (const model of this.MODELS) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
          const response = await axios.post(
            url,
            {
              contents: [
                {
                  parts: [{ text: prompt }]
                }
              ],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 150
              }
            },
            { timeout: 8000 }
          );

          const generatedText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (generatedText && generatedText.length >= 10 && !generatedText.toLowerCase().includes('erro')) {
            // Remove aspas ou formatações indesejadas
            aiHook = generatedText.replace(/^["']|["']$/g, '').trim();
            break;
          }
        } catch {
          // Tenta o próximo modelo
        }
      }
    }

    // Monta a estrutura 100% blindada e garantida
    const lines: string[] = [];

    // 1. Header de Atenção
    lines.push(`🚨 <b>OFERTA IMPERDÍVEL NA ${storeName.toUpperCase()}!</b> 🚨`);
    lines.push('');

    // 2. Título Oficial do Produto
    lines.push(`📦 <b>${this.escapeHtml(deal.title)}</b>`);

    // 3. Gancho / Benefício Persuasivo gerado por IA
    if (aiHook) {
      lines.push('');
      lines.push(`💡 <i>${this.escapeHtml(aiHook)}</i>`);
    }

    // 4. Bloco de Preço (100% garantido com DE e POR)
    lines.push('');
    if (origPriceFormatted && deal.discountPercent) {
      lines.push(`❌ De: <s>${origPriceFormatted}</s>`);
      lines.push(`🔥 <b>Por: ${currPriceFormatted}</b> (${deal.discountPercent}% de desconto!)`);
    } else if (origPriceFormatted) {
      lines.push(`❌ De: <s>${origPriceFormatted}</s>`);
      lines.push(`🔥 <b>Por: ${currPriceFormatted}</b>`);
    } else if (deal.discountPercent) {
      lines.push(`🔥 <b>Por: ${currPriceFormatted}</b> (${deal.discountPercent}% de desconto!)`);
    } else {
      lines.push(`🔥 <b>Por apenas: ${currPriceFormatted}</b>`);
    }

    // 5. Destaques (Frete Grátis, Parcelamento, Cupons)
    const highlights: string[] = [];
    if (deal.freeShipping) {
      highlights.push('🚚 <i>Frete Grátis Disponível</i>');
    }
    if (deal.installments) {
      highlights.push(`💳 <i>${this.escapeHtml(deal.installments)}</i>`);
    }
    if (deal.couponCode) {
      highlights.push(`🎟️ <i>Cupom:</i> <code>${this.escapeHtml(deal.couponCode)}</code>`);
    }

    if (highlights.length > 0) {
      lines.push('');
      lines.push(...highlights);
    }

    // 6. Chamada para Ação com Link de Afiliado
    lines.push('');
    lines.push(`🛒 <b>Compre com Desconto Seguro:</b>`);
    lines.push(`👉 <a href="${buyUrl}">${buyUrl}</a>`);
    lines.push('');
    lines.push(`<i>⚡ O preço e o estoque podem mudar a qualquer momento!</i>`);
    lines.push('');
    lines.push(`#${deal.store === 'shopee' ? 'Shopee' : 'MercadoLivre'} #Promoção #Ofertas #Desconto`);

    return lines.join('\n');
  }

  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
