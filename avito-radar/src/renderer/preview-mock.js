'use strict';

/**
 * Заглушка Electron-моста для предпросмотра интерфейса в обычном браузере.
 *
 * В приложении файл ничего не делает: `window.avitoRadar` уже создан preload-скриптом.
 * В браузере он поднимает демо-состояние, чтобы можно было посмотреть вёрстку
 * и пролистать объявления без установки.
 */

(() => {
  if (window.avitoRadar) return;

  window.__AVITO_RADAR_PREVIEW__ = true;

  const listeners = new Map();
  const emit = (channel, payload) => {
    for (const callback of listeners.get(channel) || []) callback(payload);
  };
  const on = (channel, callback) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(callback);
    return () => listeners.get(channel)?.delete(callback);
  };

  const settings = {
    pollIntervalSec: 90,
    minJitterSec: 2,
    pages: 1,
    notifyDesktop: true,
    notifySound: true,
    notifyTelegram: false,
    telegramToken: '',
    telegramChatId: '',
    openOnNew: false,
    minimizeToTray: true,
    theme: 'dark',
  };

  const profiles = [
    {
      id: 'demo-iphone',
      name: 'iPhone 15 в Казани',
      enabled: true,
      source: 'demo',
      url: '',
      query: 'iphone 15',
      city: 'Казань',
      categorySlug: '',
      categoryId: '',
      priceMin: '30000',
      priceMax: '90000',
      keywordsPlus: '',
      keywordsMinus: 'битый, на запчасти',
      excludePromo: false,
      onlyToday: false,
      sort: 'date',
      pages: 1,
      intervalSec: '',
    },
    {
      id: 'demo-bike',
      name: 'Велосипед до 40 000',
      enabled: true,
      source: 'demo',
      url: '',
      query: 'велосипед',
      city: 'Казань',
      categorySlug: '',
      categoryId: '',
      priceMin: '8000',
      priceMax: '40000',
      keywordsPlus: '',
      keywordsMinus: '',
      excludePromo: false,
      onlyToday: false,
      sort: 'date',
      pages: 1,
      intervalSec: '120',
    },
  ];

  const TITLES = [
    ['iPhone 15 Pro 256 ГБ, титан, идеал', 74000],
    ['iPhone 15 128 ГБ, чёрный, полный комплект', 61500],
    ['iPhone 15 Pro Max 512 ГБ, гарантия', 89900],
    ['iPhone 15, 128 ГБ, новый, запечатан', 69000],
    ['iPhone 15 Pro 128 ГБ, аккумулятор 100%', 68000],
    ['iPhone 15 Plus 256 ГБ, чехол в подарок', 72000],
    ['Велосипед горный Trek Marlin 7, рама L', 34500],
    ['Самокат электронный Ninebot Max G30', 28000],
    ['Велосипед гравийный Merida Silex 400', 39000],
    ['Скейтборд cruiser, новый', 9500],
    ['iPhone 15 Pro 256 ГБ, есть скол на рамке', 62000],
    ['iPhone 15 256 ГБ, синий, батарея 98%', 66000],
  ];

  const DISTRICTS = [
    'Вахитовский район',
    'Ново-Савиновский район',
    'Приволжский район',
    'Советский район',
    'Авиастроительный район',
    'Кировский район',
    'Московский район',
  ];

  const DESCRIPTIONS = [
    'Состояние отличное, всё работает. Комплект: коробка, кабель, чек.',
    'Покупал в прошлом году в официальном магазине. Торг небольшой.',
    'Срочно, переезжаю. Самовывоз, проверка на месте.',
    'Новое, не использовалось, в упаковке, гарантия магазина.',
    'Идеальное состояние, использовалось аккуратно, без сколов и царапин.',
  ];

  let seedCounter = 1;
  const results = new Map();

  function makeItem(profile, index, isNew, ageMin) {
    const pool = profile.id === 'demo-bike'
      ? TITLES.filter(([title]) => /вело|самокат|скейт|Ninebot|Trek|Merida|Silex/i.test(title))
      : TITLES;
    const [title, basePrice] = pool[index % pool.length];
    seedCounter += 1;
    const price = Math.max(2000, basePrice - (index % 4) * 1500);
    return {
      id: `preview-${profile.id}-${seedCounter}`,
      title,
      price,
      priceText: `${price.toLocaleString('ru-RU')} ₽`,
      url: 'https://www.avito.ru/kazan',
      image: `https://picsum.photos/seed/avito${seedCounter}/240/200`,
      location: `Казань, ${DISTRICTS[index % DISTRICTS.length]}`,
      description: DESCRIPTIONS[index % DESCRIPTIONS.length],
      publishedAt: Date.now() - ageMin * 60000,
      firstSeen: Date.now() - Math.max(1, ageMin - 5) * 60000,
      seenBefore: !isNew,
      isNew,
      priceDrop: index === 2 ? 4000 : 0,
      source: 'demo',
    };
  }

  function buildResult(profile, withFresh = false) {
    const items = [];
    const count = profile.id === 'demo-bike' ? 5 : 9;
    for (let i = 0; i < count; i += 1) {
      items.push(makeItem(profile, i, i < 2 && !results.has(profile.id), 3 + i * 17));
    }
    if (withFresh) items.unshift(makeItem(profile, 3, true, 1));
    items.sort((a, b) => b.publishedAt - a.publishedAt);
    return {
      profileId: profile.id,
      items,
      updatedAt: Date.now(),
      error: '',
      stats: {
        found: items.length,
        newCount: items.filter((item) => item.isNew).length,
        priceDrops: items.filter((item) => item.priceDrop > 0).length,
        source: 'demo',
        sourceLabel: 'Демо',
        warning: '',
        checkedAt: Date.now(),
      },
    };
  }

  function nextIn() {
    return Object.fromEntries(profiles.map((profile) => [profile.id, 25 + Math.floor(Math.random() * 60)]));
  }

  window.avitoRadar = {
    platform: 'preview',
    on,
    async invoke(channel, ...args) {
      switch (channel) {
        case 'app:get-state':
          return {
            version: '1.0.0-preview',
            platform: 'preview',
            settings,
            profiles,
            stats: { totalNew: 4, lastRun: Date.now() },
            status: { running: [], next: nextIn() },
            logs: [
              { level: 'info', message: 'Предпросмотр интерфейса: данные демонстрационные', at: Date.now() - 60000 },
              { level: 'info', message: '«iPhone 15 в Казани»: найдено 9, новых 2 (Демо)', at: Date.now() - 30000 },
            ],
            userDataPath: '%APPDATA%\\avito-radar',
            sources: [],
          };
        case 'profiles:get-results': {
          const profile = profiles.find((item) => item.id === args[0]);
          if (!profile) return null;
          if (!results.has(profile.id)) results.set(profile.id, buildResult(profile));
          return results.get(profile.id);
        }
        case 'profiles:run': {
          const profile = profiles.find((item) => item.id === args[0]);
          if (!profile) return null;
          emit('profile-status', { id: profile.id, running: true, error: '' });
          await new Promise((resolve) => setTimeout(resolve, 900));
          const result = buildResult(profile, true);
          results.set(profile.id, result);
          emit('profile-result', { id: profile.id, items: result.items, stats: result.stats });
          emit('profile-status', { id: profile.id, running: false, error: '' });
          emit('new-items', { profile, items: result.items.filter((item) => item.isNew), stats: result.stats });
          return result;
        }
        case 'profiles:add': {
          const profile = { ...args[0], id: `preview-${Date.now()}` };
          profiles.push(profile);
          emit('config-changed', {});
          return profile;
        }
        case 'profiles:update': {
          const profile = profiles.find((item) => item.id === args[0]?.id);
          if (profile) Object.assign(profile, args[0].patch);
          emit('config-changed', {});
          return profile;
        }
        case 'profiles:remove': {
          const index = profiles.findIndex((item) => item.id === args[0]);
          if (index >= 0) profiles.splice(index, 1);
          emit('config-changed', {});
          return true;
        }
        case 'settings:update':
          Object.assign(settings, args[0] || {});
          emit('config-changed', {});
          return settings;
        case 'export:csv':
          return { ok: false, error: 'В предпросмотре экспорт недоступен — только в установленном приложении.' };
        case 'notify:test':
          return { ok: true, supported: true };
        case 'telegram:test':
          return { ok: false, error: 'В предпросмотре Telegram недоступен.' };
        case 'shell:open-external':
          window.open(args[0], '_blank', 'noopener');
          return true;
        case 'app:open-userdata':
          return true;
        case 'ui:save':
        case 'app:hide':
        case 'app:quit':
        case 'profiles:run-all':
        case 'profiles:clear-history':
          return true;
        default:
          return null;
      }
    },
  };
})();
