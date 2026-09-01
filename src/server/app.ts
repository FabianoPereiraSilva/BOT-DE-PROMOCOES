import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './routes/api.js';
import { getSystemSettings } from '../config/env.js';
import { AutopilotEngine } from '../autopilot/engine.js';
import { initDatabase } from '../database/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir arquivos estáticos da interface web
const publicDir = path.resolve(process.cwd(), 'src', 'public');
app.use(express.static(publicDir));

// Rotas da API
app.use('/api', apiRouter);

// Fallback para SPA
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ============================================================
// Inicialização Assíncrona do Servidor
// ============================================================
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function bootstrap() {
  try {
    console.log('====================================================');
    console.log('🚀 BOT DE PROMOÇÕES (SHOPEE & MERCADO LIVRE → TELEGRAM)');
    console.log('====================================================');

    // 1. Conecta ao PostgreSQL e inicializa schema + cache de settings
    console.log('⏳ Conectando ao PostgreSQL (Supabase)...');
    await initDatabase();

    // 2. Inicia o servidor HTTP
    app.listen(Number(PORT), HOST, async () => {
      console.log(`🌐 Painel Web: http://localhost:${PORT}`);
      console.log('====================================================');

      // 3. Inicia o piloto automático se habilitado
      const settings = getSystemSettings();
      if (settings.autopilotEnabled) {
        AutopilotEngine.start();
      } else {
        console.log('ℹ️  Piloto automático pausado. Ative pelo Painel Web para iniciar a caça 24/7.');
      }
    });

  } catch (err: any) {
    console.error('❌ Falha crítica ao iniciar o servidor:', err.message);
    process.exit(1);
  }
}

bootstrap();
