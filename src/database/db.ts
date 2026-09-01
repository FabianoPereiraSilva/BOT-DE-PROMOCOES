import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { PostedDealRecord, AutopilotLog, SystemSettings, ChannelConfig } from '../types/deal.js';

// Define database path
const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'deals_database.sqlite');
export const db = new Database(DB_PATH);

// Enable WAL mode for high concurrent performance
db.pragma('journal_mode = WAL');

// Initialize database schema with auto-migrations
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posted_deals (
      id TEXT,
      channel_id TEXT DEFAULT 'default',
      category TEXT DEFAULT 'geral',
      store TEXT NOT NULL,
      title TEXT NOT NULL,
      original_price REAL,
      current_price REAL NOT NULL,
      discount_percent REAL,
      image_url TEXT,
      original_url TEXT NOT NULL,
      affiliate_url TEXT NOT NULL,
      telegram_message_id TEXT,
      posted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'telegram',
      chat_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'geral',
      keywords TEXT,
      min_discount REAL NOT NULL DEFAULT 20,
      min_price REAL NOT NULL DEFAULT 15,
      is_active INTEGER NOT NULL DEFAULT 1,
      custom_bot_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT
    );
  `);

  // Migrações seguras de colunas existentes
  try {
    const tableInfo = db.prepare("PRAGMA table_info(posted_deals)").all() as any[];
    const columnNames = tableInfo.map(c => c.name);

    if (!columnNames.includes('channel_id')) {
      db.exec("ALTER TABLE posted_deals ADD COLUMN channel_id TEXT DEFAULT 'default'");
    }
    if (!columnNames.includes('category')) {
      db.exec("ALTER TABLE posted_deals ADD COLUMN category TEXT DEFAULT 'geral'");
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_posted_deals_store ON posted_deals(store);
      CREATE INDEX IF NOT EXISTS idx_posted_deals_channel ON posted_deals(channel_id);
      CREATE INDEX IF NOT EXISTS idx_posted_deals_posted_at ON posted_deals(posted_at);
    `);
  } catch (migErr) {
    // Continua caso já existam
  }
}

