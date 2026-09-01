import { getSystemSettings } from '../config/env.js';
import { dbService } from '../database/db.js';
import { MercadoLivreHunter } from '../scrapers/mercadolivre-hunter.js';
import { ShopeeHunter } from '../scrapers/shopee-hunter.js';
import { TelegramPublisher } from '../publishers/telegram.js';
import { ChannelConfig, Deal } from '../types/deal.js';

export class AutopilotEngine {
  private static timer: NodeJS.Timeout | null = null;
  private static isRunning = false;
  private static lastRunTime: string | null = null;
  private static nextRunTime: string | null = null;

  /**
   * Inicializa o loop contínuo do piloto automático
   */
  static start() {
    const settings = getSystemSettings();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (!settings.autopilotEnabled) {
      dbService.addLog('info', 'Piloto Automático pausado nas configurações.');
      return;
    }

    const intervalMs = Math.max(settings.autopilotIntervalMinutes, 1) * 60 * 1000;
    this.scheduleNextRun(intervalMs);

    dbService.addLog('info', `Piloto Automático ativado! Ciclos a cada ${settings.autopilotIntervalMinutes} minutos.`);

    // Executa o primeiro ciclo após 5 segundos da inicialização
    setTimeout(() => {
      this.runSingleCycle().catch((err) => {
        console.error('Erro no ciclo inicial do Piloto Automático:', err);
      });
    }, 5000);

    this.timer = setInterval(() => {
      this.runSingleCycle().catch((err) => {
        console.error('Erro no ciclo periódico do Piloto Automático:', err);
      });
      this.scheduleNextRun(intervalMs);
    }, intervalMs);
  }

