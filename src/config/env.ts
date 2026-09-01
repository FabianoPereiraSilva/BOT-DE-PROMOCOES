import dotenv from 'dotenv';
import path from 'path';
import { dbService } from '../database/db.js';
import { SystemSettings } from '../types/deal.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Lê as configurações do sistema a partir do cache em memória (síncrono).
 * O cache é populado pelo initDatabase() antes do servidor iniciar.
 */
export function getSystemSettings(): SystemSettings {
  const rawKeywords = dbService.getSetting('defaultKeywords', process.env.DEFAULT_KEYWORDS || '');
  let defaultKeywords: string[] = [];
  if (rawKeywords) {
    try {
      defaultKeywords = JSON.parse(rawKeywords);
    } catch {
      defaultKeywords = rawKeywords.split(',').map((k: string) => k.trim()).filter(Boolean);
    }
  }

  return {
    telegramBotToken: dbService.getSetting('telegramBotToken', process.env.TELEGRAM_BOT_TOKEN || ''),
    telegramChatId: dbService.getSetting('telegramChatId', process.env.TELEGRAM_CHAT_ID || ''),
    mercadolivreAffiliateTag: dbService.getSetting('mercadolivreAffiliateTag', process.env.MERCADOLIVRE_AFFILIATE_TAG || ''),
    shopeeAppId: dbService.getSetting('shopeeAppId', process.env.SHOPEE_APP_ID || ''),
    shopeeSecret: dbService.getSetting('shopeeSecret', process.env.SHOPEE_SECRET || ''),
    shopeeUniversalLinkPrefix: dbService.getSetting('shopeeUniversalLinkPrefix', process.env.SHOPEE_UNIVERSAL_LINK_PREFIX || 'https://s.shopee.com.br/'),
    autopilotEnabled: dbService.getSetting('autopilotEnabled', process.env.AUTOPILOT_ENABLED || 'false') === 'true',
    autopilotIntervalMinutes: parseInt(dbService.getSetting('autopilotIntervalMinutes', process.env.AUTOPILOT_INTERVAL_MINUTES || '20'), 10),
    minDiscountPercent: parseFloat(dbService.getSetting('minDiscountPercent', process.env.MIN_DISCOUNT_PERCENT || '20')),
    minPrice: parseFloat(dbService.getSetting('minPrice', process.env.MIN_PRICE || '15')),
    deduplicationHours: parseInt(dbService.getSetting('deduplicationHours', process.env.DEDUPLICATION_HOURS || '72'), 10),
    defaultCategory: dbService.getSetting('defaultCategory', process.env.DEFAULT_CATEGORY || 'esportes_suplementos'),
    defaultKeywords,
    customCopyTemplate: dbService.getSetting('customCopyTemplate', ''),
    appBaseUrl: dbService.getSetting('appBaseUrl', process.env.APP_BASE_URL || ''),
    peakHoursOnly: dbService.getSetting('peakHoursOnly', process.env.PEAK_HOURS_ONLY || 'false') === 'true',
    peakHoursRanges: dbService.getSetting('peakHoursRanges', process.env.PEAK_HOURS_RANGES || '07:30-09:30,11:45-14:00,18:30-22:30')
  };
}

/**
 * Persiste as configurações no PostgreSQL (async) e atualiza o cache.
 */
export async function updateSystemSettings(settings: Partial<SystemSettings>): Promise<SystemSettings> {
  const ops: Promise<void>[] = [];

  if (settings.telegramBotToken !== undefined) ops.push(dbService.setSetting('telegramBotToken', settings.telegramBotToken));
  if (settings.telegramChatId !== undefined) ops.push(dbService.setSetting('telegramChatId', settings.telegramChatId));
  if (settings.mercadolivreAffiliateTag !== undefined) ops.push(dbService.setSetting('mercadolivreAffiliateTag', settings.mercadolivreAffiliateTag));
  if (settings.shopeeAppId !== undefined) ops.push(dbService.setSetting('shopeeAppId', settings.shopeeAppId));
  if (settings.shopeeSecret !== undefined) ops.push(dbService.setSetting('shopeeSecret', settings.shopeeSecret));
  if (settings.shopeeUniversalLinkPrefix !== undefined) ops.push(dbService.setSetting('shopeeUniversalLinkPrefix', settings.shopeeUniversalLinkPrefix));
  if (settings.autopilotEnabled !== undefined) ops.push(dbService.setSetting('autopilotEnabled', settings.autopilotEnabled ? 'true' : 'false'));
  if (settings.autopilotIntervalMinutes !== undefined) ops.push(dbService.setSetting('autopilotIntervalMinutes', settings.autopilotIntervalMinutes.toString()));
  if (settings.minDiscountPercent !== undefined) ops.push(dbService.setSetting('minDiscountPercent', settings.minDiscountPercent.toString()));
  if (settings.minPrice !== undefined) ops.push(dbService.setSetting('minPrice', settings.minPrice.toString()));
  if (settings.deduplicationHours !== undefined) ops.push(dbService.setSetting('deduplicationHours', settings.deduplicationHours.toString()));
  if (settings.defaultCategory !== undefined) ops.push(dbService.setSetting('defaultCategory', settings.defaultCategory));
  if (settings.defaultKeywords !== undefined) ops.push(dbService.setSetting('defaultKeywords', JSON.stringify(settings.defaultKeywords)));
  if (settings.customCopyTemplate !== undefined) ops.push(dbService.setSetting('customCopyTemplate', settings.customCopyTemplate));
  if (settings.appBaseUrl !== undefined) ops.push(dbService.setSetting('appBaseUrl', settings.appBaseUrl.trim().replace(/\/$/, '')));
  if (settings.peakHoursOnly !== undefined) ops.push(dbService.setSetting('peakHoursOnly', settings.peakHoursOnly ? 'true' : 'false'));
  if (settings.peakHoursRanges !== undefined) ops.push(dbService.setSetting('peakHoursRanges', settings.peakHoursRanges));

  // Persiste todas as settings em paralelo
  await Promise.all(ops);

  return getSystemSettings();
}
