import axios, { AxiosRequestConfig } from 'axios';

export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
];

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export async function fetchHtml(url: string, customHeaders: Record<string, string> = {}): Promise<string> {
  const config: AxiosRequestConfig = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      ...customHeaders
    },
    timeout: 15000,
    maxRedirects: 5
  };

  const response = await axios.get(url, config);
  return response.data;
}

export async function fetchJson<T = any>(url: string, customHeaders: Record<string, string> = {}): Promise<T> {
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