  /**
   * Pausa o piloto automático
   */
  static stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.nextRunTime = null;
    dbService.addLog('info', 'Piloto Automático desativado.');
  }

  /**
   * Atualiza a previsão da próxima execução
   */
  private static scheduleNextRun(intervalMs: number) {
    const nextDate = new Date(Date.now() + intervalMs);
    this.nextRunTime = nextDate.toLocaleTimeString('pt-BR');
  }

  /**
   * Executa um ciclo completo de caça e publicação por canal e nicho
   */
  static async runSingleCycle(force = false): Promise<{ success: boolean; dealsFound: number; dealsPosted: number; message: string }> {
    if (this.isRunning) {
      return { success: false, dealsFound: 0, dealsPosted: 0, message: 'Um ciclo já está em execução no momento.' };
    }

    this.isRunning = true;
    this.lastRunTime = new Date().toLocaleTimeString('pt-BR');

    const settings = getSystemSettings();
    const activeChannels = await dbService.getActiveChannels();

    // Se não há canais específicos cadastrados, usa o canal padrão com o nicho configurado
    const channelsToProcess: ChannelConfig[] = activeChannels.length > 0 ? activeChannels : (
      settings.telegramChatId ? [{
        id: 'default',
        name: 'Canal Principal',
        platform: 'telegram',
        chatId: settings.telegramChatId,
        category: settings.defaultCategory || 'esportes_suplementos',
        keywords: settings.defaultKeywords && settings.defaultKeywords.length > 0 ? settings.defaultKeywords : undefined,
        minDiscountPercent: settings.minDiscountPercent,
        minPrice: settings.minPrice,
        isActive: true
      }] : []
    );

    if (channelsToProcess.length === 0) {
      this.isRunning = false;
      const msg = 'Nenhum canal ou grupo ativo configurado. Adicione um canal no Painel Web para iniciar a publicação.';
      await dbService.addLog('warn', msg);
      return { success: false, dealsFound: 0, dealsPosted: 0, message: msg };
    }

    await dbService.addLog('info', `Iniciando varredura para ${channelsToProcess.length} canal(is) configurado(s)...`);

    let totalDealsFound = 0;
    let totalDealsPosted = 0;

    try {
      for (const channel of channelsToProcess) {
        await dbService.addLog('info', `Buscando ofertas para o canal: "${channel.name}" (Nicho: ${channel.category})...`);

        const minDisc = channel.minDiscountPercent || settings.minDiscountPercent;
        const minP = channel.minPrice || settings.minPrice;

        // Caça ofertas específicas do nicho do canal
        const [mlDeals, shopeeDeals] = await Promise.allSettled([
          MercadoLivreHunter.huntDeals(minDisc, minP, channel.category, channel.keywords),
          ShopeeHunter.huntDeals(minDisc, minP, channel.category, channel.keywords)
        ]);

        const channelDeals: Deal[] = [];
        if (mlDeals.status === 'fulfilled') channelDeals.push(...mlDeals.value);
        if (shopeeDeals.status === 'fulfilled') channelDeals.push(...shopeeDeals.value);

        totalDealsFound += channelDeals.length;

        // Ordena por maior desconto
        channelDeals.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));

        // Deduplicação: pré-busca hashes dos posts recentes no banco
        const hoursThreshold = settings.deduplicationHours || 72;
        const recentHashes = await dbService.getRecentPostedHashes(hoursThreshold);

        const freshDeals = channelDeals.filter(deal => {
          if (recentHashes.has(`id:${deal.id}`)) return false;
          const cleanUrl = (deal.originalUrl || '').split('?')[0].split('#')[0];
          if (cleanUrl.length > 10 && recentHashes.has(`url:${cleanUrl}`)) return false;
          const normTitle = deal.title.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
          if (normTitle.length > 5 && recentHashes.has(`title:${normTitle}`)) return false;
          return true;
        });

        if (freshDeals.length === 0) {
          await dbService.addLog('info', `[${channel.name}] Todas as ofertas caçadas já foram postadas recentemente (Deduplicação rigorosa ativa).`);
          continue;
        }

        // Seleciona a melhor oferta inédita para enviar a este canal
        const dealToPost = freshDeals[0];

        const pubResult = await TelegramPublisher.publishDeal(
          dealToPost,
          undefined,
          channel.chatId,
          channel.customBotToken
        );

        if (pubResult.success) {
          await dbService.recordPostedDeal({
            id: dealToPost.id,
            channelId: channel.id,
            category: channel.category,
            store: dealToPost.store,
            title: dealToPost.title,
            originalPrice: dealToPost.originalPrice,
            currentPrice: dealToPost.currentPrice,
            discountPercent: dealToPost.discountPercent,
            imageUrl: dealToPost.imageUrl,
            originalUrl: dealToPost.originalUrl,
            affiliateUrl: dealToPost.affiliateUrl,
            telegramMessageId: pubResult.messageId
          });
          totalDealsPosted++;
        }

        // Intervalo de segurança entre envios para canais diferentes
        await new Promise(res => setTimeout(res, 3000));
      }

      const summaryMsg = `Ciclo finalizado: ${totalDealsFound} ofertas analisadas em ${channelsToProcess.length} canais, ${totalDealsPosted} postadas com sucesso.`;
      await dbService.addLog('success', summaryMsg);

      this.isRunning = false;
      return {
        success: true,
        dealsFound: totalDealsFound,
        dealsPosted: totalDealsPosted,
        message: summaryMsg
      };
    } catch (err: any) {
      this.isRunning = false;
      await dbService.addLog('error', 'Erro durante o ciclo de varredura por canais', err.message);
      return {
        success: false,
        dealsFound: 0,
        dealsPosted: 0,
        message: `Erro: ${err.message}`
      };
    }
  }

  /**
   * Retorna o estado atual do piloto automático
   */
  static getStatus() {
    const settings = getSystemSettings();
    return {
      enabled: settings.autopilotEnabled,
      isCurrentlyRunningCycle: this.isRunning,
      intervalMinutes: settings.autopilotIntervalMinutes,
      lastRunTime: this.lastRunTime,
      nextRunTime: this.nextRunTime,
      minDiscountPercent: settings.minDiscountPercent,
      deduplicationHours: settings.deduplicationHours
    };
  }
}
