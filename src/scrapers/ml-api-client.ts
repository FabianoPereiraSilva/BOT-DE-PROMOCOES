import axios from 'axios';
import { getSystemSettings } from '../config/env.js';

interface MLToken {
  access_token: string;
  expires_in: number;
  obtainedAt: number;
}

/**
 * Cliente OAuth para a API Oficial do Mercado Livre
 * Usa o fluxo Client Credentials (machine-to-machine, sem login de usuario)
 */
export class MercadoLivreApiClient {
  private static token: MLToken | null = null;
  private static readonly BASE_URL = 'https://api.mercadolibre.com';

  private static getCredentials(): { appId: string; secret: string } {
    try {
      const settings = getSystemSettings();
      const appId = (settings.mlAppId || process.env.ML_APP_ID || '').trim();
      const secret = (settings.mlClientSecret || process.env.ML_CLIENT_SECRET || '').trim();
      return { appId, secret };
    } catch {
      // Fallback direto ao env (durante inicializacao antes do DB)
      return {
        appId: process.env.ML_APP_ID?.trim() || '',
        secret: process.env.ML_CLIENT_SECRET?.trim() || ''
      };
    }
  }

  private static isTokenValid(): boolean {
    if (!this.token) return false;
    const elapsed = (Date.now() - this.token.obtainedAt) / 1000;
    return elapsed < (this.token.expires_in - 60);
  }

  static async getAccessToken(): Promise<string | null> {
    const { appId, secret } = this.getCredentials();
    if (!appId || !secret) return null;

    if (this.isTokenValid() && this.token) {
      return this.token.access_token;
    }

    try {
      const response = await axios.post(
        `${this.BASE_URL}/oauth/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: appId,
          client_secret: secret
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
          timeout: 8000
        }
      );

      this.token = {
        access_token: response.data.access_token,
        expires_in: response.data.expires_in || 21600,
        obtainedAt: Date.now()
      };

      console.log(`[ML API] Token obtido. Valido por ${this.token.expires_in}s`);
      return this.token.access_token;
    } catch (err: any) {
      console.error('[ML API] Falha ao obter token:', err.response?.data?.message || err.message);
      return null;
    }
  }

  static async searchDeals(query: string, minDiscount = 20, limit = 20): Promise<any[]> {
    const token = await this.getAccessToken();
    if (!token) return [];

    try {
      const response = await axios.get(`${this.BASE_URL}/sites/MLB/search`, {
        params: { q: query, sort: 'relevance', limit, offset: 0 },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });

      const results: any[] = response.data?.results || [];
      return results.filter(item => {
        const original = item.original_price;
        const current = item.price;
        if (!original || !current || original <= current) return false;
        const discount = Math.round(((original - current) / original) * 100);
        return discount >= minDiscount;
      });
    } catch (err: any) {
      console.error('[ML API] Erro na busca:', err.response?.data?.message || err.message);
      return [];
    }
  }

  static async searchByCategory(categoryId: string, minDiscount = 20, limit = 20): Promise<any[]> {
    const token = await this.getAccessToken();
    if (!token) return [];

    try {
      const response = await axios.get(`${this.BASE_URL}/sites/MLB/search`, {
        params: { category: categoryId, sort: 'relevance', limit },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });

      const results: any[] = response.data?.results || [];
      return results.filter(item => {
        const original = item.original_price;
        const current = item.price;
        if (!original || !current || original <= current) return false;
        const discount = Math.round(((original - current) / original) * 100);
        return discount >= minDiscount;
      });
    } catch (err: any) {
      console.error('[ML API] Erro na busca por categoria:', err.response?.data?.message || err.message);
      return [];
    }
  }

  static async testConnection(): Promise<{ success: boolean; message: string }> {
    const { appId, secret } = this.getCredentials();
    if (!appId || !secret) {
      return { success: false, message: 'ML_APP_ID ou ML_CLIENT_SECRET nao configurados.' };
    }
    const token = await this.getAccessToken();
    if (token) {
      return { success: true, message: `API ML conectada! App ID: ${appId}` };
    }
    return { success: false, message: 'Falha ao autenticar com as credenciais fornecidas.' };
  }
}
