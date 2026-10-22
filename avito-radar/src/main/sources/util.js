'use strict';

/**
 * Общие утилиты для источников данных: HTTP с «человеческими» заголовками,
 * cookie-jar, разбор цен и ссылок.
 *
 * Всё сетевое взаимодействие вынесено в главный процесс Electron,
 * поэтому CORS и ограничения рендерера нам не мешают.
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

class SourceError extends Error {
  constructor(message, { status = 0, kind = 'generic' } = {}) {
    super(message);
    this.name = 'SourceError';
    this.status = status;
    this.kind = kind;
  }
}

class HttpError extends SourceError {}

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** Минимальный cookie-jar: Авито охотнее отдаёт страницу, если принести cookie с главной. */
class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  absorb(response) {
    let list = [];
    try {
      if (typeof response.headers.getSetCookie === 'function') {
        list = response.headers.getSetCookie();
      }
    } catch {
      list = [];
    }
    for (const raw of list) {
      const [pair] = String(raw).split(';');
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!name) continue;
      this.cookies.set(name, value);
    }
  }

  header() {
    if (!this.cookies.size) return '';
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function baseHeaders(referer) {
  const headers = {
    'user-agent': pickUserAgent(),
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'upgrade-insecure-requests': '1',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-user': '?1',
  };
  if (referer) headers.referer = referer;
  return headers;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (min = 250, max = 900) => sleep(min + Math.random() * (max - min));

/**
 * GET с таймаутом, cookie-jar и одним повтором.
 * @returns {Promise<string>} тело ответа
 */
async function fetchText(url, { jar, headers = {}, timeout = 20000, method = 'GET', body, retries = 1 } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const reqHeaders = { ...baseHeaders(url), ...headers };
      if (jar && jar.header()) reqHeaders.cookie = jar.header();

      const response = await fetch(url, {
        method,
        body,
        headers: reqHeaders,
        redirect: 'follow',
        signal: controller.signal,
      });

      if (jar) jar.absorb(response);

      if (!response.ok) {
        const status = response.status;
        if ((status === 429 || status === 403 || status >= 500) && attempt < retries) {
          const retryAfter = Number(response.headers.get('retry-after')) || 0;
          await sleep(retryAfter ? Math.min(retryAfter * 1000, 15000) : 1500 + Math.random() * 1500);
          continue;
        }
        throw new HttpError(httpMessage(status), { status, kind: status === 403 || status === 429 ? 'blocked' : 'http' });
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError') {
        lastError = new SourceError('Превышено время ожидания ответа от Авито', { kind: 'timeout' });
      }
      if (attempt >= retries || (error instanceof SourceError && error.kind === 'blocked')) break;
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError instanceof SourceError) throw lastError;
  throw new SourceError(`Сеть недоступна: ${lastError && lastError.message}`, { kind: 'network' });
}

function httpMessage(status) {
  if (status === 403) return 'Авито отклонил запрос (403) — сработала антибот-защита. Попробуйте позже или другой источник.';
  if (status === 429) return 'Слишком много запросов (429). Увеличьте интервал проверки.';
  if (status === 404) return 'Страница поиска не найдена (404). Проверьте ссылку и город.';
  if (status >= 500) return `Авито ответил ошибкой ${status}. Обычно это временно.`;
  return `Неожиданный ответ Авито: HTTP ${status}`;
}

/** «15 000 ₽» -> 15000, «Цена не указана» -> null */
function parsePrice(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value === 'object') {
    if (typeof value.value === 'number') return Math.round(value.value);
    return parsePrice(value.string || value.text || '');
  }
  const text = String(value);
  if (!/\d/.test(text)) return null;
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return null;
  const num = Number(digits);
  return Number.isFinite(num) ? num : null;
}

function absoluteUrl(href, base = 'https://www.avito.ru') {
  if (!href) return '';
  const url = String(href);
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return base + url;
  return `${base}/${url}`;
}

/** Достаём картинку из разных форматов: строка, {640x480: url}, [{url}] */
function pickImage(images) {
  if (!images) return '';
  const first = Array.isArray(images) ? images[0] : images;
  if (!first) return '';
  if (typeof first === 'string') return absoluteUrl(first);
  if (typeof first === 'object') {
    for (const key of ['640x480', '432x576', '140x105', '1280x960', 'url', 'src']) {
      if (typeof first[key] === 'string' && first[key]) {
        return absoluteUrl(first[key].replace('/1.jpg', '/1.jpg'));
      }
    }
  }
  return '';
}

/** Приводим время к миллисекундам (Авито отдаёт секунды). */
function toTimestamp(value) {
  if (value == null) return null;
  if (typeof value === 'string' && !/^\d+$/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num > 1e12 ? Math.round(num) : Math.round(num * 1000);
}

/** «5 мин назад» и т.п. */
function timeAgo(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  if (diff < 0) return 'только что';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн назад`;
  return new Date(timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatPrice(price) {
  if (price == null) return 'Цена не указана';
  return `${Math.round(price).toLocaleString('ru-RU')} ₽`;
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/** «Казань» -> «kazan», «Санкт-Петербург» -> «sankt-peterburg» (как в адресах Авито). */
function citySlug(city) {
  return String(city || '')
    .trim()
    .toLowerCase()
    .split('')
    .map((char) => (TRANSLIT[char] !== undefined ? TRANSLIT[char] : char))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Фильтры «+слово / -слово», регистр не важен. */
function matchesKeywords(text, { plus = [], minus = [] } = {}) {
  const haystack = String(text || '').toLowerCase();
  const norm = (arr) => (Array.isArray(arr) ? arr : String(arr || '').split(','))
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);
  const required = norm(plus);
  const banned = norm(minus);
  if (banned.some((word) => haystack.includes(word))) return false;
  if (required.length && !required.some((word) => haystack.includes(word))) return false;
  return true;
}

module.exports = {
  SourceError,
  HttpError,
  CookieJar,
  fetchText,
  jitter,
  sleep,
  parsePrice,
  absoluteUrl,
  pickImage,
  toTimestamp,
  timeAgo,
  formatPrice,
  matchesKeywords,
  pickUserAgent,
  citySlug,
};
