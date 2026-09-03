import sharp from 'sharp';
import axios from 'axios';
import { Deal } from '../types/deal.js';
import { CopyFormatter } from './copy-formatter.js';

export class BannerGenerator {
  /**
   * Baixa uma imagem remota para Buffer
   */
  private static async downloadImage(url: string): Promise<Buffer | null> {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
      });
      return Buffer.from(response.data);
    } catch (err) {
      console.warn(`Não foi possível baixar a imagem (${url}):`, err);
      return null;
    }
  }

  /**
   * Escapa caracteres para uso dentro de XML/SVG
   */
  private static escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }

  /**
   * Quebra títulos longos em até 2 linhas para o banner
   */
  private static splitTitle(title: string, maxCharsPerLine = 38): { line1: string; line2: string } {
    const clean = title.trim();
    if (clean.length <= maxCharsPerLine) {
      return { line1: clean, line2: '' };
    }

    const words = clean.split(' ');
    let line1 = '';
    let line2 = '';

    for (const word of words) {
      if ((line1 + ' ' + word).trim().length <= maxCharsPerLine) {
        line1 = (line1 + ' ' + word).trim();
      } else if ((line2 + ' ' + word).trim().length <= maxCharsPerLine) {
        line2 = (line2 + ' ' + word).trim();
      } else {
        if (!line2.endsWith('...')) line2 += '...';
        break;
      }
    }

    return { line1, line2 };
  }

  /**
   * Gera um banner promocional profissional de 1080x1080px
   */
  static async generateSquareBanner(deal: Deal): Promise<Buffer> {
    const width = 1080;
    const height = 1080;

    // Paleta de cores dinâmica conforme a loja
    const isShopee = deal.store === 'shopee';
    const isAmazon = deal.store === 'amazon';
    const primaryColor = isShopee ? '#EE4D2D' : isAmazon ? '#FF9900' : '#FFE600';
    const primaryTextColor = isShopee ? '#FFFFFF' : isAmazon ? '#111827' : '#2D3277';
    const storeLabel = isShopee ? 'SHOPEE' : isAmazon ? 'AMAZON' : 'MERCADO LIVRE';

    const formattedCurrentPrice = CopyFormatter.formatCurrency(deal.currentPrice);
    const formattedOriginalPrice = deal.originalPrice ? CopyFormatter.formatCurrency(deal.originalPrice) : null;
    const { line1, line2 } = this.splitTitle(deal.title);

    // Baixa a imagem do produto se existir e converte para base64 JPEG
    let productBase64: string | null = null;
    if (deal.imageUrl) {
      const rawImgBuffer = await this.downloadImage(deal.imageUrl);
      if (rawImgBuffer) {
        try {
          const processedImg = await sharp(rawImgBuffer)
            .resize(680, 520, {
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 1 }
            })
            .jpeg({ quality: 90 })
            .toBuffer();

          productBase64 = `data:image/jpeg;base64,${processedImg.toString('base64')}`;
        } catch (err) {
          console.warn('Erro ao processar imagem do produto:', err);
        }
      }
    }

    const fontStack = "'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Segoe UI', Arial, Helvetica, sans-serif";

    // Monta o SVG vetorial completo com fontes universais compatíveis com Linux e Windows
    const fullSvg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0b0f19" />
            <stop offset="50%" stop-color="#111827" />
            <stop offset="100%" stop-color="#1f2937" />
          </linearGradient>

          <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#ef4444" />
            <stop offset="100%" stop-color="#f97316" />
          </linearGradient>

          <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000000" flood-opacity="0.6"/>
          </filter>
        </defs>

        <!-- 1. Fundo Escuro Premium -->
        <rect width="${width}" height="${height}" fill="url(#bgGrad)" />

        <!-- 2. Header: Logo da Loja e Tag de Alerta -->
        <rect x="50" y="45" width="230" height="52" rx="26" fill="${primaryColor}" />
        <text x="165" y="79" font-family="${fontStack}" font-size="22" font-weight="900" fill="${primaryTextColor}" text-anchor="middle" letter-spacing="1">
          ${storeLabel}
        </text>

        <rect x="760" y="45" width="270" height="52" rx="26" fill="#1e293b" stroke="#334155" stroke-width="2" />
        <text x="895" y="79" font-family="${fontStack}" font-size="20" font-weight="bold" fill="#f8fafc" text-anchor="middle">
          ⚡ OFERTA DO DIA
        </text>

        <!-- 3. Card Branco Central com Sombra -->
        <rect x="180" y="125" width="720" height="560" rx="28" fill="#FFFFFF" filter="url(#cardShadow)" />

        <!-- 4. Foto do Produto (Renderizada DENTRO do Card Branco) -->
        ${productBase64 ? `
          <image href="${productBase64}" x="200" y="145" width="680" height="520" preserveAspectRatio="xMidYMid meet" />
        ` : `
          <text x="540" y="420" font-family="${fontStack}" font-size="32" font-weight="bold" fill="#94a3b8" text-anchor="middle">
            🛍️ OFERTA ESPECIAL
          </text>
        `}

        <!-- 5. Selo de Desconto Flutuante no Topo do Card -->
        ${deal.discountPercent ? `
          <rect x="680" y="105" width="240" height="74" rx="20" fill="url(#badgeGrad)" filter="url(#cardShadow)" />
          <text x="800" y="152" font-family="${fontStack}" font-size="34" font-weight="900" fill="#FFFFFF" text-anchor="middle" letter-spacing="0.5">
            -${deal.discountPercent}% OFF
          </text>
        ` : ''}

        <!-- 6. Frete Grátis Badge (se houver) -->
        ${deal.freeShipping ? `
          <rect x="205" y="625" width="190" height="42" rx="12" fill="#10b981" />
          <text x="300" y="653" font-family="${fontStack}" font-size="18" font-weight="bold" fill="#FFFFFF" text-anchor="middle">
            🚚 FRETE GRÁTIS
          </text>
        ` : ''}

        <!-- 7. Título do Produto -->
        <text x="540" y="735" font-family="${fontStack}" font-size="30" font-weight="bold" fill="#f8fafc" text-anchor="middle">
          ${this.escapeXml(line1)}
        </text>
        ${line2 ? `
          <text x="540" y="775" font-family="${fontStack}" font-size="30" font-weight="bold" fill="#cbd5e1" text-anchor="middle">
            ${this.escapeXml(line2)}
          </text>
        ` : ''}

        <!-- 8. Bloco de Preços -->
        <rect x="100" y="810" width="880" height="150" rx="24" fill="#0f172a" stroke="#334155" stroke-width="2" />

        ${formattedOriginalPrice ? `
          <text x="140" y="860" font-family="${fontStack}" font-size="24" font-weight="500" fill="#94a3b8">
            De: ${formattedOriginalPrice}
          </text>
          <line x1="135" y1="852" x2="350" y2="852" stroke="#ef4444" stroke-width="3" />
        ` : ''}

        <text x="140" y="925" font-family="${fontStack}" font-size="48" font-weight="900" fill="#22c55e">
          Por: ${formattedCurrentPrice}
        </text>

        <!-- 9. Botão Visual de Ação -->
        <rect x="650" y="840" width="300" height="90" rx="45" fill="${primaryColor}" />
        <text x="800" y="895" font-family="${fontStack}" font-size="26" font-weight="900" fill="${primaryTextColor}" text-anchor="middle">
          APROVEITAR 👉
        </text>

        <!-- 10. Footer Rodapé -->
        <text x="540" y="1020" font-family="${fontStack}" font-size="18" font-weight="500" fill="#64748b" text-anchor="middle">
          Confira o link no canal para comprar com o menor preço garantido!
        </text>
      </svg>
    `;

    const finalBanner = await sharp(Buffer.from(fullSvg))
      .jpeg({ quality: 92 })
      .toBuffer();

    return finalBanner;
  }
}
