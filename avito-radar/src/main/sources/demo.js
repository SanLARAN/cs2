'use strict';

/**
 * Демо-источник: генерирует правдоподобные объявления без обращения к сети.
 *
 * Базовый набор объявлений стабилен (одинаковые id при одинаковых фильтрах),
 * а на каждом следующем опросе добавляется 0–2 «только что опубликованных» —
 * так видно, как работает поиск новых объявлений, без риска блокировки от Авито.
 */

const { matchesKeywords, parsePrice } = require('./util');

const TITLES = [
  'iPhone 15 Pro 256 ГБ, идеальное состояние',
  'MacBook Air M2 13" 8/256',
  'PlayStation 5 Slim + 2 геймпада',
  'Самокат электронный Ninebot Max G30',
  'Велосипед горный Trek Marlin 7, рама L',
  'Диван-кровать еврокнижка, ткань рогожка',
  'Стол письменный дубовый 140х70',
  'Кроссовки Nike Air Max 90, 43 размер',
  'Куртка зимняя The North Face, мужская',
  'Робот-пылесос Xiaomi Mi Robot Vacuum',
  'Монитор Dell UltraSharp 27" 2K',
  'Клавиатура механическая Keychron K2',
  'Коляска детская Yoyo Babyzen',
  'Гитара акустическая Yamaha F310',
  'Холодильник Bosch двухкамерный',
  'Кофемашина DeLonghi Magnifica S',
  'Наушники Sony WH-1000XM5',
  'Кресло офисное Herman Miller Aeron',
  'Дрон DJI Mini 4 Pro, комплект Fly More',
  'Книги по программированию, лот 8 шт',
];

const PLACES = [
  'Казань, Вахитовский район',
  'Казань, Ново-Савиновский район',
  'Казань, Приволжский район',
  'Казань, Советский район',
  'Казань, Авиастроительный район',
  'Казань, Кировский район',
  'Казань, Московский район',
];

const DESCRIPTIONS = [
  'Состояние отличное, всё работает. Есть небольшие следы использования.',
  'Покупал в прошлом году, чек и коробка на месте. Торг небольшой.',
  'Срочно, переезжаю. Самовывоз, можно проверить на месте.',
  'Новое, не использовалось, в упаковке.',
  'Идеальное состояние, использовалось аккуратно, без сколов и царапин.',
];

const SELLERS = ['Алексей', 'Марина', 'Ильдар', 'Дина', 'Рустам', 'Ольга', 'Тимур', 'Айгуль'];

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Детерминированный генератор: одинаковые фильтры -> одинаковые объявления. */
function rng(seed) {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function makeItem({ seed, index, min, max, random, keyword, ageMinutes, suffix }) {
  let title = TITLES[Math.floor(random() * TITLES.length)];
  if (keyword && !title.toLowerCase().includes(keyword) && random() > 0.5) {
    title = `${keyword} — ${title.toLowerCase()}`;
  }
  const price = Math.max(500, Math.round((min + random() * (max - min)) / 100) * 100);
  return {
    id: `demo-${seed}-${suffix}${index}`,
    title,
    price,
    priceText: `${price.toLocaleString('ru-RU')} ₽`,
    url: `https://www.avito.ru/demo/${seed}${suffix}${index}`,
    image: '',
    location: PLACES[Math.floor(random() * PLACES.length)],
    description: `${DESCRIPTIONS[Math.floor(random() * DESCRIPTIONS.length)]} Продавец: ${SELLERS[Math.floor(random() * SELLERS.length)]}.`,
    publishedAt: Date.now() - ageMinutes * 60000,
    source: 'demo',
    isPromo: random() > 0.9,
  };
}

/**
 * @param {object} profile профиль поиска
 * @param {{round?: number}} options номер опроса (0 — первый запуск)
 */
function search(profile, { round = 0 } = {}) {
  const signature = `${profile.id}|${profile.query}|${profile.city}|${profile.priceMin}|${profile.priceMax}`;
  const seed = hash(signature);
  const random = rng(seed);
  const min = parsePrice(profile.priceMin) ?? 3000;
  const max = parsePrice(profile.priceMax) ?? 120000;
  const keyword = String(profile.query || '').toLowerCase();
  const baseCount = 12 + Math.floor(rng(seed + 7)() * 6);

  const items = [];

  // 1. Стабильная база — как будто объявления уже висят на Авито.
  for (let i = 0; i < baseCount; i += 1) {
    items.push(makeItem({
      seed,
      index: i,
      min,
      max,
      random,
      keyword,
      ageMinutes: 90 + Math.floor(random() * 60 * 72),
      suffix: 'b',
    }));
  }

  // 2. Свежие публикации: появляются по одной-две с каждым опросом.
  const freshCount = round === 0 ? 0 : Math.min(round, 4);
  for (let i = 0; i < freshCount; i += 1) {
    items.push(makeItem({
      seed,
      index: i,
      min,
      max,
      random,
      keyword,
      ageMinutes: 1 + i * 2,
      suffix: 'n',
    }));
  }

  const filtered = items.filter((item) => matchesKeywords(`${item.title} ${item.description}`, {
    plus: profile.keywordsPlus,
    minus: profile.keywordsMinus,
  }));

  filtered.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  return { items: filtered, hasMore: false, url: 'demo://avito-radar' };
}

module.exports = { search, TITLES, PLACES };
