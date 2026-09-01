import fs from 'fs';
import path from 'path';
import { BannerGenerator } from './generator/banner-generator.js';
import { Deal } from './types/deal.js';

async function test() {
  console.log('🧪 Iniciando teste de geração de banner...');

  const sampleDeal: Deal = {
    id: 'test_ml_123',
    store: 'mercadolivre',
    title: 'Fritadeira Sem Óleo Air Fryer Mondial 4 Litros Digital Inox',
    originalPrice: 489.90,
    currentPrice: 289.90,
    discountPercent: 41,
    imageUrl: 'https://http2.mlstatic.com/D_NQ_NP_2X_784903-MLA74075198894_012024-F.webp',
    originalUrl: 'https://www.mercadolivre.com.br',
    affiliateUrl: 'https://mercadolivre.com/afiliados/exemplo',
    freeShipping: true
  };

  try {
    const bannerBuffer = await BannerGenerator.generateSquareBanner(sampleDeal);
    const outputPath = path.resolve(process.cwd(), 'data', 'teste_banner_gerado.jpg');
    fs.writeFileSync(outputPath, bannerBuffer);
    console.log(`✅ Banner gerado com sucesso! Salvo em: ${outputPath} (${bannerBuffer.length} bytes)`);
  } catch (err) {
    console.error('❌ Erro ao gerar banner de teste:', err);
  }
}

test();
