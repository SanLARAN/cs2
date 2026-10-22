'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { toCsv, safeFileName } = require('../src/main/csv');

const ITEMS = [
  {
    id: '123',
    title: 'iPhone 15; 256 ГБ "новый"',
    price: 78000,
    priceDrop: 0,
    location: 'Казань, Вахитовский район',
    isNew: true,
    publishedAt: Date.parse('2024-05-01T10:00:00Z'),
    firstSeen: Date.parse('2024-05-01T10:05:00Z'),
    source: 'web',
    url: 'https://www.avito.ru/kazan/telefony/123',
    description: 'Первая строка\nвторая строка',
  },
];

test('toCsv добавляет BOM и разделитель «;»', () => {
  const csv = toCsv(ITEMS);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('Название;Цена, ₽'));
  assert.ok(csv.includes('"iPhone 15; 256 ГБ ""новый"""'));
  assert.ok(csv.includes('Казань, Вахитовский район'));
});

test('toCsv экранирует переносы строк', () => {
  const csv = toCsv(ITEMS);
  assert.ok(!csv.includes('Первая строка\nвторая строка'));
  assert.ok(csv.includes('Первая строка вторая строка'));
});

test('toCsv пишет заголовок даже без объявлений', () => {
  const csv = toCsv([]);
  assert.equal(csv.trim().split('\r\n').length, 1);
});

test('safeFileName убирает недопустимые символы', () => {
  assert.equal(safeFileName('iPhone / Казань: до 60 000'), 'iPhone - Казань- до 60 000');
  assert.equal(safeFileName(''), 'poisk');
});
