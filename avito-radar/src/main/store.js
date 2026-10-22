'use strict';

/**
 * Хранилище настроек и истории найденного.
 *
 * config.json            — настройки + список профилей поиска (копируется вручную)
 * data/<profileId>.json  — что уже видели, чтобы находить только новое
 *
 * Формат намеренно простой JSON, чтобы файл можно было открыть глазами
 * и не тянуть зависимости.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_VERSION = 1;

const DEFAULT_SETTINGS = {
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
  maxSeenPerProfile: 5000,
};

const DEFAULT_PROFILE = {
  name: 'Новый поиск',
  enabled: true,
  source: 'auto',
  url: '',
  query: '',
  city: 'kazan',
  categorySlug: '',
  categoryId: '',
  priceMin: '',
  priceMax: '',
  keywordsPlus: '',
  keywordsMinus: '',
  excludePromo: false,
  onlyToday: false,
  sort: 'date',
  pages: 1,
  intervalSec: '', // пусто = использовать общий интервал
};

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    // Битый файл не должен убивать приложение: сохраняем копию и стартуем с чистого.
    try {
      fs.copyFileSync(file, `${file}.broken-${Date.now()}`);
    } catch {
      /* копия не критична */
    }
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function sanitizeProfile(input = {}) {
  const profile = { ...DEFAULT_PROFILE, ...input };
  profile.id = input.id || newId();
  profile.name = String(profile.name || 'Поиск').trim().slice(0, 120) || 'Поиск';
  profile.source = ['auto', 'web', 'api', 'demo'].includes(profile.source) ? profile.source : 'auto';
  profile.url = String(profile.url || '').trim();
  profile.query = String(profile.query || '').trim().slice(0, 200);
  profile.city = String(profile.city || '').trim().slice(0, 120);
  profile.categorySlug = String(profile.categorySlug || '').trim().slice(0, 200);
  profile.categoryId = String(profile.categoryId || '').trim().slice(0, 40);
  profile.priceMin = profile.priceMin === 0 ? '0' : String(profile.priceMin ?? '').trim().slice(0, 12);
  profile.priceMax = profile.priceMax === 0 ? '0' : String(profile.priceMax ?? '').trim().slice(0, 12);
  profile.keywordsPlus = String(profile.keywordsPlus || '').slice(0, 400);
  profile.keywordsMinus = String(profile.keywordsMinus || '').slice(0, 400);
  profile.excludePromo = Boolean(profile.excludePromo);
  profile.onlyToday = Boolean(profile.onlyToday);
  profile.sort = ['date', 'priceAsc', 'priceDesc'].includes(profile.sort) ? profile.sort : 'date';
  profile.pages = Math.max(1, Math.min(5, Number(profile.pages) || 1));
  profile.intervalSec = profile.intervalSec === '' || profile.intervalSec == null ? '' : Math.max(30, Number(profile.intervalSec) || 0) || '';
  profile.enabled = profile.enabled !== false;
  return profile;
}

class Store {
  constructor(userDataDir) {
    this.dir = ensureDir(userDataDir);
    this.dataDir = ensureDir(path.join(this.dir, 'data'));
    this.configPath = path.join(this.dir, 'config.json');
    this.config = this.loadConfig();
  }

  loadConfig() {
    const raw = readJson(this.configPath, {});
    const config = {
      version: CONFIG_VERSION,
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      profiles: Array.isArray(raw.profiles) ? raw.profiles.map(sanitizeProfile) : [],
      ui: raw.ui || {},
    };
    if (!config.profiles.length) {
      config.profiles = [sanitizeProfile({
        name: 'iPhone в Казани',
        source: 'demo',
        query: 'iphone',
        city: 'kazan',
        priceMin: '20000',
        priceMax: '90000',
      })];
      this.saveConfig(config);
    }
    return config;
  }

  saveConfig(config = this.config) {
    writeJsonAtomic(this.configPath, {
      version: CONFIG_VERSION,
      settings: config.settings,
      profiles: config.profiles,
      ui: config.ui || {},
    });
  }

