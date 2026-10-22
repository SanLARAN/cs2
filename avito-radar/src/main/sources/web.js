'use strict';

/**
 * Источник №1 — обычная веб-версия Авито (то же, что видно в браузере).
 *
 * Работает по ссылке на поиск: пользователь один раз настраивает фильтры на сайте
 * (город, район, цена, категория) и копирует адрес страницы в профиль поиска.
 * Так поддерживаются ВСЕ фильтры Авито, включая районы и параметры категорий.
 */

const { CookieJar, fetchText, SourceError, jitter, citySlug } = require('./util');
const { parseSearchHtml } = require('./parse');

const HOME = 'https://www.avito.ru/';
const SORTS = {
  date: '104',
  priceAsc: '1',
  priceDesc: '2',
};

function slugifyCity(city) {
  return citySlug(city);
}

/** Собирает URL поиска из полей профиля (если не вставлена готовая ссылка). */
function buildSearchUrl(profile, page = 1) {
  const rawUrl = String(profile.url || '').trim();
  let url;

  if (rawUrl) {
    try {
      url = new URL(rawUrl);
    } catch {
      throw new SourceError('Ссылка на поиск выглядит некорректно. Скопируйте адрес страницы целиком.', { kind: 'input' });
    }
    if (!/avito\.ru$/i.test(url.hostname.replace(/^www\./, ''))) {
      throw new SourceError('Ссылка должна вести на avito.ru', { kind: 'input' });
    }
  } else {
    const city = slugifyCity(profile.city) || 'rossiya';
    const category = String(profile.categorySlug || '').trim().replace(/^\/+|\/+$/g, '');
    url = new URL(`${category ? `${category}/` : ''}`, `https://www.avito.ru/${city}/`);
    if (profile.query) url.searchParams.set('q', String(profile.query).trim());
    if (profile.priceMin != null && profile.priceMin !== '') url.searchParams.set('pmin', String(profile.priceMin));
    if (profile.priceMax != null && profile.priceMax !== '') url.searchParams.set('pmax', String(profile.priceMax));
    if (profile.onlyToday) url.searchParams.set('d', '1');
    url.searchParams.set('s', SORTS[profile.sort] || SORTS.date);
  }

  if (page > 1) url.searchParams.set('p', String(page));
  else url.searchParams.delete('p');
  return url.toString();
}

/** Состояние cookie общее на процесс, чтобы не получать 403 на каждый запрос. */
const jar = new CookieJar();
let warmedUp = false;

async function warmUp() {
  if (warmedUp) return;
  try {
    await fetchText(HOME, { jar, timeout: 15000 });
    warmedUp = true;
  } catch {
    // главная может быть недоступна — не критично, пробуем поиск напрямую
  }
}

async function search(profile, { page = 1 } = {}) {
  const url = buildSearchUrl(profile, page);
  await warmUp();
  await jitter(200, 700);

  const html = await fetchText(url, { jar, referer: HOME });
  const items = parseSearchHtml(html, { source: 'web' });

  if (!items.length) {
    const hasCaptcha = /captcha|firewall|Проверка, что вы не робот|too many requests/i.test(html.slice(0, 20000));
    throw new SourceError(
      hasCaptcha
        ? 'Авито показал проверку на робота. Подождите пару минут или включите мобильное API.'
        : 'Не удалось найти объявления в ответе Авито. Возможно, изменилась вёрстка или фильтры слишком узкие.',
      { kind: 'parse' },
    );
  }

  return { items, hasMore: items.length >= 20, url };
}

module.exports = { search, buildSearchUrl, slugifyCity, SORTS };
