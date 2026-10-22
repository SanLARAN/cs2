'use strict';

/** Экспорт результатов в CSV, который нормально открывается в Excel (UTF-8 BOM, «;»). */

const { formatPrice, timeAgo } = require('./sources/util');

const COLUMNS = [
  ['ID', (item) => item.id],
  ['Название', (item) => item.title],
  ['Цена, ₽', (item) => (item.price == null ? '' : item.price)],
  ['Цена', (item) => formatPrice(item.price)],
  ['Снижение цены, ₽', (item) => (item.priceDrop ? item.priceDrop : '')],
  ['Район / место', (item) => item.location],
  ['Новое', (item) => (item.isNew ? 'да' : '')],
  ['Опубликовано', (item) => (item.publishedAt ? new Date(item.publishedAt).toLocaleString('ru-RU') : '')],
  ['Насколько свежее', (item) => timeAgo(item.publishedAt)],
  ['Впервые найдено', (item) => (item.firstSeen ? new Date(item.firstSeen).toLocaleString('ru-RU') : '')],
  ['Источник', (item) => item.source],
  ['Ссылка', (item) => item.url],
  ['Описание', (item) => item.description],
];

function escapeCell(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  if (/[";\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(items) {
  const lines = [COLUMNS.map(([title]) => escapeCell(title)).join(';')];
  for (const item of items) {
    lines.push(COLUMNS.map(([, get]) => escapeCell(get(item))).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function safeFileName(text) {
  return String(text || 'poisk')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'poisk';
}

module.exports = { toCsv, safeFileName, COLUMNS };
