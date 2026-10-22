'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsePrice, citySlug, matchesKeywords, toTimestamp, absoluteUrl, timeAgo, formatPrice, CookieJar,
} = require('../src/main/sources/util');

test('parsePrice понимает форматы Авито', () => {
  assert.equal(parsePrice('15 000 ₽'), 15000);
  assert.equal(parsePrice('15\u00a0000 ₽'), 15000);
  assert.equal(parsePrice('1 250 000'), 1250000);
  assert.equal(parsePrice(42000), 42000);
  assert.equal(parsePrice({ value: 9900 }), 9900);
  assert.equal(parsePrice({ string: '3 500 ₽' }), 3500);
  assert.equal(parsePrice('Цена не указана'), null);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice(null), null);
});

test('citySlug транслитерирует города в адреса Авито', () => {
  assert.equal(citySlug('Казань'), 'kazan');
  assert.equal(citySlug('Санкт-Петербург'), 'sankt-peterburg');
  assert.equal(citySlug('Нижний Новгород'), 'nizhniy-novgorod');
  assert.equal(citySlug('  Москва '), 'moskva');
  assert.equal(citySlug('kazan'), 'kazan');
  assert.equal(citySlug(''), '');
});

test('matchesKeywords учитывает обязательные и запрещённые слова', () => {
  const text = 'iPhone 15 Pro 256Gb, идеальное состояние';
  assert.equal(matchesKeywords(text, { plus: 'iphone', minus: 'битый' }), true);
  assert.equal(matchesKeywords(text, { plus: 'samsung', minus: '' }), false);
  assert.equal(matchesKeywords(text, { plus: '', minus: '256gb' }), false);
  assert.equal(matchesKeywords(text, { plus: ['samsung', 'iphone'], minus: [] }), true);
  assert.equal(matchesKeywords('', {}), true);
});

test('toTimestamp приводит секунды и строки к миллисекундам', () => {
  assert.equal(toTimestamp(1700000000), 1700000000000);
  assert.equal(toTimestamp(1700000000000), 1700000000000);
  assert.equal(toTimestamp('2024-05-01T10:00:00Z'), Date.parse('2024-05-01T10:00:00Z'));
  assert.equal(toTimestamp(0), null);
  assert.equal(toTimestamp(null), null);
});

test('absoluteUrl склеивает относительные ссылки', () => {
  assert.equal(absoluteUrl('/kazan/telefony/item'), 'https://www.avito.ru/kazan/telefony/item');
  assert.equal(absoluteUrl('//cdn.avito.ru/a.jpg'), 'https://cdn.avito.ru/a.jpg');
  assert.equal(absoluteUrl('https://example.com/x'), 'https://example.com/x');
  assert.equal(absoluteUrl(''), '');
});

test('formatPrice и timeAgo дают человекочитаемый текст', () => {
  assert.equal(formatPrice(56000), '56\u00a0000 ₽');
  assert.equal(formatPrice(null), 'Цена не указана');
  assert.equal(timeAgo(Date.now() - 30000), 'только что');
  assert.equal(timeAgo(Date.now() - 5 * 60000), '5 мин назад');
});

test('CookieJar собирает и отдаёт cookie', () => {
  const jar = new CookieJar();
  jar.absorb({ headers: { getSetCookie: () => ['a=1; Path=/', 'b=2; HttpOnly'] } });
  assert.equal(jar.header(), 'a=1; b=2');
  jar.absorb({ headers: { getSetCookie: () => [] } });
  assert.equal(jar.header(), 'a=1; b=2');
});
