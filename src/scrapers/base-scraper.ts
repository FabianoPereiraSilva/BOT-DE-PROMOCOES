import axios, { AxiosRequestConfig } from 'axios';

export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0'
];

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export async function fetchHtml(url: string, customHeaders: Record<string, string> = {}): Promise<string> {
  try {
    const isSearchList = url.includes('lista.mercadolivre.com.br');
    const defaultUa = isSearchList 
      ? 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
      : getRandomUserAgent();

    const response = await axios.get(url, {
      headers: {
        'User-Agent': defaultUa,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        ...customHeaders
      },
      timeout: 15000,
      maxRedirects: 5
    });
    return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  } catch (error: any) {
    console.warn(`Erro ao baixar HTML de ${url}:`, error.message);
    return '';
  }
}

export async function fetchJson<T = any>(url: string, customHeaders: Record<string, string> = {}): Promise<T> {
  try {
    const config: AxiosRequestConfig = {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        ...customHeaders
      },
      timeout: 15000
    };

    const response = await axios.get<T>(url, config);
    return response.data;
  } catch (error: any) {
    console.warn(`Erro ao baixar JSON de ${url}:`, error.message);
    return {} as T;
  }
}

export function cleanPrice(priceStr: string | number | undefined | null): number {
  if (typeof priceStr === 'number') return priceStr;
  if (!priceStr) return 0;

  // Remove currency symbols, non-numeric characters except comma and dot
  const cleaned = priceStr
    .toString()
    .replace(/[^\d,\.]/g, '')
    .replace(/\.(?=\d{3})/g, '') // remove thousands dot (e.g. 1.299,00 -> 1299,00)
    .replace(',', '.'); // replace decimal comma with dot

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
