'use strict';

/**
 * Движок мониторинга: периодически опрашивает Авито по каждому профилю поиска,
 * сравнивает результаты с историей и сообщает о новых объявлениях и снижении цены.
 *
 * Один тик раз в секунду проверяет, каким профилям пора обновиться.
 * Интервалы рандомизируются, чтобы не долбить Авито ровным строем запросов.
 */

const { EventEmitter } = require('events');
const { fetchPage, SOURCE_LABELS } = require('./sources');
const { matchesKeywords, parsePrice, formatPrice } = require('./sources/util');

const DEFAULT_INTERVAL = 90;
const MIN_INTERVAL = 30;

class Monitor extends EventEmitter {
  constructor({ store }) {
    super();
    this.store = store;
    this.nextRun = new Map();
    this.running = new Set();
    this.results = new Map(); // profileId -> { items, stats, updatedAt, error }
    this.timer = null;
    this.startedAt = null;
  }

  start() {
    if (this.timer) return;
    this.startedAt = Date.now();
    this.rescheduleAll({ immediate: true });
    this.timer = setInterval(() => this.tick(), 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.nextRun.clear();
  }

  intervalFor(profile) {
    const settings = this.store.getSettings();
    const raw = Number(profile.intervalSec) || Number(settings.pollIntervalSec) || DEFAULT_INTERVAL;
    return Math.max(MIN_INTERVAL, raw);
  }

  rescheduleAll({ immediate = false } = {}) {
    const profiles = this.store.getProfiles();
    const ids = new Set(profiles.map((profile) => profile.id));
    for (const id of [...this.nextRun.keys()]) {
      if (!ids.has(id)) this.nextRun.delete(id);
    }
    for (const profile of profiles) {
      if (!profile.enabled) {
        this.nextRun.delete(profile.id);
        continue;
      }
      if (!this.nextRun.has(profile.id) || immediate) {
        this.nextRun.set(profile.id, Date.now() + (immediate ? 300 : this.intervalFor(profile) * 1000));
      }
    }
  }

  tick() {
    const now = Date.now();
    for (const profile of this.store.getProfiles()) {
      if (!profile.enabled || this.running.has(profile.id)) continue;
      const due = this.nextRun.get(profile.id);
      if (!due || now < due) continue;
      this.run(profile.id).catch((error) => {
        this.emit('log', { level: 'error', message: `Ошибка опроса «${profile.name}»: ${error.message}` });
      });
    }
  }

  /** Прогноз времени следующей проверки (для интерфейса). */
  getStatus() {
    const now = Date.now();
    const profiles = this.store.getProfiles();
    return {
      startedAt: this.startedAt,
      running: [...this.running],
      next: Object.fromEntries(profiles.map((profile) => [
        profile.id,
        this.nextRun.get(profile.id) ? Math.max(0, Math.round((this.nextRun.get(profile.id) - now) / 1000)) : null,
      ])),
    };
  }

  getResults(profileId) {
    return this.results.get(profileId) || null;
  }

  /**
   * Опрос одного профиля.
   * @param {string} profileId
   * @param {{manual?: boolean}} options manual — запуск по кнопке (обходит расписание)
   */
  async run(profileId, { manual = false } = {}) {
    const profile = this.store.getProfile(profileId);
    if (!profile) return null;
    if (this.running.has(profileId)) return this.results.get(profileId) || null;

    const settings = this.store.getSettings();
    const state = this.store.loadState(profileId);
    const baselineWasDone = state.baselineDone;
    const interval = this.intervalFor(profile);
    const pages = Math.max(1, Math.min(5, Number(profile.pages) || Number(settings.pages) || 1));

    this.running.add(profileId);
    this.emit('profile-status', { id: profileId, running: true, error: '' });

    const merged = [];
    const seenIds = new Set();
    const warnings = [];
    let sourceUsed = '';
    let failure = null;
    let locationId = null;
    const round = Number(state.totalRuns) || 0;

    try {
      for (let page = 1; page <= pages; page += 1) {
        try {
          const result = await fetchPage(profile, { page, round, locationId });
          locationId = result.locationId || locationId;
          sourceUsed = result.source;
          if (result.warning) warnings.push(result.warning);
          for (const item of result.items) {
            if (seenIds.has(item.id)) continue;
            seenIds.add(item.id);
            merged.push(item);
          }
          if (!result.hasMore) break;
        } catch (error) {
          if (page === 1) failure = error;
          else warnings.push(`Страница ${page}: ${error.message}`);
          break;
        }
      }

      if (!merged.length && failure) throw failure;
      if (!merged.length) {
        warnings.push('Авито не вернул ни одного объявления: возможно, фильтры слишком узкие.');
      }

      // Фильтры на нашей стороне: слова, цена, промо.
      const minPrice = parsePrice(profile.priceMin);
      const maxPrice = parsePrice(profile.priceMax);
      const filtered = merged.filter((item) => {
        if (profile.excludePromo && item.isPromo) return false;
        if (minPrice != null && item.price != null && item.price < minPrice) return false;
        if (maxPrice != null && item.price != null && item.price > maxPrice) return false;
        if (!matchesKeywords(`${item.title} ${item.description}`, {
          plus: profile.keywordsPlus,
          minus: profile.keywordsMinus,
        })) return false;
        return true;
      });

      const now = Date.now();
      const fresh = [];
      const priceDrops = [];
      const current = filtered.map((item) => {
        const prev = state.seen[item.id];
        const entry = {
          ...item,
          firstSeen: prev?.firstSeen || now,
          isNew: false,
          priceDrop: 0,
          seenBefore: Boolean(prev),
        };
        if (!prev) {
          state.seen[item.id] = {
            firstSeen: now,
            price: item.price,
            title: item.title,
            url: item.url,
            image: item.image,
            location: item.location,
          };
          // На самом первом запуске не считаем всё «новым» — иначе прилетит 50 уведомлений.
          if (baselineWasDone) {
            entry.isNew = true;
            fresh.push(entry);
          }
        } else {
          if (item.price != null && prev.price != null && item.price < prev.price) {
            entry.priceDrop = prev.price - item.price;
            priceDrops.push(entry);
          }
          state.seen[item.id].price = item.price ?? state.seen[item.id].price;
          state.seen[item.id].lastSeen = now;
        }
        return entry;
      });

      current.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

      state.items = current.slice(0, 300).map((item) => ({
        id: item.id,
        title: item.title,
        price: item.price,
        url: item.url,
        image: item.image,
        location: item.location,
        publishedAt: item.publishedAt,
        firstSeen: item.firstSeen,
        source: item.source,
        isNew: item.isNew,
        priceDrop: item.priceDrop,
      }));
      state.baselineDone = true;
      state.lastRun = Date.now();
      state.lastError = '';
      state.totalRuns = round + 1;
      state.totalFound = (state.totalFound || 0) + fresh.length;
      this.store.saveState(profileId, state);

      const stats = {
        found: current.length,
        newCount: fresh.length,
        priceDrops: priceDrops.length,
        source: sourceUsed,
        sourceLabel: SOURCE_LABELS[sourceUsed] || sourceUsed,
        warning: warnings.join(' '),
        baseline: !baselineWasDone,
        checkedAt: state.lastRun,
        nextInSec: interval,
      };

      this.results.set(profileId, { items: current, stats, updatedAt: state.lastRun, error: '', profileId });
      this.emit('profile-result', { id: profileId, items: current, stats });
      this.emit('log', {
        level: 'info',
        message: `«${profile.name}»: найдено ${current.length}, новых ${fresh.length} (${stats.sourceLabel})`,
      });

      if (fresh.length) this.emit('new-items', { profile, items: fresh, stats });
      if (priceDrops.length) this.emit('price-drops', { profile, items: priceDrops });

      return this.results.get(profileId);
    } catch (error) {
      state.lastError = error.message;
      state.lastRun = Date.now();
      this.store.saveState(profileId, state);
      const previous = this.results.get(profileId);
      this.results.set(profileId, {
        items: previous?.items || [],
        stats: previous?.stats || null,
        updatedAt: Date.now(),
        error: error.message,
        profileId,
      });
      this.emit('profile-error', { id: profileId, error: error.message });
      this.emit('log', { level: 'error', message: `«${profile.name}»: ${error.message}` });
      return this.results.get(profileId);
    } finally {
      this.running.delete(profileId);
      const jitterMs = Math.random() * Math.min(15, Number(settings.minJitterSec) || 0) * 1000;
      this.nextRun.set(profileId, Date.now() + (manual ? Math.min(interval, 20) : interval) * 1000 + jitterMs);
      this.emit('profile-status', { id: profileId, running: false, error: state.lastError || '' });
    }
  }

  /** Форматирование уведомления о новых объявлениях (используется в main). */
  static summary(profile, items) {
    const first = items[0];
    const more = items.length > 1 ? ` и ещё ${items.length - 1}` : '';
    return `${profile.name}: ${first.title} — ${formatPrice(first.price)}${more}`;
  }
}

module.exports = { Monitor, DEFAULT_INTERVAL, MIN_INTERVAL };
