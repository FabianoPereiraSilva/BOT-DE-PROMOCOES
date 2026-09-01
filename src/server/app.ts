import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './routes/api.js';
import { getSystemSettings } from '../config/env.js';
import { AutopilotEngine } from '../autopilot/engine.js';
import { dbService } from '../database/db.js';

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

// Inicialização do Servidor
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(Number(PORT), HOST, () => {
  console.log('====================================================');
  console.log(`🚀 BOT DE PROMOÇÕES (SHOPEE & MERCADO LIVRE -> TELEGRAM)`);
  console.log(`🌐 Painel Web: http://localhost:${PORT}`);
  console.log('====================================================');

  dbService.addLog('info', `Servidor iniciado com sucesso na porta ${PORT}`);

  // Inicia o motor do piloto automático se estiver habilitado
  const settings = getSystemSettings();
  if (settings.autopilotEnabled) {
    AutopilotEngine.start();
  } else {
    console.log('ℹ️  Piloto automático pausado. Ative pelo Painel Web para iniciar a caça 24/7.');
  }
});
