import { Router, Request, Response } from 'express';
import { getSystemSettings, updateSystemSettings } from '../../config/env.js';
import { dbService } from '../../database/db.js';
import { MercadoLivreHunter } from '../../scrapers/mercadolivre-hunter.js';
import { ShopeeHunter } from '../../scrapers/shopee-hunter.js';
import { TelegramPublisher } from '../../publishers/telegram.js';
import { BannerGenerator } from '../../generator/banner-generator.js';
import { CopyFormatter } from '../../generator/copy-formatter.js';
import { AutopilotEngine } from '../../autopilot/engine.js';
import { CATEGORY_PRESETS } from '../../config/categories.js';
import { ChannelConfig, Deal } from '../../types/deal.js';
import crypto from 'crypto';

export const apiRouter = Router();

// 1. Status Geral do Sistema & Estatísticas
apiRouter.get('/status', (req: Request, res: Response) => {
  const stats = dbService.getStats();
  const autopilot = AutopilotEngine.getStatus();
  const settings = getSystemSettings();
  const channels = dbService.getChannels();

  res.json({
    success: true,
    stats,
    autopilot,
    configured: {
      telegram: !!(settings.telegramBotToken && (settings.telegramChatId || channels.length > 0)),
      mercadolivreTag: !!settings.mercadolivreAffiliateTag,
      shopeeAppId: !!settings.shopeeAppId,
      channelsCount: channels.length
    }
  });
});

// 2. Presets de Categorias & Nichos
apiRouter.get('/categories', (req: Request, res: Response) => {
  res.json({
    success: true,
    categories: Object.values(CATEGORY_PRESETS)
  });
});

// 3. Canais & Grupos CRUD
apiRouter.get('/channels', (req: Request, res: Response) => {
  const channels = dbService.getChannels();
  res.json({ success: true, channels });
});

apiRouter.post('/channels', (req: Request, res: Response) => {
  const { id, name, platform, chatId, category, keywords, minDiscountPercent, minPrice, isActive, customBotToken } = req.body;

  if (!name || !chatId) {
    return res.status(400).json({ success: false, error: 'Nome e ID do Canal/Grupo são obrigatórios.' });
  }

  const channelId = id || `ch_${crypto.randomUUID().substring(0, 8)}`;

  const channel: ChannelConfig = {
    id: channelId,
    name: name.trim(),
    platform: platform || 'telegram',
    chatId: chatId.trim(),
    category: category || 'geral',
    keywords: Array.isArray(keywords) ? keywords : (typeof keywords === 'string' ? keywords.split(',').map((k: string) => k.trim()).filter(Boolean) : []),
    minDiscountPercent: Number(minDiscountPercent) || 20,
    minPrice: Number(minPrice) || 15,
    isActive: isActive !== false,
    customBotToken: customBotToken ? customBotToken.trim() : undefined
  };

  dbService.saveChannel(channel);
  res.json({ success: true, channel });
});

apiRouter.delete('/channels/:id', (req: Request, res: Response) => {
  dbService.deleteChannel(req.params.id);
  res.json({ success: true });
});

apiRouter.post('/channels/:id/test', async (req: Request, res: Response) => {
  const channel = dbService.getChannelById(req.params.id);
  if (!channel) {
    return res.status(404).json({ success: false, error: 'Canal não encontrado.' });
  }

  const result = await TelegramPublisher.testConnection(channel.customBotToken, channel.chatId);
  res.json(result);
});

// 4. Obter Configurações Gerais
apiRouter.get('/settings', (req: Request, res: Response) => {
  const settings = getSystemSettings();
  res.json({
    success: true,
    settings: {
      ...settings,
      telegramBotToken: settings.telegramBotToken ? `${settings.telegramBotToken.substring(0, 8)}...` : ''
    }
  });
});

// 5. Atualizar Configurações Gerais
apiRouter.post('/settings', (req: Request, res: Response) => {
  const payload = req.body;
  
  if (payload.telegramBotToken && payload.telegramBotToken.includes('...')) {
    delete payload.telegramBotToken;
  }

  const updated = updateSystemSettings(payload);

  if (payload.autopilotEnabled !== undefined) {
    if (payload.autopilotEnabled) {
      AutopilotEngine.start();
    } else {
      AutopilotEngine.stop();
    }
  }

  res.json({ success: true, settings: updated });
});

// 6. Testar Conexão com Telegram
apiRouter.post('/test-telegram', async (req: Request, res: Response) => {
  const { botToken, chatId } = req.body;
  const result = await TelegramPublisher.testConnection(botToken, chatId);
  res.json(result);
});

