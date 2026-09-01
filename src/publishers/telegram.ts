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
   * Publica uma oferta completa no Telegram com Banner Gerado e Botão de Compra
   */
  static async publishDeal(
    deal: Deal, 
    customBannerBuffer?: Buffer,
    targetChatId?: string,
    customBotToken?: string,
    channelId?: string
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
    const caption = CopyFormatter.formatTelegram(deal, channelId);
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
      // 1. Gera o banner promocional se não fornecido
      let bannerBuffer = customBannerBuffer;
      if (!bannerBuffer) {
        try {
          bannerBuffer = await BannerGenerator.generateSquareBanner(deal);
        } catch (bannerErr) {
          console.warn('Erro ao gerar banner, tentando imagem original ou texto:', bannerErr);
        }
      }

      // 2. Envio com Foto (Banner)
      if (bannerBuffer) {
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('photo', bannerBuffer, { filename: 'promocao.jpg', contentType: 'image/jpeg' });
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

      // 3. Fallback: Envio apenas com link da imagem remota
      if (deal.imageUrl) {
        const response = await axios.post(`${this.getApiBase(botToken)}/sendPhoto`, {
          chat_id: chatId,
          photo: deal.imageUrl,
          caption,
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard
        }, { timeout: 15000 });

        const messageId = response.data?.result?.message_id?.toString();
        dbService.addLog('success', `Oferta postada no Telegram com imagem remota (${chatId}): "${deal.title.substring(0, 40)}..."`, `Message ID: ${messageId}`);
        return { success: true, messageId };
      }

      // 4. Fallback: Envio em formato de texto simples
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
