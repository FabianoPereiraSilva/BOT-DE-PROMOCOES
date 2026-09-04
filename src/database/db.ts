import dotenv from 'dotenv';
import path from 'path';
import dns from 'dns';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Força resolução DNS via IPv4 (corrige ENETUNREACH no Render/Supabase)
dns.setDefaultResultOrder('ipv4first');

import { Pool, PoolClient } from 'pg';
import { PostedDealRecord, AutopilotLog, SystemSettings, ChannelConfig } from '../types/deal.js';

// ============================================================
// POOL DE CONEXÃO COM POSTGRESQL (SUPABASE)
// ============================================================
const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL não configurado! Usando fallback de desenvolvimento.');
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error('PostgreSQL Pool Error:', err.message);
});

// ============================================================
// CACHE IN-MEMORY DE SETTINGS (evita query a cada leitura)
// ============================================================
let settingsCache = new Map<string, string>();
let settingsCacheLoaded = false;

async function loadSettingsCache(client: PoolClient) {
  const result = await client.query('SELECT key, value FROM settings');
  settingsCache = new Map(result.rows.map((r: any) => [r.key, r.value]));
  settingsCacheLoaded = true;
}

// ============================================================
// INICIALIZAÇÃO DO SCHEMA DO BANCO
// ============================================================
export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    // Cria todas as tabelas se não existirem
    await client.query(`
      CREATE TABLE IF NOT EXISTS posted_deals (
        id TEXT NOT NULL,
        channel_id TEXT NOT NULL DEFAULT 'default',
        category TEXT DEFAULT 'geral',
        store TEXT NOT NULL,
        title TEXT NOT NULL,
        original_price NUMERIC,
        current_price NUMERIC NOT NULL,
        discount_percent NUMERIC,
        image_url TEXT,
        original_url TEXT NOT NULL,
        affiliate_url TEXT NOT NULL,
        telegram_message_id TEXT,
        posted_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (id, channel_id)
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'telegram',
        chat_id TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'geral',
        keywords TEXT,
        min_discount NUMERIC NOT NULL DEFAULT 20,
        min_price NUMERIC NOT NULL DEFAULT 15,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        custom_bot_token TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT
      );

      CREATE TABLE IF NOT EXISTS clicks (
        id SERIAL PRIMARY KEY,
        deal_id TEXT NOT NULL,
        channel_id TEXT DEFAULT 'default',
        target_url TEXT NOT NULL,
        ip_hash TEXT,
        user_agent TEXT,
        referer TEXT,
        clicked_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Migração: converte is_active de INTEGER para BOOLEAN (se a coluna ainda for integer)
    try {
      const colType = await client.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'channels' AND column_name = 'is_active'
      `);
      if (colType.rows.length > 0 && colType.rows[0].data_type === 'integer') {
        console.log('🔄 Migrando coluna is_active de INTEGER para BOOLEAN...');
        await client.query(`
          ALTER TABLE channels
          ALTER COLUMN is_active DROP DEFAULT,
          ALTER COLUMN is_active TYPE BOOLEAN USING (is_active = 1),
          ALTER COLUMN is_active SET DEFAULT TRUE
        `);
        console.log('✅ Migração is_active concluída com sucesso!');
      }
    } catch (migErr: any) {
      console.warn('⚠️ Migração is_active ignorada (pode já estar em BOOLEAN):', migErr.message);
    }

    // Índices para performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_posted_deals_store ON posted_deals(store);
      CREATE INDEX IF NOT EXISTS idx_posted_deals_channel ON posted_deals(channel_id);
      CREATE INDEX IF NOT EXISTS idx_posted_deals_posted_at ON posted_deals(posted_at);
      CREATE INDEX IF NOT EXISTS idx_clicks_deal_id ON clicks(deal_id);
      CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);
    `);

    // Carrega o cache de settings
    await loadSettingsCache(client);

    console.log('✅ PostgreSQL (Supabase) conectado e schema inicializado com sucesso!');
  } catch (err: any) {
    console.error('❌ Erro ao inicializar banco de dados PostgreSQL:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// dbService - API ASSÍNCRONA COMPLETA
// ============================================================
export const dbService = {

  // ── DEDUPLICAÇÃO ──────────────────────────────────────────
  /**
   * Retorna um Set com hashes recentes (ID + URL limpa + título normalizado)
   * usado para filtrar duplicatas de forma eficiente no ciclo do autopilot.
   * Utiliza até 10 palavras do título para evitar falsos positivos com produtos de marcas parecidas.
   */
  async getRecentPostedHashes(hoursThreshold = 72): Promise<Set<string>> {
    const result = await pool.query(
      `SELECT id, original_url, title FROM posted_deals
       WHERE posted_at >= NOW() - INTERVAL '${hoursThreshold} hours'`
    );

    const hashes = new Set<string>();
    for (const row of result.rows) {
      if (row.id) hashes.add(`id:${row.id}`);
      if (row.original_url) {
        const cleanUrl = row.original_url.split('?')[0].split('#')[0];
        if (cleanUrl.length > 10) hashes.add(`url:${cleanUrl}`);
      }
      if (row.title) {
        // Usa até 10 palavras significativas em vez de 5, reduzindo falsos descartes
        const normTitle = row.title
          .toLowerCase()
          .replace(/[^a-z0-9]/g, ' ')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 10)
          .join(' ');
        if (normTitle.length > 8) hashes.add(`title:${normTitle}`);
      }
    }
    return hashes;
  },

  // ── MANUTENÇÃO & LIMPEZA AUTOMÁTICA ───────────────────────
  /**
   * Remove logs e cliques com mais de X dias para manter o PostgreSQL enxuto e rápido.
   */
  async cleanupOldData(daysThreshold = 30): Promise<{ logsRemoved: number; clicksRemoved: number }> {
    try {
      const logsResult = await pool.query(
        `DELETE FROM logs WHERE timestamp < NOW() - INTERVAL '${daysThreshold} days'`
      );
      const clicksResult = await pool.query(
        `DELETE FROM clicks WHERE created_at < NOW() - INTERVAL '${daysThreshold} days'`
      );

      return {
        logsRemoved: logsResult.rowCount || 0,
        clicksRemoved: clicksResult.rowCount || 0
      };
    } catch (err: any) {
      console.warn('[CLEANUP] Erro ao limpar dados antigos:', err.message);
      return { logsRemoved: 0, clicksRemoved: 0 };
    }
  },

  // ── DEALS POSTADOS ────────────────────────────────────────
  async recordPostedDeal(deal: {
    id: string;
    channelId?: string;
    category?: string;
    store: string;
    title: string;
    originalPrice?: number;
    currentPrice: number;
    discountPercent?: number;
    imageUrl?: string;
    originalUrl: string;
    affiliateUrl: string;
    telegramMessageId?: string;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO posted_deals (
        id, channel_id, category, store, title, original_price, current_price,
        discount_percent, image_url, original_url, affiliate_url, telegram_message_id, posted_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
      ON CONFLICT (id, channel_id) DO UPDATE SET
        current_price = EXCLUDED.current_price,
        posted_at = NOW()`,
      [
        deal.id,
        deal.channelId || 'default',
        deal.category || 'geral',
        deal.store,
        deal.title,
        deal.originalPrice ?? null,
        deal.currentPrice,
        deal.discountPercent ?? null,
        deal.imageUrl ?? null,
        deal.originalUrl,
        deal.affiliateUrl,
        deal.telegramMessageId ?? null
      ]
    );
  },

  async getRecentPostedDeals(limit = 50): Promise<PostedDealRecord[]> {
    const result = await pool.query(
      'SELECT * FROM posted_deals ORDER BY posted_at DESC LIMIT $1',
      [limit]
    );
    return result.rows as PostedDealRecord[];
  },

  // ── CANAIS & NICHOS ───────────────────────────────────────
  async ensureDefaultChannel(): Promise<void> {
    try {
      const rawChatId = this.getSetting('telegramChatId', process.env.TELEGRAM_CHAT_ID || '');
      if (!rawChatId) return;

      const existing = await pool.query('SELECT 1 FROM channels WHERE chat_id = $1', [rawChatId]);
      if (existing.rowCount === 0) {
        const defaultCat = this.getSetting('defaultCategory', process.env.DEFAULT_CATEGORY || 'esportes_suplementos');
        const rawKw = this.getSetting('defaultKeywords', process.env.DEFAULT_KEYWORDS || '');
        let kw = ['creatina', 'whey protein', 'suplemento', 'growth', 'soldiers nutrition'];
        if (rawKw) {
          try { kw = JSON.parse(rawKw); } catch { kw = rawKw.split(',').map((k: string) => k.trim()).filter(Boolean); }
        }

        await this.saveChannel({
          id: 'ch_fppromocoes',
          name: 'FP PROMOÇÕES (Canal Atual)',
          platform: 'telegram',
          chatId: rawChatId,
          category: defaultCat,
          keywords: kw,
          minDiscountPercent: 20,
          minPrice: 15,
          isActive: true
        });
      }
    } catch (err: any) {
      console.warn('⚠️ Erro ao garantir canal padrão:', err.message);
    }
  },

  async getChannels(): Promise<ChannelConfig[]> {
    await this.ensureDefaultChannel();
    const result = await pool.query('SELECT * FROM channels ORDER BY created_at DESC');
    return result.rows.map((r: any) => this._mapChannel(r));
  },

  async getActiveChannels(): Promise<ChannelConfig[]> {
    await this.ensureDefaultChannel();
    const result = await pool.query('SELECT * FROM channels WHERE is_active = TRUE ORDER BY created_at DESC');
    return result.rows.map((r: any) => this._mapChannel(r));
  },

  async getChannelById(id: string): Promise<ChannelConfig | null> {
    const result = await pool.query('SELECT * FROM channels WHERE id = $1', [id]);
    if (result.rowCount === 0) return null;
    return this._mapChannel(result.rows[0]);
  },

  async saveChannel(channel: ChannelConfig): Promise<void> {
    await pool.query(
      `INSERT INTO channels (id, name, platform, chat_id, category, keywords, min_discount, min_price, is_active, custom_bot_token, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         platform = EXCLUDED.platform,
         chat_id = EXCLUDED.chat_id,
         category = EXCLUDED.category,
         keywords = EXCLUDED.keywords,
         min_discount = EXCLUDED.min_discount,
         min_price = EXCLUDED.min_price,
         is_active = EXCLUDED.is_active,
         custom_bot_token = EXCLUDED.custom_bot_token`,
      [
        channel.id,
        channel.name,
        channel.platform || 'telegram',
        channel.chatId,
        channel.category || 'geral',
        channel.keywords ? JSON.stringify(channel.keywords) : '[]',
        channel.minDiscountPercent || 20,
        channel.minPrice || 15,
        Boolean(channel.isActive),
        channel.customBotToken || null
      ]
    );
  },

  async deleteChannel(id: string): Promise<void> {
    await pool.query('DELETE FROM channels WHERE id = $1', [id]);
  },

  // ── BUSCA DE DEAL POR ID ──────────────────────────────────
  async getDealById(id: string): Promise<PostedDealRecord | null> {
    const result = await pool.query(
      'SELECT * FROM posted_deals WHERE id = $1 ORDER BY posted_at DESC LIMIT 1',
      [id]
    );
    if (result.rowCount === 0) return null;
    return result.rows[0] as PostedDealRecord;
  },

  // ── RASTREAMENTO DE CLIQUES (CLICKS & ANALYTICS) ───────────
  async recordClick(params: {
    dealId: string;
    channelId?: string;
    targetUrl: string;
    ipHash?: string;
    userAgent?: string;
    referer?: string;
  }): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO clicks (deal_id, channel_id, target_url, ip_hash, user_agent, referer, clicked_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          params.dealId,
          params.channelId || 'default',
          params.targetUrl,
          params.ipHash || null,
          params.userAgent ? params.userAgent.substring(0, 500) : null,
          params.referer ? params.referer.substring(0, 500) : null
        ]
      );
    } catch (err: any) {
      console.error('Erro ao gravar clique:', err.message);
    }
  },

  async getClicksStats(): Promise<{
    totalClicks: number;
    clicksToday: number;
    clicksLast7Days: number;
  }> {
    const [totalRes, todayRes, last7Res] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM clicks'),
      pool.query('SELECT COUNT(*) as today FROM clicks WHERE DATE(clicked_at) = CURRENT_DATE'),
      pool.query("SELECT COUNT(*) as last7 FROM clicks WHERE clicked_at >= NOW() - INTERVAL '7 days'")
    ]);

    return {
      totalClicks: parseInt(totalRes.rows[0]?.total || '0'),
      clicksToday: parseInt(todayRes.rows[0]?.today || '0'),
      clicksLast7Days: parseInt(last7Res.rows[0]?.last7 || '0')
    };
  },

  async getTopClickedDeals(limit = 10): Promise<{
    dealId: string;
    title: string;
    store: string;
    currentPrice: number;
    imageUrl?: string;
    clicks: number;
    lastClickedAt: string;
  }[]> {
    const query = `
      SELECT 
        c.deal_id as "dealId",
        COALESCE(d.title, 'Oferta #' || c.deal_id) as "title",
        COALESCE(d.store, 'geral') as "store",
        COALESCE(d.current_price, 0) as "currentPrice",
        d.image_url as "imageUrl",
        COUNT(c.id) as "clicks",
        MAX(c.clicked_at) as "lastClickedAt"
      FROM clicks c
      LEFT JOIN posted_deals d ON c.deal_id = d.id
      GROUP BY c.deal_id, d.title, d.store, d.current_price, d.image_url
      ORDER BY "clicks" DESC
      LIMIT $1
    `;
    const result = await pool.query(query, [limit]);
    return result.rows.map((r: any) => ({
      dealId: r.dealId,
      title: r.title,
      store: r.store,
      currentPrice: parseFloat(r.currentPrice || '0'),
      imageUrl: r.imageUrl || undefined,
      clicks: parseInt(r.clicks || '0'),
      lastClickedAt: r.lastClickedAt
    }));
  },

  // ── ESTATÍSTICAS ──────────────────────────────────────────
  async getStats() {
    await this.ensureDefaultChannel();
    const [totalRes, todayRes, shopeeRes, mlRes, channelsRes, clicksStats] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM posted_deals'),
      pool.query("SELECT COUNT(*) as today FROM posted_deals WHERE DATE(posted_at) = CURRENT_DATE"),
      pool.query("SELECT COUNT(*) as shopee FROM posted_deals WHERE store = 'shopee'"),
      pool.query("SELECT COUNT(*) as ml FROM posted_deals WHERE store = 'mercadolivre'"),
      pool.query('SELECT COUNT(*) as total FROM channels WHERE is_active = TRUE'),
      this.getClicksStats()
    ]);

    return {
      totalPosted: parseInt(totalRes.rows[0]?.total || '0'),
      postedToday: parseInt(todayRes.rows[0]?.today || '0'),
      shopeeCount: parseInt(shopeeRes.rows[0]?.shopee || '0'),
      mercadoLivreCount: parseInt(mlRes.rows[0]?.ml || '0'),
      activeChannels: parseInt(channelsRes.rows[0]?.total || '0'),
      totalClicks: clicksStats.totalClicks,
      clicksToday: clicksStats.clicksToday,
      clicksLast7Days: clicksStats.clicksLast7Days
    };
  },

  // ── SETTINGS (cache em memória para leitura síncrona) ─────
  /**
   * Leitura SÍNCRONA do cache de settings.
   * O cache é populado no initDatabase() antes do servidor aceitar requisições.
   */
  getSetting(key: string, defaultValue = ''): string {
    return settingsCache.get(key) ?? defaultValue;
  },

  /**
   * Escrita ASSÍNCRONA: persiste no PG e atualiza o cache local.
   */
  async setSetting(key: string, value: string): Promise<void> {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );
    settingsCache.set(key, value);
  },

  // ── LOGS ──────────────────────────────────────────────────
  async addLog(level: 'info' | 'warn' | 'error' | 'success', message: string, details?: string): Promise<void> {
    try {
      await pool.query(
        'INSERT INTO logs (level, message, details, timestamp) VALUES ($1,$2,$3, NOW())',
        [level, message, details ?? null]
      );
    } catch {
      // Log de banco não pode derrubar o sistema
      console.error(`[LOG FAIL] ${level}: ${message}`);
    }
  },

  async getLogs(limit = 100): Promise<AutopilotLog[]> {
    const result = await pool.query(
      'SELECT id, timestamp, level, message, details FROM logs ORDER BY id DESC LIMIT $1',
      [limit]
    );
    return result.rows as AutopilotLog[];
  },

  // ── HELPER INTERNO ────────────────────────────────────────
  _mapChannel(r: any): ChannelConfig {
    return {
      id: r.id,
      name: r.name,
      platform: r.platform,
      chatId: r.chat_id,
      category: r.category,
      keywords: r.keywords ? JSON.parse(r.keywords) : [],
      minDiscountPercent: parseFloat(r.min_discount),
      minPrice: parseFloat(r.min_price),
      isActive: r.is_active === true || r.is_active === 1 || r.is_active === 't',
      customBotToken: r.custom_bot_token || undefined,
      createdAt: r.created_at
    };
  }
};
