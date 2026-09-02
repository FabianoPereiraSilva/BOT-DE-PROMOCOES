import axios from 'axios';
import FormData from 'form-data';
import { Deal } from '../types/deal.js';
import { getSystemSettings } from '../config/env.js';
import { CopyFormatter } from '../generator/copy-formatter.js';
import { BannerGenerator } from '../generator/banner-generator.js';
import { dbService } from '../database/db.js';

export class TelegramPublisher {
  /**
   * Obtém a URL base da API do Telegram Bot
   */
  private static getApiBase(botToken?: string): string {
    const token = botToken || getSystemSettings().telegramBotToken;
    if (!token) {
      throw new Error('Telegram Bot Token não está configurado!');
    }
    return `https://api.telegram.org/bot${token}`;
  }

  /**
   * Testa a conexão do bot com o Telegram
   */
  static async testConnection(botToken?: string, chatId?: string): Promise<{ success: boolean; botName?: string; error?: string }> {
    const settings = getSystemSettings();
    const token = botToken || settings.telegramBotToken;
    const chat = chatId || settings.telegramChatId;

    if (!token) {
      return { success: false, error: 'Token do Bot não informado!' };
    }

    try {
      // 1. Verifica dados do bot
      const meResp = await axios.get(`${this.getApiBase(token)}/getMe`, { timeout: 8000 });
      const botUser = meResp.data?.result;

      if (!botUser) {
        return { success: false, error: 'Resposta inválida do Telegram ao consultar o bot.' };
      }

      // 2. Se informou chatId, envia mensagem de teste
      if (chat) {
        try {
          await axios.post(`${this.getApiBase(token)}/sendMessage`, {
            chat_id: chat,
            text: `🤖 <b>Teste de Conexão com Sucesso!</b>\n\nO bot <b>@${botUser.username}</b> está pronto e conectado para publicar promoções no canal/grupo <code>${chat}</code>!`,
            parse_mode: 'HTML'
          }, { timeout: 8000 });
        } catch (chatErr: any) {
          const errMsg = chatErr.response?.data?.description || chatErr.message;
          return {
            success: false,
            botName: botUser.username,
            error: `Bot autenticado (@${botUser.username}), mas falhou ao enviar mensagem para o chat (${chat}): ${errMsg}. Certifique-se de adicionar o bot como Administrador!`
          };
        }
      }

      return {
        success: true,
        botName: botUser.username
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.description || err.message;
      return { success: false, error: `Erro na API do Telegram: ${errMsg}` };
    }
  }

  /**
   * Publica uma oferta completa no Telegram com Imagem Limpa Oficial do Produto e Botão de Compra
   */
  static async publishDeal(
    deal: Deal, 
    customImageBuffer?: Buffer,
    targetChatId?: string,
    customBotToken?: string,
    channelId?: string,
    customCaption?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const settings = getSystemSettings();
    const botToken = customBotToken || settings.telegramBotToken;
    const chatId = targetChatId || settings.telegramChatId;

    if (!botToken || !chatId) {
      const error = 'Telegram Bot Token ou Chat ID não configurados.';
      await dbService.addLog('error', 'Falha ao publicar no Telegram', error);
      return { success: false, error };
    }

    const buyUrl = CopyFormatter.getBuyUrl(deal, channelId);
    const caption = customCaption || (await CopyFormatter.formatTelegramWithAi(deal, channelId));
    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: '🔥 COMPRAR COM DESCONTO 🔥',
            url: buyUrl
          }
        ]
      ]
    };

    try {
      // 1. Se foi enviado um buffer personalizado (ex: upload manual)
      if (customImageBuffer) {
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('photo', customImageBuffer, { filename: 'produto.jpg', contentType: 'image/jpeg' });
        form.append('caption', caption);
        form.append('parse_mode', 'HTML');
        form.append('reply_markup', JSON.stringify(inlineKeyboard));

        const response = await axios.post(`${this.getApiBase(botToken)}/sendPhoto`, form, {
          headers: form.getHeaders(),
          timeout: 20000
        });

        const messageId = response.data?.result?.message_id?.toString();
        dbService.addLog('success', `Oferta postada no Telegram (${chatId}): "${deal.title.substring(0, 40)}..."`, `Message ID: ${messageId}`);
        return { success: true, messageId };
      }

      // 2. Envio com Foto Limpa Oficial do Produto (sem bordas/preços falsos)
      if (deal.imageUrl) {
        try {
          const response = await axios.post(`${this.getApiBase(botToken)}/sendPhoto`, {
            chat_id: chatId,
            photo: deal.imageUrl,
            caption,
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard
          }, { timeout: 15000 });

          const messageId = response.data?.result?.message_id?.toString();
          dbService.addLog('success', `Oferta postada no Telegram com foto do produto (${chatId}): "${deal.title.substring(0, 40)}..."`, `Message ID: ${messageId}`);
          return { success: true, messageId };
        } catch (photoErr: any) {
          console.warn('Erro ao enviar foto por URL, tentando download do buffer:', photoErr.message);
          // Tenta baixar a imagem e enviar como buffer se o Telegram rejeitar a URL direta
          try {
            const imgResp = await axios.get(deal.imageUrl, { responseType: 'arraybuffer', timeout: 10000 });
            const form = new FormData();
            form.append('chat_id', chatId);
            form.append('photo', Buffer.from(imgResp.data), { filename: 'produto.jpg', contentType: 'image/jpeg' });
            form.append('caption', caption);
            form.append('parse_mode', 'HTML');
            form.append('reply_markup', JSON.stringify(inlineKeyboard));

            const response = await axios.post(`${this.getApiBase(botToken)}/sendPhoto`, form, {
              headers: form.getHeaders(),
              timeout: 20000
            });

            const messageId = response.data?.result?.message_id?.toString();
            dbService.addLog('success', `Oferta postada no Telegram (${chatId}): "${deal.title.substring(0, 40)}..."`, `Message ID: ${messageId}`);
            return { success: true, messageId };
          } catch (bufferErr) {
            console.warn('Falha no fallback de foto, enviando como texto:', bufferErr);
          }
        }
      }

      // 3. Fallback: Envio em formato de texto simples
      const response = await axios.post(`${this.getApiBase(botToken)}/sendMessage`, {
        chat_id: chatId,
        text: caption,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard,
        disable_web_page_preview: false
      }, { timeout: 15000 });

      const messageId = response.data?.result?.message_id?.toString();
      dbService.addLog('success', `Oferta postada no Telegram em texto (${chatId}): "${deal.title.substring(0, 40)}..."`, `Message ID: ${messageId}`);
      return { success: true, messageId };
    } catch (err: any) {
      const errMsg = err.response?.data?.description || err.message;
      dbService.addLog('error', `Erro ao publicar no Telegram (${chatId}): ${deal.title.substring(0, 30)}`, errMsg);
      return { success: false, error: errMsg };
    }
  }
}