  // ---------- настройки ----------

  getSettings() {
    return { ...this.config.settings };
  }

  updateSettings(patch = {}) {
    const settings = { ...this.config.settings, ...patch };
    settings.pollIntervalSec = Math.max(20, Number(settings.pollIntervalSec) || DEFAULT_SETTINGS.pollIntervalSec);
    settings.pages = Math.max(1, Math.min(5, Number(settings.pages) || 1));
    this.config.settings = settings;
    this.saveConfig();
    return this.getSettings();
  }

  updateUi(patch = {}) {
    this.config.ui = { ...(this.config.ui || {}), ...patch };
    this.saveConfig();
  }

  // ---------- профили ----------

  getProfiles() {
    return this.config.profiles.map((profile) => ({ ...profile }));
  }

  getProfile(id) {
    const found = this.config.profiles.find((profile) => profile.id === id);
    return found ? { ...found } : null;
  }

  addProfile(input) {
    const profile = sanitizeProfile({ ...input, id: undefined });
    this.config.profiles.push(profile);
    this.saveConfig();
    return { ...profile };
  }

  updateProfile(id, patch) {
    const index = this.config.profiles.findIndex((profile) => profile.id === id);
    if (index === -1) return null;
    const merged = sanitizeProfile({ ...this.config.profiles[index], ...patch, id });
    this.config.profiles[index] = merged;
    this.saveConfig();
    return { ...merged };
  }

  removeProfile(id) {
    const index = this.config.profiles.findIndex((profile) => profile.id === id);
    if (index === -1) return false;
    this.config.profiles.splice(index, 1);
    this.saveConfig();
    try {
      fs.unlinkSync(this.statePath(id));
    } catch {
      /* файла могло не быть */
    }
    return true;
  }

  // ---------- состояние профиля (что видели) ----------

  statePath(id) {
    return path.join(this.dataDir, `${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
  }

  loadState(id) {
    const state = readJson(this.statePath(id), null) || {};
    return {
      seen: state.seen && typeof state.seen === 'object' ? state.seen : {},
      baselineDone: Boolean(state.baselineDone),
      lastRun: state.lastRun || null,
      lastError: state.lastError || '',
      totalFound: state.totalFound || 0,
      totalRuns: state.totalRuns || 0,
      items: Array.isArray(state.items) ? state.items : [],
    };
  }

  saveState(id, state) {
    const max = this.config.settings.maxSeenPerProfile || DEFAULT_SETTINGS.maxSeenPerProfile;
    const entries = Object.entries(state.seen || {});
    if (entries.length > max) {
      entries.sort((a, b) => (b[1].firstSeen || 0) - (a[1].firstSeen || 0));
      state.seen = Object.fromEntries(entries.slice(0, max));
    }
    writeJsonAtomic(this.statePath(id), {
      seen: state.seen || {},
      baselineDone: Boolean(state.baselineDone),
      lastRun: state.lastRun || null,
      lastError: state.lastError || '',
      totalFound: state.totalFound || 0,
      totalRuns: state.totalRuns || 0,
      items: (state.items || []).slice(0, 300),
    });
  }

  clearState(id) {
    try {
      fs.unlinkSync(this.statePath(id));
    } catch {
      /* уже нет */
    }
  }

  /** Сводка по всем профилям для стартового экрана. */
  stats() {
    let totalNew = 0;
    let lastRun = null;
    const perProfile = {};
    for (const profile of this.config.profiles) {
      const state = this.loadState(profile.id);
      const fresh = (state.items || []).filter((item) => item.isNew).length;
      perProfile[profile.id] = { newCount: fresh, lastRun: state.lastRun, totalFound: state.totalFound };
      totalNew += fresh;
      if (state.lastRun && (!lastRun || state.lastRun > lastRun)) lastRun = state.lastRun;
    }
    return { totalNew, lastRun, perProfile };
  }
}

module.exports = { Store, DEFAULT_SETTINGS, DEFAULT_PROFILE, sanitizeProfile, CONFIG_VERSION };
