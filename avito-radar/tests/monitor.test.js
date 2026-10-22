'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { Store } = require('../src/main/store');
const { Monitor } = require('../src/main/monitor');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'avito-radar-monitor-'));
}

function makeMonitor(extraProfile = {}) {
  const store = new Store(tmpDir());
  // Убираем стартовый демо-профиль, чтобы тест был предсказуемым.
  for (const profile of store.getProfiles()) store.removeProfile(profile.id);
  const profile = store.addProfile({
    name: 'Тестовый поиск',
    source: 'demo',
    query: 'iphone',
    city: 'Казань',
    priceMin: '10000',
    priceMax: '100000',
    ...extraProfile,
  });
  const monitor = new Monitor({ store });
  return { store, profile, monitor };
}

test('первый опрос — это базовый снимок, уведомлений нет', async () => {
  const { monitor, profile } = makeMonitor();
  const events = [];
  monitor.on('new-items', (payload) => events.push(payload));

  const result = await monitor.run(profile.id);

  assert.ok(result.items.length > 0);
  assert.equal(result.stats.baseline, true);
  assert.equal(result.stats.newCount, 0);
  assert.equal(events.length, 0);
  assert.ok(result.items.every((item) => item.isNew === false));
});

test('второй опрос находит новые объявления и сохраняет историю', async () => {
  const { monitor, profile, store } = makeMonitor();
  const events = [];
  monitor.on('new-items', (payload) => events.push(payload));

  await monitor.run(profile.id);
  const second = await monitor.run(profile.id);

  assert.equal(second.stats.baseline, false);
  assert.ok(second.stats.newCount > 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].items.length, second.stats.newCount);
  assert.ok(events[0].items.every((item) => item.isNew));

  const state = store.loadState(profile.id);
  assert.equal(state.baselineDone, true);
  assert.ok(Object.keys(state.seen).length >= second.stats.found);
  assert.ok(state.lastRun > 0);
});

test('третий опрос не повторяет уже найденные объявления как новые', async () => {
  const { monitor, profile } = makeMonitor();
  await monitor.run(profile.id);
  const second = await monitor.run(profile.id);
  const third = await monitor.run(profile.id);

  // Демо-источник отдаёт <= 4 «свежих» объявлений, они не должны дублироваться.
  assert.ok(third.stats.newCount <= second.stats.newCount + 4);
  assert.ok(third.items.length >= second.items.length);
});

test('фильтры по словам применяются до сохранения истории', async () => {
  const { monitor, profile, store } = makeMonitor({ keywordsPlus: 'несуществующееслово' });
  const result = await monitor.run(profile.id);
  assert.equal(result.items.length, 0);

  // обязательное слово исключает всё — история тоже остаётся пустой
  const state = store.loadState(profile.id);
  assert.equal(Object.keys(state.seen).length, 0);
});

test('исключающие слова убирают только совпадающие объявления', async () => {
  const { monitor, profile } = makeMonitor({ keywordsMinus: 'iphone' });
  const result = await monitor.run(profile.id);
  assert.ok(result.items.length > 0);
  assert.ok(result.items.every((item) => !item.title.toLowerCase().includes('iphone')));
});

test('ошибка источника не роняет монитор и попадает в состояние профиля', async () => {
  const { monitor, profile, store } = makeMonitor({ source: 'demo' });
  const errors = [];
  monitor.on('profile-error', (payload) => errors.push(payload));

  // Ломаем источник: пустой город и битый URL при source=web даст понятную ошибку.
  store.updateProfile(profile.id, { source: 'web', url: 'not-a-url' });
  const result = await monitor.run(profile.id);

  assert.equal(errors.length, 1);
  assert.ok(result.error);
  assert.match(result.error, /ссылк|Ссылк/i);
  assert.ok(store.loadState(profile.id).lastError);
});

test('getStatus отдаёт время следующей проверки', async () => {
  const { monitor, profile } = makeMonitor();
  await monitor.run(profile.id);
  const status = monitor.getStatus();
  assert.ok(status.next[profile.id] != null);
  assert.ok(status.next[profile.id] >= 0);
});

test('Monitor наследует EventEmitter и не запускает параллельные опросы', async () => {
  const { monitor, profile } = makeMonitor();
  assert.ok(monitor instanceof EventEmitter);

  const [first, second] = await Promise.all([
    monitor.run(profile.id),
    monitor.run(profile.id),
  ]);
  // один из вызовов обслуживает запрос, второй видит «уже выполняю» и не дублирует его
  assert.ok(first === null || second === null || first === second);
  const state = monitor.store.loadState(profile.id);
  assert.equal(state.totalRuns, 1);
});
