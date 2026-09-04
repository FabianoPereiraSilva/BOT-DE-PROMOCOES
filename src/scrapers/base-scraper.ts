import axios, { AxiosRequestConfig } from 'axios';

export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
];

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Headers padrão de navegador para evitar bloqueio anti-bot
 */
function getBrowserHeaders(ua: string): Record<string, string> {
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1'
  };
}

export async function fetchHtml(url: string, customHeaders: Record<string, string> = {}): Promise<string> {
  try {
    const ua = getRandomUserAgent();
    const headers = {
      ...getBrowserHeaders(ua),
      ...customHeaders
    };

    const response = await axios.get(url, {
      headers,
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
    const ua = getRandomUserAgent();
    const config: AxiosRequestConfig = {
      headers: {
        'User-Agent': ua,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
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

/**
 * Fetch dedicado para API de busca da Shopee com headers anti-bot completos
 */
export async function fetchShopeeApi<T = any>(url: string): Promise<T> {
  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const config: AxiosRequestConfig = {
      headers: {
        'User-Agent': ua,
        'Accept': 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://shopee.com.br/',
        'Origin': 'https://shopee.com.br',
        'x-api-source': 'pc',
        'x-shopee-language': 'pt-BR',
        'x-requested-with': 'XMLHttpRequest',
        'af-ac-enc-dat': '',
        'af-ac-enc-sz-token': '',
        'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'Cookie': 'SPC_F=undefined; REC_T_ID=undefined; _QPWSDCXHZQA=undefined;'
      },
      timeout: 15000
    };

    const response = await axios.get<T>(url, config);
    return response.data;
  } catch (error: any) {
    console.warn(`Erro ao acessar Shopee API (${url.substring(0, 80)}...):`, error.message);
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
