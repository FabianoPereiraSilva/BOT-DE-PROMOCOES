import dotenv from 'dotenv';
import path from 'path';
import { dbService } from '../database/db.js';
import { SystemSettings } from '../types/deal.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

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
    customCopyTemplate: dbService.getSetting('customCopyTemplate', '')
  };
}

export function updateSystemSettings(settings: Partial<SystemSettings>): SystemSettings {
  if (settings.telegramBotToken !== undefined) dbService.setSetting('telegramBotToken', settings.telegramBotToken);
  if (settings.telegramChatId !== undefined) dbService.setSetting('telegramChatId', settings.telegramChatId);
  if (settings.mercadolivreAffiliateTag !== undefined) dbService.setSetting('mercadolivreAffiliateTag', settings.mercadolivreAffiliateTag);
  if (settings.shopeeAppId !== undefined) dbService.setSetting('shopeeAppId', settings.shopeeAppId);
  if (settings.shopeeSecret !== undefined) dbService.setSetting('shopeeSecret', settings.shopeeSecret);
  if (settings.shopeeUniversalLinkPrefix !== undefined) dbService.setSetting('shopeeUniversalLinkPrefix', settings.shopeeUniversalLinkPrefix);
  if (settings.autopilotEnabled !== undefined) dbService.setSetting('autopilotEnabled', settings.autopilotEnabled ? 'true' : 'false');
  if (settings.autopilotIntervalMinutes !== undefined) dbService.setSetting('autopilotIntervalMinutes', settings.autopilotIntervalMinutes.toString());
  if (settings.minDiscountPercent !== undefined) dbService.setSetting('minDiscountPercent', settings.minDiscountPercent.toString());
  if (settings.minPrice !== undefined) dbService.setSetting('minPrice', settings.minPrice.toString());
  if (settings.deduplicationHours !== undefined) dbService.setSetting('deduplicationHours', settings.deduplicationHours.toString());
  if (settings.defaultCategory !== undefined) dbService.setSetting('defaultCategory', settings.defaultCategory);
  if (settings.defaultKeywords !== undefined) {
    dbService.setSetting('defaultKeywords', JSON.stringify(settings.defaultKeywords));
  }
  if (settings.customCopyTemplate !== undefined) dbService.setSetting('customCopyTemplate', settings.customCopyTemplate);

  return getSystemSettings();
}