// 7. Extração de Produto para Postagem Rápida (Quick Post)
apiRouter.post('/quick-post/extract', async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, error: 'URL do produto não fornecida.' });
  }

  try {
    let deal: Deal | null = null;

    if (url.includes('mercadolivre.com') || url.includes('mercadolibre.com') || url.includes('meli.la')) {
      deal = await MercadoLivreHunter.extractProductFromUrl(url);
    } else if (url.includes('shopee.com.br') || url.includes('shp.ee')) {
      deal = await ShopeeHunter.extractProductFromUrl(url);
    } else {
      return res.status(400).json({
        success: false,
        error: 'Link inválido. Insira um link válido da Shopee ou Mercado Livre.'
      });
    }

    if (!deal) {
      return res.status(404).json({
        success: false,
        error: 'Não foi possível extrair os dados do produto. Verifique o link e tente novamente.'
      });
    }

    const previewCopy = CopyFormatter.formatTelegram(deal);

    res.json({
      success: true,
      deal,
      previewCopy
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Gerar e Visualizar Imagem do Banner em Tempo Real
apiRouter.post('/quick-post/preview-banner', async (req: Request, res: Response) => {
  try {
    const deal: Deal = req.body;
    if (!deal || !deal.title || !deal.currentPrice) {
      return res.status(400).json({ success: false, error: 'Dados da oferta incompletos.' });
    }

    const bannerBuffer = await BannerGenerator.generateSquareBanner(deal);
    res.set('Content-Type', 'image/jpeg');
    res.send(bannerBuffer);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Publicar Oferta Manualmente (Quick Post para 1 ou múltiplos canais)
apiRouter.post('/quick-post/publish', async (req: Request, res: Response) => {
  try {
    const { deal, targetChatId, channelId } = req.body;
    const dealData: Deal = deal || req.body;

    if (!dealData || !dealData.title || !dealData.currentPrice) {
      return res.status(400).json({ success: false, error: 'Dados da oferta incompletos.' });
    }

    const settings = getSystemSettings();
    let targetChat = targetChatId;
    let customToken: string | undefined;

    // Resolução do canal de destino
    if (channelId && channelId !== 'default' && channelId !== 'all') {
      const channel = dbService.getChannelById(channelId);
      if (channel) {
        targetChat = channel.chatId;
        customToken = channel.customBotToken;
      }
    }

    // Se ainda não tem targetChat, usa o chat principal ou o primeiro canal ativo
    if (!targetChat) {
      const activeChannels = dbService.getActiveChannels();
      targetChat = settings.telegramChatId || (activeChannels.length > 0 ? activeChannels[0].chatId : undefined);
    }

    if (!targetChat) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum canal do Telegram configurado. Configure o Chat ID nas configurações ou cadastre um canal.'
      });
    }

    const result = await TelegramPublisher.publishDeal(dealData, undefined, targetChat, customToken);

    if (result.success) {
      dbService.recordPostedDeal({
        id: dealData.id,
        channelId: channelId || 'manual',
        category: dealData.category || 'geral',
        store: dealData.store,
        title: dealData.title,
        originalPrice: dealData.originalPrice,
        currentPrice: dealData.currentPrice,
        discountPercent: dealData.discountPercent,
        imageUrl: dealData.imageUrl,
        originalUrl: dealData.originalUrl,
        affiliateUrl: dealData.affiliateUrl,
        telegramMessageId: result.messageId
      });
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Visualizar Ofertas Caçadas ao Vivo (Hunter Live Stream por Categoria ou Marca)
apiRouter.get('/deals/hunter-preview', async (req: Request, res: Response) => {
  const category = (req.query.category as string) || 'geral';
  const query = (req.query.query as string) || '';
  const settings = getSystemSettings();

  try {
    const [mlDeals, shopeeDeals] = await Promise.allSettled([
      MercadoLivreHunter.huntDeals(settings.minDiscountPercent, settings.minPrice, category, [], query),
      ShopeeHunter.huntDeals(settings.minDiscountPercent, settings.minPrice, category, [], query)
    ]);

    const deals: Deal[] = [];
    if (mlDeals.status === 'fulfilled') deals.push(...mlDeals.value);
    if (shopeeDeals.status === 'fulfilled') deals.push(...shopeeDeals.value);

    deals.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));

    res.json({
      success: true,
      category,
      query,
      count: deals.length,
      deals
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Disparo Forçado do Ciclo do Piloto Automático
apiRouter.post('/autopilot/trigger', async (req: Request, res: Response) => {
  const result = await AutopilotEngine.runSingleCycle(true);
  res.json(result);
});

// 12. Histórico de Ofertas Postadas
apiRouter.get('/deals/recent', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const deals = dbService.getRecentPostedDeals(limit);
  res.json({ success: true, deals });
});

// 13. Logs do Sistema em Tempo Real
apiRouter.get('/logs', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string, 10) || 100;
  const logs = dbService.getLogs(limit);
  res.json({ success: true, logs });
});
