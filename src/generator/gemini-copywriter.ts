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
   * Gera uma copy promocional persuasiva e inteligente usando Google Gemini
   */
  static async generateDealCopy(deal: Deal, channelId?: string): Promise<string> {
    const settings = getSystemSettings();
    const apiKey = settings.geminiApiKey?.trim();
    const isEnabled = settings.geminiAiEnabled !== false;

    // Se Gemini não estiver configurado ou desativado, retorna o template padrão imediatamente
    if (!apiKey || !isEnabled) {
      return CopyFormatter.formatTelegram(deal, channelId);
    }

    const buyUrl = CopyFormatter.getBuyUrl(deal, channelId);
    const storeName = deal.store === 'shopee' ? 'Shopee' : 'Mercado Livre';
    const currPriceFormatted = CopyFormatter.formatCurrency(deal.currentPrice);
    const origPriceFormatted = deal.originalPrice ? CopyFormatter.formatCurrency(deal.originalPrice) : null;
    const discountStr = deal.discountPercent ? `${deal.discountPercent}% OFF` : '';

    const prompt = `Você é um copywriter profissional e estrategista de conversão em vendas para canais de promoções no Telegram no Brasil.
Crie uma mensagem promocional irresistível, moderna e com alto poder de conversão para o Telegram com base no seguinte produto:

DADOS DO PRODUTO:
- Loja: ${storeName}
- Título do Produto: ${deal.title}
- Preço Atual Promocional: ${currPriceFormatted}
- Preço Original Riscado: ${origPriceFormatted || 'Não informado'}
- Desconto: ${discountStr || 'Preço Especial'}
- Frete Grátis: ${deal.freeShipping ? 'Sim' : 'Não'}
- Cupom: ${deal.couponCode || 'Nenhum'}
- Link de Compra: ${buyUrl}

REGRAS ESTREITAS DE FORMATAÇÃO DO TELEGRAM:
1. Responda APENAS com o texto da copy pronta para envio no Telegram.
2. Use EXCLUSIVAMENTE formatação HTML suportada pelo Telegram (<b>texto em negrito</b>, <i>texto em itálico</i>, <s>texto riscado</s>, <code>código/cupom</code>, <a href="${buyUrl}">link</a>). NUNCA use markdown como ** ou __.
3. ESTRUTURA OBRIGATÓRIA:
   - Linha 1: Headline de atenção chamativa com emojis (ex: 🚨 <b>OFERTA IMPERDÍVEL NA ${storeName.toUpperCase()}!</b> 🚨)
   - Linha 2 em branco
   - Linha 3: 📦 <b>${deal.title}</b>
   - Linha 4: 1 ou 2 frases curtas com o benefício real do produto que desperta desejo de compra imediata.
   - Linha 5 em branco
   - Bloco de Preço:
     ${origPriceFormatted ? `❌ De: <s>${origPriceFormatted}</s>\n` : ''}🔥 <b>Por: ${currPriceFormatted}</b>${deal.discountPercent ? ` (${deal.discountPercent}% de desconto!)` : ''}
   - Destaques (se frete grátis: 🚚 <i>Frete Grátis Disponível</i>; se cupom: 🎟️ <i>Cupom:</i> <code>${deal.couponCode || ''}</code>)
   - Linha em branco
   - CTA (Chamada para Ação):
     🛒 <b>Compre com Desconto Seguro:</b>
     👉 <a href="${buyUrl}">${buyUrl}</a>
   - Linha em branco
   - Aviso de urgência: <i>⚡ O preço e o estoque podem mudar a qualquer momento!</i>
   - Hashtags temáticas do nicho e da loja (#${deal.store === 'shopee' ? 'Shopee' : 'MercadoLivre'} #Promoção #Ofertas)
4. Mantenha o texto limpo, sem caracteres estranhos e com espaçamento harmônico.`;

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
              maxOutputTokens: 600
            }
          },
          { timeout: 7000 }
        );

        const candidates = response.data?.candidates;
        const generatedText = candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (generatedText && generatedText.length > 30) {
          // Garante que o link de afiliado esteja presente no texto gerado
          let finalText = generatedText;
          if (!finalText.includes(buyUrl)) {
            finalText += `\n\n🛒 <b>Compre Aqui:</b> <a href="${buyUrl}">${buyUrl}</a>`;
          }
          return finalText;
        }
      } catch (err: any) {
        console.warn(`[Gemini AI] Falha ao gerar com modelo ${model}:`, err.response?.data?.error?.message || err.message);
      }
    }

    // Fallback gracioso para template padrão
    return CopyFormatter.formatTelegram(deal, channelId);
  }
}
