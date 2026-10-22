'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractInitialData, collectListingNodes, parseSearchHtml, normalizeItems,
} = require('../src/main/sources/parse');

/** Мини-копия структуры страницы Авито: состояние внутри window.__initialData__. */
function makeHtml(state) {
  const encoded = encodeURIComponent(JSON.stringify(state));
  return `<!DOCTYPE html><html><head><title>Авито</title></head><body>
    <script>window.__initialData__ = "${encoded}";</script>
    <div id="app"></div></body></html>`;
}

const STATE = {
  data: {
    catalog: {
      items: [
        {
          id: 123456,
          title: 'iPhone 15 Pro 256 ГБ',
          priceDetailed: { string: '78 000 ₽', value: 78000 },
          urlPath: '/kazan/telefony/iphone_15_pro_123456',
          images: [{ '640x480': '/1.jpg' }],
          location: { name: 'Казань, Вахитовский район' },
          time: 1700000000,
          isPromo: false,
        },
        {
          id: 654321,
          title: 'iPhone 15 128 ГБ',
          price: '61 500 ₽',
          url: '/kazan/telefony/iphone_15_654321',
          images: ['/2.jpg'],
          location: { name: 'Казань' },
          time: 1700000100,
        },
      ],
      nested: { deeper: [{ id: 777, title: 'Велосипед', price: 12000, urlPath: '/kazan/velosipedy/777' }] },
    },
    meta: { title: 'Поиск' },
  },
};

test('extractInitialData находит и парсит встроенный JSON', () => {
  const data = extractInitialData(makeHtml(STATE));
  assert.ok(data);
  assert.equal(data.data.catalog.items.length, 2);
});

test('collectListingNodes находит объявления на любой глубине', () => {
  const data = extractInitialData(makeHtml(STATE));
  const nodes = collectListingNodes(data);
  assert.equal(nodes.length, 3);
  const ids = nodes.map((node) => String(node.id)).sort();
  assert.deepEqual(ids, ['123456', '654321', '777']);
});

test('parseSearchHtml нормализует объявления', () => {
  const items = parseSearchHtml(makeHtml(STATE));
  assert.equal(items.length, 3);

  const first = items.find((item) => item.id === '123456');
  assert.equal(first.title, 'iPhone 15 Pro 256 ГБ');
  assert.equal(first.price, 78000);
  assert.equal(first.url, 'https://www.avito.ru/kazan/telefony/iphone_15_pro_123456');
  assert.equal(first.image, 'https://www.avito.ru/1.jpg');
  assert.equal(first.location, 'Казань, Вахитовский район');
  assert.equal(first.publishedAt, 1700000000000);
  assert.equal(first.source, 'web');

  const second = items.find((item) => item.id === '654321');
  assert.equal(second.price, 61500);
  assert.equal(second.url, 'https://www.avito.ru/kazan/telefony/iphone_15_654321');
});

test('parseSearchHtml понимает JSON-LD, если встроенного состояния нет', () => {
  const html = `<html><body>
    <script type="application/ld+json">
    {"@type":"ItemList","itemListElement":[
      {"item":{"name":"MacBook Air","url":"https://www.avito.ru/kazan/noutbuki/1","offers":{"price":"55000"}}}
    ]}
    </script></body></html>`;
  const items = parseSearchHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'MacBook Air');
  assert.equal(items[0].price, 55000);
});

test('parseSearchHtml на мусорной странице возвращает пустой список', () => {
  const items = parseSearchHtml('<html><body>Проверка, что вы не робот</body></html>');
  assert.deepEqual(items, []);
});

test('normalizeItems отбрасывает объявления без id или заголовка', () => {
  const items = normalizeItems([
    { id: 1, title: 'Есть всё', price: 100, urlPath: '/a' },
    { title: 'Без id', price: 100, urlPath: '/b' },
    { id: 3, price: 100, urlPath: '/c' },
  ], 'api');
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://www.avito.ru/a');
});
