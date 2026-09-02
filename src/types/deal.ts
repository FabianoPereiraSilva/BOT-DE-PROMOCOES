export type StoreSource = 'shopee' | 'mercadolivre';

export interface Deal {
  id: string; // unique hash or store product ID
  store: StoreSource;
  title: string;
  originalPrice?: number;
  currentPrice: number;
  discountPercent?: number;
  imageUrl: string;
  originalUrl: string;
  affiliateUrl: string;
  rating?: number;
  reviewCount?: number;
  freeShipping?: boolean;
  couponCode?: string;
  installments?: string;
  category?: string;
  postedAt?: string;
}

export interface PostedDealRecord {
  id: string;
  store: string;
  title: string;
  original_price: number | null;
  current_price: number;
  discount_percent: number | null;
  image_url: string;
  original_url: string;
  affiliate_url: string;
  telegram_message_id: string | null;
  channel_id?: string | null;
  category?: string | null;
  posted_at: string;
}

export interface ChannelConfig {
  id: string;
  name: string;
  platform: 'telegram' | 'whatsapp' | 'instagram';
  chatId: string;
  category: string; // key from categories.ts (ex: esportes_suplementos, eletronicos_tech, geral)
  keywords?: string[];
  minDiscountPercent: number;
  minPrice: number;
  isActive: boolean;
  customBotToken?: string;
  createdAt?: string;
}

export interface SystemSettings {
  telegramBotToken: string;
  telegramChatId: string;
  mercadolivreAffiliateTag: string;
  shopeeAppId: string;
  shopeeSecret: string;
  shopeeUniversalLinkPrefix: string;
  autopilotEnabled: boolean;
  autopilotIntervalMinutes: number;
  minDiscountPercent: number;
  minPrice: number;
  deduplicationHours: number;
  defaultCategory?: string;
  defaultKeywords?: string[];
  customCopyTemplate?: string;
  appBaseUrl?: string; // URL pública do servidor (ex: https://meubot.onrender.com) para links de rastreamento
  peakHoursOnly?: boolean; // Se verdadeiro, só publica nas janelas de pico
  peakHoursRanges?: string; // Ex: "07:30-09:30,11:45-14:00,18:30-22:30"
  geminiApiKey?: string; // Chave de API do Google Gemini
  geminiAiEnabled?: boolean; // Se verdadeiro, usa Gemini IA para gerar copies dos posts
}

export interface AutopilotLog {
  id?: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details?: string;
}

export interface ClickRecord {
  id?: number;
  dealId: string;
  channelId?: string;
  targetUrl: string;
  ipHash?: string;
  userAgent?: string;
  referer?: string;
  clickedAt?: string;
}

export interface TopClickedDeal {
  dealId: string;
  title: string;
  store: string;
  currentPrice: number;
  imageUrl?: string;
  clicks: number;
  lastClickedAt: string;
}

export interface ClickAnalyticsSummary {
  totalClicks: number;
  clicksToday: number;
  clicksLast7Days: number;
  topDeals: TopClickedDeal[];
}

