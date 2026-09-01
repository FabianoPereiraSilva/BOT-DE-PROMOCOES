import { MercadoLivreHunter } from './scrapers/mercadolivre-hunter.js';
import { ShopeeHunter } from './scrapers/shopee-hunter.js';
import { CopyFormatter } from './generator/copy-formatter.js';

async function testHunter() {
  console.log('🎯 ===============================================');
  console.log('🎯 TESTE DE CAÇA DE OFERTAS: MERCADO LIVRE & SHOPEE');
  console.log('🎯 ===============================================\n');

  console.log('🔍 1. Buscando ofertas no Mercado Livre...');
  const mlDeals = await MercadoLivreHunter.huntDeals(15, 10);
  console.log(`✅ Mercado Livre encontrou ${mlDeals.length} ofertas!`);
  if (mlDeals.length > 0) {
    const topML = mlDeals[0];
    console.log('--- Top Oferta Mercado Livre ---');
    console.log(`Título: ${topML.title}`);
    console.log(`De: R$ ${topML.originalPrice || '-'} | Por: R$ ${topML.currentPrice} (${topML.discountPercent}% OFF)`);
    console.log(`Link Afiliado: ${topML.affiliateUrl}`);
    console.log(`Imagem: ${topML.imageUrl}`);
    console.log('\n--- Exemplo de Copy Telegram ---');
    console.log(CopyFormatter.formatTelegram(topML));
  }

  console.log('\n🔍 2. Buscando ofertas relâmpago na Shopee...');
  const shopeeDeals = await ShopeeHunter.huntDeals(15, 10);
  console.log(`✅ Shopee encontrou ${shopeeDeals.length} ofertas!`);
  if (shopeeDeals.length > 0) {
    const topShopee = shopeeDeals[0];
    console.log('--- Top Oferta Shopee ---');
    console.log(`Título: ${topShopee.title}`);
    console.log(`De: R$ ${topShopee.originalPrice || '-'} | Por: R$ ${topShopee.currentPrice} (${topShopee.discountPercent}% OFF)`);
    console.log(`Link Afiliado: ${topShopee.affiliateUrl}`);
  }

  console.log('\n🎉 Teste do Caçador finalizado com sucesso!');
}

testHunter();
