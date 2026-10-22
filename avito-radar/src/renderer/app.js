'use strict';

/**
 * Интерфейс Avito Radar.
 * Никакой бизнес-логики: только отрисовка состояния, приходящего из главного процесса.
 */

(() => {
  const api = window.avitoRadar;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const ICON = {
    open: '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3ZM5 5h6v2H7v10h10v-4h2v6H5V5Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 3h10a2 2 0 0 1 2 2v10h-2V5H9V3ZM5 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm0 2v10h10V9H5Z"/></svg>',
    hide: '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7Zm0 2c-3.7 0-6.9 3.4-6.9 5s3.2 5 6.9 5 6.9-3.4 6.9-5-3.2-5-6.9-5Zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7Zm0 4.5A2.5 2.5 0 1 0 12 11a2.5 2.5 0 0 0 0-4.5Z"/></svg>',
    noimg: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M21 5v14H3V5h18Zm-2 2H5v8.6l3.8-3.8 2.8 2.8 3.4-4.2L19 14.6V7Zm-4 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"/></svg>',
  };

  const SOURCE_LABELS = { auto: 'Авто', web: 'Сайт', api: 'API', demo: 'Демо' };

  const state = {
    settings: {},
    profiles: [],
    activeId: null,
    results: new Map(),
    running: new Set(),
    errors: new Map(),
    nextAt: new Map(),
    tab: 'all',
    filter: '',
    sort: 'new',
    hidden: new Map(),
    logs: [],
    version: '',
    pendingRun: new Set(),
  };

  const STORAGE_KEY = 'avito-radar-ui-v1';

  // ─────────────────────────── утилиты ───────────────────────────

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    if (value == null || value === '') return '';
    return `${Number(value).toLocaleString('ru-RU')} ₽`;
  }

  function timeAgo(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'только что';
    const min = Math.floor(diff / 60000);
    if (min < 60) return `${min} мин назад`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours} ч назад`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'вчера';
    if (days < 7) return `${days} дн назад`;
    return new Date(timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  function clock(seconds) {
    if (seconds == null) return '—';
    const total = Math.max(0, Math.round(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function dateTime(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  const TRANSLIT = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };

  function citySlug(input) {
    return String(input || '')
      .trim()
      .toLowerCase()
      .split('')
      .map((char) => (TRANSLIT[char] !== undefined ? TRANSLIT[char] : char))
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function loadUi() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (raw.activeId) state.activeId = raw.activeId;
      if (raw.hidden && typeof raw.hidden === 'object') {
        for (const [id, list] of Object.entries(raw.hidden)) state.hidden.set(id, new Set(list));
      }
      if (raw.sort) state.sort = raw.sort;
    } catch {
      /* повреждённое локальное состояние не критично */
    }
  }

  function saveUi() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        activeId: state.activeId,
        sort: state.sort,
        hidden: Object.fromEntries([...state.hidden.entries()].map(([id, set]) => [id, [...set]])),
      }));
    } catch {
      /* нет доступа к localStorage — игнорируем */
    }
  }

  function activeProfile() {
    return state.profiles.find((profile) => profile.id === state.activeId) || null;
  }

  function currentResult() {
    return state.results.get(state.activeId) || null;
  }

  function hiddenSet(profileId = state.activeId) {
    if (!state.hidden.has(profileId)) state.hidden.set(profileId, new Set());
    return state.hidden.get(profileId);
  }

  // ─────────────────────────── тосты и звук ───────────────────────────

  function toast(title, text = '', kind = 'ok', timeout = 6000) {
    const node = document.createElement('div');
    node.className = `toast ${kind === 'ok' ? '' : kind}`.trim();
    node.innerHTML = `<strong>${esc(title)}</strong>${text ? `<span>${esc(text)}</span>` : ''}`;
    node.addEventListener('click', () => node.remove());
    $('#toasts').appendChild(node);
    setTimeout(() => {
      node.style.transition = 'opacity .25s, transform .25s';
      node.style.opacity = '0';
      node.style.transform = 'translateX(14px)';
      setTimeout(() => node.remove(), 260);
    }, timeout);
  }

  let audioContext = null;
  function beep() {
    if (!state.settings.notifySound) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioContext.currentTime;
      [880, 1180].forEach((freq, index) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + index * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.16, now + index * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.12 + 0.22);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now + index * 0.12);
        osc.stop(now + index * 0.12 + 0.25);
      });
    } catch {
      /* звук недоступен — не мешаем работе */
    }
  }

  // ─────────────────────────── загрузка состояния ───────────────────────────

  async function loadState() {
    const config = await api.invoke('app:get-state');
    state.settings = config.settings || {};
    state.profiles = config.profiles || [];
    state.version = config.version || '';
    state.logs = config.logs || [];
    state.userDataPath = config.userDataPath || '';
    if (config.status?.next) {
      for (const [id, seconds] of Object.entries(config.status.next)) {
        if (seconds != null) state.nextAt.set(id, Date.now() + seconds * 1000);
      }
    }
    if (!state.profiles.some((profile) => profile.id === state.activeId)) {
      state.activeId = state.profiles[0]?.id || null;
    }
    renderAll();
    if (state.activeId) await loadResults(state.activeId);
  }

  async function loadResults(id) {
    try {
      const result = await api.invoke('profiles:get-results', id);
      if (result) {
        state.results.set(id, result);
        if (result.error) state.errors.set(id, result.error);
        else state.errors.delete(id);
      }
    } catch (error) {
      state.errors.set(id, error.message);
    }
    renderAll();
  }

  // ─────────────────────────── отрисовка ───────────────────────────

  function renderAll() {
    renderSidebar();
    renderProfileView();
    renderLogs();
  }

  function renderSidebar() {
    const list = $('#profileList');
    $('#profilesCount').textContent = String(state.profiles.length);
    $('#sidebarEmpty').hidden = state.profiles.length > 0;

    const items = state.profiles.map((profile) => {
      const result = state.results.get(profile.id);
      const newCount = result ? result.items.filter((item) => item.isNew).length : 0;
      const busy = state.running.has(profile.id);
      const error = state.errors.get(profile.id);
      const dotClass = busy ? 'busy' : !profile.enabled ? 'off' : error ? 'err' : '';
      const subtitle = busy
        ? 'проверяю…'
        : !profile.enabled
          ? 'выключен'
          : error
            ? 'ошибка — подробнее внутри'
            : result
              ? `найдено ${result.items.length} · ${timeAgo(result.updatedAt)}`
              : 'ещё не проверялся';
      return `
        <button class="profile-item ${profile.id === state.activeId ? 'active' : ''}" data-profile="${esc(profile.id)}">
          <span class="profile-dot ${dotClass}"></span>
          <span class="profile-info">
            <span class="profile-name">${esc(profile.name)}</span>
            <span class="profile-meta">${esc(subtitle)}</span>
          </span>
          <span class="profile-badge ${newCount ? '' : 'zero'}">${newCount || 0}</span>
        </button>`;
    });
    list.innerHTML = items.join('');

    const busyCount = state.running.size;
    $('#monitorState').textContent = busyCount ? `проверяю ${busyCount} ${busyCount === 1 ? 'поиск' : 'поиска'}…` : `слежу · каждые ${state.settings.pollIntervalSec || 90} с`;
    $('#monitorPulse').className = `pulse ${busyCount ? '' : 'on'}`;
    $('#btnRunAll').disabled = state.profiles.length === 0;
  }

  function renderProfileView() {
    const profile = activeProfile();
    $('#emptyScreen').hidden = Boolean(profile);
    $('#profileView').hidden = !profile;
    if (!profile) return;

    const result = currentResult();
    const items = visibleItems(result?.items || []);
    const all = result?.items || [];
    const newCount = all.filter((item) => item.isNew).length;
    const dropCount = all.filter((item) => item.priceDrop > 0).length;

    $('#headName').textContent = profile.name;
    $('#headSource').textContent = SOURCE_LABELS[profile.source] || profile.source;
    const enabledChip = $('#headEnabled');
    enabledChip.textContent = profile.enabled ? 'включён' : 'на паузе';
    enabledChip.className = `chip chip-quiet ${profile.enabled ? '' : 'off'}`;

    const subParts = [];
    if (profile.query) subParts.push(`«${profile.query}»`);
    if (profile.url) subParts.push('по ссылке Авито');
    if (profile.city) subParts.push(profile.city);
    if (profile.priceMin || profile.priceMax) {
      subParts.push(`${profile.priceMin ? `от ${money(profile.priceMin)}` : ''} ${profile.priceMax ? `до ${money(profile.priceMax)}` : ''}`.trim());
    }
    if (profile.keywordsPlus) subParts.push(`+${profile.keywordsPlus}`);
    if (profile.keywordsMinus) subParts.push(`−${profile.keywordsMinus}`);
    subParts.push(`каждые ${profile.intervalSec || state.settings.pollIntervalSec || 90} с`);
    $('#headSub').textContent = subParts.join(' · ');

    $('#statFound').textContent = String(all.length);
    $('#statNew').textContent = String(newCount);
    $('#statDrops').textContent = String(dropCount);

    const nextAt = state.nextAt.get(profile.id);
    $('#statNext').textContent = state.running.has(profile.id)
      ? 'идёт'
      : nextAt ? clock(Math.max(0, (nextAt - Date.now()) / 1000)) : '—';
    $('#statChecked').textContent = result?.updatedAt ? `проверено ${timeAgo(result.updatedAt)}` : 'ещё не проверялся';

    $('#tabNewCount').textContent = String(newCount);
    $('#tabDropCount').textContent = String(dropCount);

    const notice = $('#notice');
    const error = state.errors.get(profile.id) || result?.error;
    const warning = result?.stats?.warning;
    if (error) {
      notice.hidden = false;
      notice.className = 'notice error';
      notice.textContent = `Ошибка: ${error}`;
    } else if (warning) {
      notice.hidden = false;
      notice.className = 'notice';
      notice.textContent = warning;
    } else if (!profile.enabled) {
      notice.hidden = false;
      notice.className = 'notice';
      notice.textContent = 'Поиск на паузе — автопроверка отключена. Нажмите «Обновить», чтобы проверить вручную.';
    } else {
      notice.hidden = true;
    }

    renderCards(items, all);
    const runButton = $('#btnRunOne');
    runButton.disabled = state.running.has(profile.id);
    runButton.classList.toggle('loading', state.running.has(profile.id));
  }

  function visibleItems(all) {
    const hidden = hiddenSet();
    const filter = state.filter.trim().toLowerCase();
    let list = all.filter((item) => !hidden.has(item.id));

    if (state.tab === 'new') list = list.filter((item) => item.isNew);
    if (state.tab === 'drop') list = list.filter((item) => item.priceDrop > 0);
    if (filter) {
      list = list.filter((item) => `${item.title} ${item.location} ${item.description}`.toLowerCase().includes(filter));
    }

    const sorted = [...list];
    if (state.sort === 'fresh') sorted.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    else if (state.sort === 'expensive') sorted.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    else sorted.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    return sorted;
  }

  function renderCards(items, all) {
    const container = $('#cards');
    const empty = $('#listEmpty');
    const emptyText = $('#listEmptyText');

    if (!items.length) {
      container.innerHTML = '';
      empty.hidden = false;
      const hasAny = all.length > 0;
      emptyText.textContent = hasAny
        ? 'По текущему фильтру ничего нет. Попробуйте другую вкладку или очистите поиск.'
        : 'Здесь появятся объявления после первой проверки. Нажмите «Обновить».';
      return;
    }
    empty.hidden = true;

    container.innerHTML = items.map((item, index) => {
      const badges = [];
      if (item.isNew) badges.push('<span class="badge badge-new">новое</span>');
      if (item.priceDrop > 0) badges.push(`<span class="badge badge-drop">−${esc(money(item.priceDrop))}</span>`);
      if (item.source === 'demo') badges.push('<span class="badge badge-time">демо</span>');
      if (item.publishedAt) badges.push(`<span class="badge badge-time">${esc(timeAgo(item.publishedAt))}</span>`);

      const meta = [];
      if (item.location) meta.push(`${ICON.pin} ${esc(item.location)}`);
      if (item.firstSeen && item.seenBefore) meta.push(`впервые найдено ${esc(timeAgo(item.firstSeen))}`);

      return `
      <article class="card ${item.isNew ? 'is-new' : ''}" data-id="${esc(item.id)}" style="animation-delay:${Math.min(index * 18, 200)}ms">
        <div class="thumb" ${item.image ? `style="background-image:url('${esc(item.image)}')"` : ''}>
          ${item.image ? '' : ICON.noimg}
        </div>
        <div class="card-body">
          <div class="card-top">
            <span class="price ${item.price == null ? 'none' : ''}">${esc(item.price == null ? 'Цена не указана' : money(item.price))}</span>
            <span class="badges">${badges.join('')}</span>
          </div>
          <h3 class="card-title">${esc(item.title)}</h3>
          ${meta.length ? `<div class="card-meta">${meta.join('<span class="dot">·</span>')}</div>` : ''}
          ${item.description ? `<p class="card-desc">${esc(item.description)}</p>` : ''}
          <div class="card-actions">
            <button class="link-btn primary" data-action="open">${ICON.open} Открыть на Авито</button>
            <button class="link-btn" data-action="copy">${ICON.copy} Скопировать ссылку</button>
            <button class="link-btn" data-action="hide">${ICON.hide} Скрыть</button>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  function renderLogs() {
    const view = $('#logView');
    if (!view) return;
    const lines = state.logs.slice(-80).map((entry) => {
      const time = new Date(entry.at || Date.now()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `<div class="log-line ${entry.level === 'error' ? 'error' : ''}"><span class="time">${time}</span>${esc(entry.message)}</div>`;
    });
    view.innerHTML = lines.join('') || '<span class="muted">Пока пусто.</span>';
    view.scrollTop = view.scrollHeight;
  }

  // ─────────────────────────── действия ───────────────────────────

  async function selectProfile(id) {
    if (!id) return;
    state.activeId = id;
    state.filter = '';
    $('#filterText').value = '';
    state.tab = 'all';
    $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'all'));
    saveUi();
    renderAll();
    if (!state.results.has(id)) await loadResults(id);
  }

  async function runProfile(id, { silent = false } = {}) {
    if (!id || state.running.has(id)) return;
    state.running.add(id);
    state.errors.delete(id);
    renderAll();
    if (!silent) toast('Проверяю Авито…', activeProfile()?.name || '', 'ok', 2500);
    try {
      const result = await api.invoke('profiles:run', id);
      if (result) {
        state.results.set(id, result);
        if (result.error) {
          state.errors.set(id, result.error);
          if (!silent) toast('Не получилось', result.error, 'error', 9000);
        }
      }
    } catch (error) {
      state.errors.set(id, error.message);
      toast('Ошибка запуска', error.message, 'error');
    } finally {
      state.running.delete(id);
      const profile = state.profiles.find((entry) => entry.id === id);
      state.nextAt.set(id, Date.now() + (Number(profile?.intervalSec) || state.settings.pollIntervalSec || 90) * 1000);
      renderAll();
    }
  }

  async function runAll() {
    if (!state.profiles.length) return;
    toast('Проверяю все поиски…', `Всего: ${state.profiles.length}`, 'ok', 3000);
    for (const profile of state.profiles) {
      // eslint-disable-next-line no-await-in-loop
      await runProfile(profile.id, { silent: true });
    }
    toast('Проверка завершена', '', 'ok', 3000);
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      toast('Ссылка скопирована', url, 'ok', 3000);
    } catch {
      toast('Не удалось скопировать', 'Откройте объявление и скопируйте адрес вручную', 'warn');
    }
  }

  // ─────────────────────────── модальное окно профиля ───────────────────────────

  function openProfileModal(profile = null) {
    const form = $('#profileForm');
    form.reset();
    $('#profileFormError').hidden = true;
    $('#profileModalTitle').textContent = profile ? 'Фильтры поиска' : 'Новый поиск';

    const values = profile || {
      name: '',
      source: 'auto',
      url: '',
      query: '',
      city: 'Казань',
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
      intervalSec: '',
      enabled: true,
    };

    form.elements.id.value = profile?.id || '';
    form.elements.name.value = values.name || '';
    form.elements.url.value = values.url || '';
    form.elements.query.value = values.query || '';
    form.elements.city.value = values.city || '';
    form.elements.categorySlug.value = values.categorySlug || '';
    form.elements.categoryId.value = values.categoryId || '';
    form.elements.priceMin.value = values.priceMin || '';
    form.elements.priceMax.value = values.priceMax || '';
    form.elements.keywordsPlus.value = values.keywordsPlus || '';
    form.elements.keywordsMinus.value = values.keywordsMinus || '';
    form.elements.pages.value = values.pages || 1;
    form.elements.intervalSec.value = values.intervalSec || '';
    form.elements.enabled.checked = values.enabled !== false;
    form.elements.excludePromo.checked = Boolean(values.excludePromo);
    form.elements.onlyToday.checked = Boolean(values.onlyToday);
    const sourceInput = form.querySelector(`input[name="source"][value="${values.source || 'auto'}"]`);
    if (sourceInput) sourceInput.checked = true;

    updateSourceHint();
    showModal('profileModal');
    setTimeout(() => $('#pfName').focus(), 50);
  }

  function updateSourceHint() {
    const source = $('#profileForm').querySelector('input[name="source"]:checked')?.value || 'auto';
    const hints = {
      auto: 'Авто: сначала мобильное API, при ошибке — страница сайта.',
      web: 'Сайт: полный набор фильтров, включая районы — работает по ссылке на поиск.',
      api: 'Мобильное API: быстрый JSON, но часть фильтров недоступна. Укажите город и запрос.',
      demo: 'Демо: объявления генерируются локально. Безопасно для проверки приложения.',
    };
    $('#sourceHint').textContent = hints[source];
  }

  function buildAvitoUrl() {
    const form = $('#profileForm');
    const city = citySlug(form.elements.city.value) || 'kazan';
    const category = String(form.elements.categorySlug.value || '').trim().replace(/^\/+|\/+$/g, '');
    const url = new URL(`https://www.avito.ru/${city}/${category ? `${category}/` : ''}`);
    const query = String(form.elements.query.value || '').trim();
    if (query) url.searchParams.set('q', query);
    const min = String(form.elements.priceMin.value || '').replace(/[^\d]/g, '');
    const max = String(form.elements.priceMax.value || '').replace(/[^\d]/g, '');
    if (min) url.searchParams.set('pmin', min);
    if (max) url.searchParams.set('pmax', max);
    if (form.elements.onlyToday.checked) url.searchParams.set('d', '1');
    url.searchParams.set('s', '104');
    return url.toString();
  }

  async function saveProfile(event) {
    event.preventDefault();
    const form = $('#profileForm');
    const error = $('#profileFormError');
    const payload = {
      name: form.elements.name.value.trim(),
      source: form.querySelector('input[name="source"]:checked')?.value || 'auto',
      url: form.elements.url.value.trim(),
      query: form.elements.query.value.trim(),
      city: form.elements.city.value.trim(),
      categorySlug: form.elements.categorySlug.value.trim(),
      categoryId: form.elements.categoryId.value.trim(),
      priceMin: form.elements.priceMin.value.replace(/[^\d]/g, ''),
      priceMax: form.elements.priceMax.value.replace(/[^\d]/g, ''),
      keywordsPlus: form.elements.keywordsPlus.value.trim(),
      keywordsMinus: form.elements.keywordsMinus.value.trim(),
      excludePromo: form.elements.excludePromo.checked,
      onlyToday: form.elements.onlyToday.checked,
      pages: Number(form.elements.pages.value) || 1,
      intervalSec: form.elements.intervalSec.value.trim(),
      enabled: form.elements.enabled.checked,
    };

    const problems = [];
    if (!payload.name) problems.push('Укажите название поиска.');
    if (payload.source !== 'demo' && !payload.url && !payload.query) {
      problems.push('Нужен запрос («что ищем») или готовая ссылка на поиск Авито.');
    }
    if (payload.priceMin && payload.priceMax && Number(payload.priceMin) > Number(payload.priceMax)) {
      problems.push('Цена «от» больше цены «до».');
    }
    if (problems.length) {
      error.hidden = false;
      error.textContent = problems.join(' ');
      return;
    }

    const id = form.elements.id.value;
    let saved;
    try {
      if (id) saved = await api.invoke('profiles:update', { id, patch: payload });
      else saved = await api.invoke('profiles:add', payload);
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
      return;
    }

    hideModal('profileModal');
    await loadState();
    if (saved?.id) {
      await selectProfile(saved.id);
      toast('Поиск сохранён', 'Запускаю первую проверку…', 'ok', 3000);
      runProfile(saved.id, { silent: true });
    }
  }

  async function deleteProfile() {
    const profile = activeProfile();
    if (!profile) return;
    const ok = window.confirm(`Удалить поиск «${profile.name}» вместе с историей найденного?`);
    if (!ok) return;
    await api.invoke('profiles:remove', profile.id);
    state.results.delete(profile.id);
    state.activeId = null;
    await loadState();
    toast('Поиск удалён', '', 'ok', 2500);
  }

  // ─────────────────────────── настройки ───────────────────────────

  function openSettings() {
    const settings = state.settings;
    $('#stPoll').value = settings.pollIntervalSec ?? 90;
    $('#stPages').value = settings.pages ?? 1;
    $('#stJitter').value = settings.minJitterSec ?? 2;
    $('#stDesktop').checked = settings.notifyDesktop !== false;
    $('#stSound').checked = settings.notifySound !== false;
    $('#stTray').checked = settings.minimizeToTray !== false;
    $('#stOpenOnNew').checked = Boolean(settings.openOnNew);
    $('#stTgEnabled').checked = Boolean(settings.notifyTelegram);
    $('#stTgToken').value = settings.telegramToken || '';
    $('#stTgChat').value = settings.telegramChatId || '';
    $('#userDataPath').textContent = state.userDataPath || '—';
    $('#versionLabel').textContent = state.version ? `v${state.version}` : '';
    $('#tgStatus').textContent = '';
    $('#tgStatus').className = 'inline-status';
    renderLogs();
    showModal('settingsModal');
  }

  function collectSettings() {
    return {
      pollIntervalSec: Number($('#stPoll').value) || 90,
      pages: Number($('#stPages').value) || 1,
      minJitterSec: Number($('#stJitter').value) || 0,
      notifyDesktop: $('#stDesktop').checked,
      notifySound: $('#stSound').checked,
      minimizeToTray: $('#stTray').checked,
      openOnNew: $('#stOpenOnNew').checked,
      notifyTelegram: $('#stTgEnabled').checked,
      telegramToken: $('#stTgToken').value.trim(),
      telegramChatId: $('#stTgChat').value.trim(),
    };
  }

  async function saveSettings() {
    try {
      await api.invoke('settings:update', collectSettings());
      hideModal('settingsModal');
      await loadState();
      toast('Настройки сохранены', '', 'ok', 2500);
    } catch (error) {
      toast('Не удалось сохранить', error.message, 'error');
    }
  }

  // ─────────────────────────── модальные окна ───────────────────────────

  function showModal(id) {
    document.getElementById(id).hidden = false;
  }
  function hideModal(id) {
    document.getElementById(id).hidden = true;
  }

  // ─────────────────────────── события ───────────────────────────

  function bindUi() {
    $('#btnNewProfile').addEventListener('click', () => openProfileModal(null));
    $('#btnEmptyNew').addEventListener('click', () => openProfileModal(null));
    $('#btnRunAll').addEventListener('click', runAll);
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnSaveSettings').addEventListener('click', saveSettings);
    $('#btnRunAllSettings').addEventListener('click', async () => {
      await saveSettings();
      runAll();
    });
    $('#btnOpenUserData').addEventListener('click', () => api.invoke('app:open-userdata'));

    $('#profileList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-profile]');
      if (button) selectProfile(button.dataset.profile);
    });

    $('#profileForm').addEventListener('submit', saveProfile);
    $('#profileForm').addEventListener('change', (event) => {
      if (event.target.name === 'source') updateSourceHint();
    });
    $('#btnOpenAvito').addEventListener('click', () => {
      const url = buildAvitoUrl();
      const form = $('#profileForm');
      if (!form.elements.url.value.trim()) form.elements.url.value = url;
      api.invoke('shell:open-external', url);
      toast('Открыл Авито', 'Настройте район на сайте и вставьте получившийся адрес в поле «Ссылка на поиск».', 'ok', 9000);
    });

    $('#btnRunOne').addEventListener('click', () => runProfile(state.activeId));
    $('#btnEditProfile').addEventListener('click', () => {
      const profile = activeProfile();
      if (profile) openProfileModal(profile);
    });
    $('#btnDeleteProfile').addEventListener('click', deleteProfile);
    $('#btnExport').addEventListener('click', async () => {
      const response = await api.invoke('export:csv', { profileId: state.activeId });
      if (response?.ok) toast('CSV сохранён', response.path, 'ok', 7000);
      else if (response && !response.canceled) toast('Экспорт не удался', response.error || '', 'error');
    });

    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.tab = tab.dataset.tab;
        $$('.tab').forEach((item) => item.classList.toggle('active', item === tab));
        renderProfileView();
      });
    });

    $('#filterText').addEventListener('input', (event) => {
      state.filter = event.target.value;
      renderProfileView();
    });
    $('#sortSelect').addEventListener('change', (event) => {
      state.sort = event.target.value;
      saveUi();
      renderProfileView();
    });
    $('#sortSelect').value = state.sort;

    $('#cards').addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const card = button.closest('[data-id]');
      if (!card) return;
      const id = card.dataset.id;
      const result = currentResult();
      const item = result?.items.find((entry) => entry.id === id);
      if (!item) return;

      if (button.dataset.action === 'open') api.invoke('shell:open-external', item.url);
      if (button.dataset.action === 'copy') copyLink(item.url);
      if (button.dataset.action === 'hide') {
        hiddenSet().add(id);
        saveUi();
        renderProfileView();
        toast('Объявление скрыто', 'Оно вернётся, если сбросить историю поиска.', 'ok', 3000);
      }
    });

    // Закрытие модальных окон
    document.addEventListener('click', (event) => {
      const closer = event.target.closest('[data-close]');
      if (closer) hideModal(closer.dataset.close);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        $$('.modal').forEach((modal) => { modal.hidden = true; });
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        openSettings();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        runProfile(state.activeId);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        openProfileModal(null);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        $('#btnExport').click();
      }
    });

    $('#btnTestNotify').addEventListener('click', async () => {
      const response = await api.invoke('notify:test');
      if (response?.supported === false) {
        toast('Системные уведомления недоступны', 'Windows мог их отключить в параметрах.', 'warn');
      } else {
        toast('Уведомление отправлено', 'Если не появилось — проверьте настройки Windows.', 'ok');
      }
    });

    $('#btnTestTelegram').addEventListener('click', async () => {
      const status = $('#tgStatus');
      status.textContent = 'проверяю…';
      status.className = 'inline-status';
      await api.invoke('settings:update', collectSettings());
      const response = await api.invoke('telegram:test');
      if (response?.ok) {
        status.textContent = 'сообщение отправлено ✓';
        status.className = 'inline-status ok';
        state.settings = { ...state.settings, ...collectSettings() };
      } else {
        status.textContent = response?.error || 'не удалось отправить';
        status.className = 'inline-status err';
      }
    });
  }

  function bindMainEvents() {
    api.on('config-changed', async () => {
      await loadState();
    });

    api.on('profile-result', (payload) => {
      state.results.set(payload.id, { ...payload, error: '' });
      state.errors.delete(payload.id);
      if (payload.id === state.activeId) renderProfileView();
      renderSidebar();
    });

    api.on('profile-status', (payload) => {
      if (payload.running) state.running.add(payload.id);
      else state.running.delete(payload.id);
      if (!payload.running) {
        const profile = state.profiles.find((entry) => entry.id === payload.id);
        const seconds = Number(profile?.intervalSec) || Number(state.settings.pollIntervalSec) || 90;
        state.nextAt.set(payload.id, Date.now() + seconds * 1000);
      }
      renderSidebar();
      if (state.activeId) renderProfileView();
    });

    api.on('profile-error', (payload) => {
      state.errors.set(payload.id, payload.error);
      renderSidebar();
      if (state.activeId === payload.id) renderProfileView();
    });

    api.on('new-items', ({ profile, items, stats }) => {
      if (!items?.length) return;
      const title = stats?.baseline ? 'Первая загрузка завершена' : `Новых объявлений: ${items.length}`;
      toast(title, `${profile.name}: ${items[0].title}`, 'ok', 9000);
      if (!stats?.baseline) beep();
      if (profile.id === state.activeId) loadResults(profile.id);
      renderSidebar();
    });

    api.on('price-drops', ({ profile, items }) => {
      if (!items?.length) return;
      toast(`Цена снизилась: ${items[0].title}`, `${money(items[0].price)} (было ${money(items[0].price + items[0].priceDrop)})`, 'warn', 9000);
      if (profile.id === state.activeId) loadResults(profile.id);
    });

    api.on('log', (entry) => {
      state.logs.push(entry);
      if (state.logs.length > 300) state.logs.shift();
      if (!$('#settingsModal').hidden) renderLogs();
    });

    api.on('focus-profile', async ({ id }) => {
      if (id) await selectProfile(id);
    });
  }

  function startClock() {
    setInterval(() => {
      const profile = activeProfile();
      if (!profile) return;
      const busy = state.running.has(profile.id);
      const nextAt = state.nextAt.get(profile.id);
      $('#statNext').textContent = busy ? 'идёт' : nextAt ? clock(Math.max(0, (nextAt - Date.now()) / 1000)) : '—';
      if (busy) return;
      // Обновляем и подписи «проверено X назад» без полной перерисовки.
      const result = currentResult();
      if (result?.updatedAt) $('#statChecked').textContent = `проверено ${timeAgo(result.updatedAt)}`;
    }, 1000);
  }

  async function init() {
    loadUi();
    if (!api) {
      $('#previewBanner').hidden = false;
      return;
    }
    if (window.__AVITO_RADAR_PREVIEW__) {
      $('#previewBanner').hidden = false;
      document.body.classList.add('preview-mode');
    }
    bindUi();
    bindMainEvents();
    await loadState();
    startClock();
  }

  init();
})();
