'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Store, sanitizeProfile, DEFAULT_SETTINGS } = require('../src/main/store');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'avito-radar-test-'));
}

test('Store создаёт стартовый демо-поиск при первом запуске', () => {
  const store = new Store(tmpDir());
  const profiles = store.getProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].source, 'demo');
  assert.equal(store.getSettings().pollIntervalSec, DEFAULT_SETTINGS.pollIntervalSec);
});

test('Store сохраняет и перечитывает профили', () => {
  const dir = tmpDir();
  const store = new Store(dir);
  const created = store.addProfile({ name: 'Велосипед', query: 'велосипед', city: 'Казань', priceMax: '40000' });
  assert.ok(created.id);

  const reopened = new Store(dir);
  const found = reopened.getProfiles().find((profile) => profile.id === created.id);
  assert.ok(found);
  assert.equal(found.name, 'Велосипед');
  assert.equal(found.priceMax, '40000');
});

test('Store обновляет и удаляет профиль вместе с историей', () => {
  const store = new Store(tmpDir());
  const profile = store.addProfile({ name: 'Тест', query: 'iphone' });

  store.saveState(profile.id, { seen: { 1: { firstSeen: Date.now() } }, baselineDone: true });
  assert.equal(Object.keys(store.loadState(profile.id).seen).length, 1);

  const updated = store.updateProfile(profile.id, { name: 'Тест 2', enabled: false });
  assert.equal(updated.name, 'Тест 2');
  assert.equal(updated.enabled, false);

  assert.equal(store.removeProfile(profile.id), true);
  assert.equal(store.getProfile(profile.id), null);
  assert.equal(fs.existsSync(store.statePath(profile.id)), false);
});

test('Store ограничивает историю просмотренного', () => {
  const store = new Store(tmpDir());
  store.updateSettings({ maxSeenPerProfile: 10 });
  const profile = store.addProfile({ name: 'Лимит', query: 'x' });

  const seen = {};
  for (let i = 0; i < 25; i += 1) seen[i] = { firstSeen: 1000 + i, price: 100 };
  store.saveState(profile.id, { seen, baselineDone: true });

  const restored = store.loadState(profile.id);
  assert.equal(Object.keys(restored.seen).length, 10);
  // остаются самые свежие
  assert.ok(restored.seen['24']);
  assert.equal(restored.seen['0'], undefined);
});

test('Store чинит битый config.json', () => {
  const dir = tmpDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), '{ битый json', 'utf8');
  const store = new Store(dir);
  assert.equal(store.getProfiles().length, 1);
  const backups = fs.readdirSync(dir).filter((file) => file.includes('.broken-'));
  assert.equal(backups.length, 1);
});

test('sanitizeProfile приводит поля к безопасному виду', () => {
  const profile = sanitizeProfile({
    name: '  Тест  ',
    source: 'неизвестно',
    pages: 99,
    intervalSec: 5,
    sort: 'хаос',
    priceMin: 0,
    enabled: 'нет',
  });
  assert.equal(profile.name, 'Тест');
  assert.equal(profile.source, 'auto');
  assert.equal(profile.pages, 5);
  assert.equal(profile.intervalSec, 30);
  assert.equal(profile.sort, 'date');
  assert.equal(profile.priceMin, '0');
  assert.equal(profile.enabled, true);
});