// Database Helper Functions
export const dbService = {
  // Check if deal was already posted anywhere within deduplication window
  isDealAlreadyPosted(deal: { id: string; originalUrl?: string; title?: string }, channelId = 'default', hoursThreshold = 72): boolean {
    const cleanId = deal.id;
    const cleanUrl = (deal.originalUrl || '').split('?')[0].split('#')[0];
    const normalizedTitle = (deal.title || '').toLowerCase().trim().replace(/[^a-z0-9]/g, ' ').split(/\s+/).slice(0, 5).join(' ');

    const stmt = db.prepare(`
      SELECT 1 FROM posted_deals 
      WHERE (
        id = ? 
        OR (length(?) > 10 AND original_url LIKE ?)
        OR (length(?) > 5 AND lower(title) LIKE ?)
      )
      AND datetime(posted_at) >= datetime('now', '-' || ? || ' hours')
      LIMIT 1
    `);

    const result = stmt.get(
      cleanId,
      cleanUrl,
      `%${cleanUrl}%`,
      normalizedTitle,
      `%${normalizedTitle}%`,
      hoursThreshold
    );

    return !!result;
  },

  // Record a posted deal
  recordPostedDeal(deal: {
    id: string;
    channelId?: string;
    category?: string;
    store: string;
    title: string;
    originalPrice?: number;
    currentPrice: number;
    discountPercent?: number;
    imageUrl: string;
    originalUrl: string;
    affiliateUrl: string;
    telegramMessageId?: string;
  }) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO posted_deals (
        id, channel_id, category, store, title, original_price, current_price, 
        discount_percent, image_url, original_url, affiliate_url, telegram_message_id, posted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    return stmt.run(
      deal.id,
      deal.channelId || 'default',
      deal.category || 'geral',
      deal.store,
      deal.title,
      deal.originalPrice || null,
      deal.currentPrice,
      deal.discountPercent || null,
      deal.imageUrl,
      deal.originalUrl,
      deal.affiliateUrl,
      deal.telegramMessageId || null
    );
  },

  // Get recent posted deals
  getRecentPostedDeals(limit = 50): PostedDealRecord[] {
    const stmt = db.prepare(`
      SELECT * FROM posted_deals 
      ORDER BY posted_at DESC 
      LIMIT ?
    `);
    return stmt.all(limit) as PostedDealRecord[];
  },

  // ==========================
  // CANAIS & NICHOS (CHANNELS)
  // ==========================
  getChannels(): ChannelConfig[] {
    const rows = db.prepare('SELECT * FROM channels ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      chatId: r.chat_id,
      category: r.category,
      keywords: r.keywords ? JSON.parse(r.keywords) : [],
      minDiscountPercent: r.min_discount,
      minPrice: r.min_price,
      isActive: r.is_active === 1,
      customBotToken: r.custom_bot_token || undefined,
      createdAt: r.created_at
    }));
  },

  getActiveChannels(): ChannelConfig[] {
    const rows = db.prepare('SELECT * FROM channels WHERE is_active = 1 ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      chatId: r.chat_id,
      category: r.category,
      keywords: r.keywords ? JSON.parse(r.keywords) : [],
      minDiscountPercent: r.min_discount,
      minPrice: r.min_price,
      isActive: true,
      customBotToken: r.custom_bot_token || undefined,
      createdAt: r.created_at
    }));
  },

  getChannelById(id: string): ChannelConfig | null {
    const r = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      platform: r.platform,
      chatId: r.chat_id,
      category: r.category,
      keywords: r.keywords ? JSON.parse(r.keywords) : [],
      minDiscountPercent: r.min_discount,
      minPrice: r.min_price,
      isActive: r.is_active === 1,
      customBotToken: r.custom_bot_token || undefined,
      createdAt: r.created_at
    };
  },

  saveChannel(channel: ChannelConfig) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO channels (
        id, name, platform, chat_id, category, keywords, min_discount, min_price, is_active, custom_bot_token, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM channels WHERE id = ?), datetime('now')))
    `);

    stmt.run(
      channel.id,
      channel.name,
      channel.platform || 'telegram',
      channel.chatId,
      channel.category || 'geral',
      channel.keywords ? JSON.stringify(channel.keywords) : '[]',
      channel.minDiscountPercent || 20,
      channel.minPrice || 15,
      channel.isActive ? 1 : 0,
      channel.customBotToken || null,
      channel.id
    );
  },

  deleteChannel(id: string) {
    return db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  },

  // Get total stats
  getStats() {
    const totalRow = db.prepare('SELECT COUNT(*) as total FROM posted_deals').get() as { total: number };
    const todayRow = db.prepare(`
      SELECT COUNT(*) as today FROM posted_deals 
      WHERE date(posted_at) = date('now')
    `).get() as { today: number };
    const shopeeRow = db.prepare(`
      SELECT COUNT(*) as shopee FROM posted_deals WHERE store = 'shopee'
    `).get() as { shopee: number };
    const mlRow = db.prepare(`
      SELECT COUNT(*) as ml FROM posted_deals WHERE store = 'mercadolivre'
    `).get() as { ml: number };
    const channelsRow = db.prepare('SELECT COUNT(*) as total FROM channels WHERE is_active = 1').get() as { total: number };

    return {
      totalPosted: totalRow.total || 0,
      postedToday: todayRow.today || 0,
      shopeeCount: shopeeRow.shopee || 0,
      mercadoLivreCount: mlRow.ml || 0,
      activeChannels: channelsRow.total || 0
    };
  },

  // Save or update settings in DB
  setSetting(key: string, value: string) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at) 
      VALUES (?, ?, datetime('now'))
    `);
    stmt.run(key, value);
  },

  // Get a specific setting or fallback
  getSetting(key: string, defaultValue = ''): string {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row ? row.value : defaultValue;
  },

  // Add system log
  addLog(level: 'info' | 'warn' | 'error' | 'success', message: string, details?: string) {
    const stmt = db.prepare(`
      INSERT INTO logs (level, message, details, timestamp)
      VALUES (?, ?, ?, datetime('now', 'localtime'))
    `);
    stmt.run(level, message, details || null);
  },

  // Get recent logs
  getLogs(limit = 100): AutopilotLog[] {
    const stmt = db.prepare(`
      SELECT id, timestamp, level, message, details 
      FROM logs 
      ORDER BY id DESC 
      LIMIT ?
    `);
    return stmt.all(limit) as AutopilotLog[];
  }
};

// Initialize DB schema on module load
initDatabase();
