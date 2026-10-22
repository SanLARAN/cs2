'use strict';

/**
 * Источник №2 — мобильное API Авито (m.avito.ru/api/9/items).
 *
 * Оно недокументированное и может поменяться в любой момент, зато отдаёт
 * компактный JSON и обычно меньше страдает от антибот-защиты.
 * Используется как основной/резервный источник в режиме «Авто».
 */

const { CookieJar, fetchText, SourceError, jitter, parsePrice, citySlug } = require('./util');
const { normalizeItems, collectListingNodes } = require('./parse');

const API = 'https://m.avito.ru/api/9/items';
// Публичный ключ мобильного клиента Авито (не секрет и не привязан к аккаунту).
const APP_KEY = 'af0deccbgcgidddjgnvljitntccdduijhdinfgjgfjir';

/** Известные locationId крупных городов (используются, если город не удалось определить). */
const CITY_IDS = {
  moskva: 637640,
  'sankt-peterburg': 653240,
};

const jar = new CookieJar();
const locationCache = new Map();

/** Пытаемся вытащить locationId из страницы города. */
async function resolveLocationId(city) {
  const slug = citySlug(city);
  if (!slug) return null;
  if (CITY_IDS[slug]) return CITY_IDS[slug];
  if (locationCache.has(slug)) return locationCache.get(slug);

  try {
    const html = await fetchText(`https://www.avito.ru/${slug}`, { jar, timeout: 15000 });
    const match = html.match(/"locationId"\s*:\s*(\d+)/) || html.match(/"location_id"\s*:\s*(\d+)/);
    if (match) {
      const id = Number(match[1]);
      locationCache.set(slug, id);
      return id;
    }
  } catch {
    /* город не определился — работаем без locationId */
  }
  locationCache.set(slug, null);
  return null;
}

function buildQuery(profile, { page, locationId }) {
  const params = new URLSearchParams({
    key: APP_KEY,
    display: 'list',
    limit: '30',
    page: String(page),
  });
  if (profile.query) params.set('query', String(profile.query).trim());
  if (locationId) params.set('locationId', String(locationId));
  if (profile.categoryId) params.set('categoryId', String(profile.categoryId));
  if (profile.priceMin != null && profile.priceMin !== '') params.set('priceMin', String(profile.priceMin));
  if (profile.priceMax != null && profile.priceMax !== '') params.set('priceMax', String(profile.priceMax));
  params.set('sort', profile.sort === 'priceAsc' ? 'priceAsc' : profile.sort === 'priceDesc' ? 'priceDesc' : 'date');
  return params;
}

async function search(profile, { page = 1, locationId } = {}) {
  const locId = locationId ?? (await resolveLocationId(profile.city));
  const params = buildQuery(profile, { page, locationId: locId });
  const url = `${API}?${params.toString()}`;
  await jitter(150, 500);

  const body = await fetchText(url, {
    jar,
    timeout: 20000,
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      'x-source': 'mobile',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      referer: 'https://m.avito.ru/',
    },
  });

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new SourceError('Мобильное API вернуло не JSON — вероятно, изменился формат или сработала защита.', { kind: 'parse' });
  }

  const rawItems = Array.isArray(json.items) ? json.items.map((entry) => entry?.value || entry) : [];
  const nodes = rawItems.length ? rawItems : collectListingNodes(json);
  const items = normalizeItems(nodes, 'api');

  if (!items.length && json && json.error) {
    throw new SourceError(`Мобильное API Авито ответило ошибкой: ${json.error.message || json.error}`, { kind: 'api' });
  }
  if (!items.length) {
    throw new SourceError('Мобильное API не вернуло объявлений. Возможно, фильтры слишком узкие.', { kind: 'parse' });
  }

  return { items, hasMore: Boolean(json.hasMore), lastStamp: json.lastStamp, url, locationId: locId };
}

module.exports = { search, resolveLocationId, buildQuery, CITY_IDS, APP_KEY, parsePrice };
