'use strict';

/**
 * Нормализация объявлений Авито в единый формат приложения.
 *
 * Веб-версия, мобильное API и демо-режим отдают данные в разных форматах,
 * поэтому все они проходят через `normalizeItem`.
 */

const { parsePrice, absoluteUrl, pickImage, toTimestamp } = require('./util');

const AVITO = 'https://www.avito.ru';

/** Похоже ли значение на карточку объявления. */
function looksLikeListing(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const hasId = node.id != null || node.itemId != null;
  const hasTitle = typeof node.title === 'string' && node.title.length > 1;
  const hasLink = typeof node.urlPath === 'string' || typeof node.uri === 'string' || typeof node.url === 'string';
  const hasPrice = node.price != null || node.priceDetailed != null || node.priceValue != null;
  return hasId && hasTitle && hasLink && hasPrice;
}

/**
 * Обходим дерево JSON и собираем все узлы, похожие на объявления.
 * Такой подход переживает переименование внутренних структур Авито.
 */
function collectListingNodes(root, limit = 500) {
  const found = [];
  const seen = new Set();
  const stack = [root];

  while (stack.length && found.length < limit) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) stack.push(node[i]);
      continue;
    }
    if (looksLikeListing(node)) {
      const key = String(node.id ?? node.itemId);
      if (!seen.has(key)) {
        seen.add(key);
        found.push(node);
      }
      continue;
    }
    // Ограничиваем глубину, чтобы не обходить мегабайты служебных данных.
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return found;
}

function pickLink(item) {
  const raw = item.urlPath || item.uri || item.url || item.link || '';
  if (!raw) return '';
  const url = absoluteUrl(raw, AVITO);
  // мобильное API иногда отдаёт относительные ссылки без города
  return url.replace('https://m.avito.ru', AVITO);
}

function normalizeItem(item, source) {
  const id = String(item.id ?? item.itemId ?? item.code ?? '');
  const title = String(item.title || item.name || '').trim();
  const price = parsePrice(item.priceDetailed ?? item.priceValue ?? item.price);
  const priceText = typeof item.price === 'string' ? item.price : (item.priceDetailed?.string || '');
  const location = item.location?.name
    || item.geo?.formattedAddress
    || item.address
    || item.locationName
    || '';

  return {
    id,
    title,
    price,
    priceText,
    url: pickLink(item),
    image: pickImage(item.images || item.image || item.mainImage),
    location: String(location),
    description: String(item.description || item.shortDescription || '').slice(0, 600),
    publishedAt: toTimestamp(item.time ?? item.sortTime ?? item.publishedAt ?? item.date),
    source,
    isPromo: Boolean(item.isPromo || item.promotionId || item.isPromoted),
  };
}

function normalizeItems(nodes, source) {
  const out = [];
  const seen = new Set();
  for (const node of nodes) {
    const listing = normalizeItem(node, source);
    if (!listing.id || !listing.title) continue;
    if (!listing.url) listing.url = `${AVITO}/`;
    if (seen.has(listing.id)) continue;
    seen.add(listing.id);
    out.push(listing);
  }
  return out;
}

/**
 * Достаём встроенный JSON со страницы поиска Авито.
 * Страница кладёт состояние в `window.__initialData__` (URL-encoded JSON).
 */
function extractInitialData(html) {
  const patterns = [
    /window\.__initialData__\s*=\s*"([^"]+)"/,
    /window\.__initialData__\s*=\s*'([^']+)'/,
    /__initialData__\s*=\s*"([^"]+)"/,
  ];
  for (const re of patterns) {
    const match = String(html).match(re);
    if (!match) continue;
    const raw = match[1];
    const candidates = [raw, raw.replace(/\\u002F/g, '/'), raw.replace(/\\"/g, '"')];
    for (const candidate of candidates) {
      try {
        return JSON.parse(decodeURIComponent(candidate));
      } catch {
        try {
          return JSON.parse(candidate);
        } catch {
          /* пробуем следующий вариант */
        }
      }
    }
  }
  return null;
}

/** Разбор HTML-страницы поиска -> массив нормализованных объявлений. */
function parseSearchHtml(html, { source = 'web' } = {}) {
  const data = extractInitialData(html);
  let nodes = [];
  if (data) {
    nodes = collectListingNodes(data);
  }
  if (!nodes.length) {
    // Запасной путь: JSON-LD разметка, если она есть.
    nodes = extractJsonLd(html);
  }
  return normalizeItems(nodes, source);
}

function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const items = Array.isArray(parsed) ? parsed : parsed.itemListElement || [];
      for (const entry of items) {
        const node = entry.item || entry;
        if (node && node.name) {
          out.push({
            id: node.sku || node['@id'] || node.url,
            title: node.name,
            url: node.url,
            price: node.offers?.price,
            description: node.description,
            images: node.image,
            location: node.offers?.availableAtOrFrom?.name,
          });
        }
      }
    } catch {
      /* игнорируем битую разметку */
    }
  }
  return out;
}

module.exports = {
  AVITO,
  looksLikeListing,
  collectListingNodes,
  normalizeItem,
  normalizeItems,
  extractInitialData,
  parseSearchHtml,
};
