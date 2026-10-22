'use strict';

/**
 * Avito Radar — главный процесс Electron.
 *
 * Здесь: окно, трей, IPC, запуск мониторинга, уведомления и экспорт CSV.
 * Сетевые запросы к Авито живут только тут, интерфейс их не делает.
 */

const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, dialog, Notification,
} = require('electron');

const { Store } = require('./store');
const { Monitor } = require('./monitor');
const { toCsv, safeFileName } = require('./csv');
const { sendTelegram, testTelegram, buildMessage, showDesktop } = require('./notify');
const { formatPrice } = require('./sources/util');

const APP_DIR = path.join(__dirname, '..', '..');
const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'index.html');
const ICON_PATH = path.join(APP_DIR, 'assets', 'icon.png');
const IS_WINDOWS = process.platform === 'win32';

let mainWindow = null;
let tray = null;
let store = null;
let monitor = null;
let quitting = false;
const logs = [];

function log(level, message) {
  const entry = { level, message, at: Date.now() };
  logs.push(entry);
  if (logs.length > 400) logs.shift();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', entry);
  }
  if (level === 'error') console.error('[avito-radar]', message);
  else console.log('[avito-radar]', message);
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function appIcon() {
  try {
    if (fs.existsSync(ICON_PATH)) return nativeImage.createFromPath(ICON_PATH);
  } catch {
    /* иконка не критична */
  }
  return nativeImage.createEmpty();
}

// ---------------------------------------------------------------- окно и трей

function createWindow() {
  const ui = store.config.ui || {};
  const bounds = ui.bounds && Number.isFinite(ui.bounds.width) ? ui.bounds : { width: 1240, height: 820 };

  mainWindow = new BrowserWindow({
    width: Math.max(1000, bounds.width),
    height: Math.max(680, bounds.height),
    x: bounds.x,
    y: bounds.y,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#0d1117',
    title: 'Avito Radar',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(RENDERER_HTML);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--hidden')) mainWindow.hide();
  });

  mainWindow.on('close', (event) => {
    if (!quitting && store.getSettings().minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      if (IS_WINDOWS && tray) {
        tray.displayBalloon?.({
          title: 'Avito Radar работает',
          content: 'Свернул окно в трей — новые объявления продолжат приходить.',
          iconType: 'info',
        });
      }
    } else {
      saveWindowBounds();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Внешние ссылки — только в системном браузере, никаких новых окон.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      openExternal(url);
    }
  });
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getNormalBounds();
  store.updateUi({ bounds });
}

function openExternal(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

function createTray() {
  const icon = appIcon();
  if (icon.isEmpty()) return;
  try {
    tray = new Tray(IS_WINDOWS ? icon.resize({ width: 16, height: 16 }) : icon.resize({ width: 18, height: 18 }));
  } catch {
    return;
  }
  tray.setToolTip('Avito Radar — поиск новых объявлений');
  tray.on('click', () => showWindow());

  const profiles = store.getProfiles();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Avito Radar', click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Проверить все поиски сейчас',
      click: () => runAll(),
    },
    { type: 'separator' },
    ...profiles.slice(0, 8).map((profile) => ({
      label: profile.name,
      click: () => {
        showWindow();
        send('focus-profile', { id: profile.id });
      },
    })),
    ...(profiles.length ? [{ type: 'separator' }] : []),
    {
      label: 'Выход',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.destroy();
  tray = null;
  createTray();
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------------------------------------------------------------- уведомления

async function handleNewItems({ profile, items, stats }) {
  const settings = store.getSettings();
  if (settings.openOnNew && !stats?.baseline) showWindow();
  const label = stats?.baseline ? 'Первичная загрузка' : 'Новые объявления';
  const title = `${label}: ${profile.name} (${items.length})`;

  if (settings.notifyDesktop) {
    const body = items.slice(0, 3).map((item) => `${item.title} — ${formatPrice(item.price)}`).join('\n');
    showDesktop(title, items.length > 3 ? `${body}\n…и ещё ${items.length - 3}` : body, {
      onClick: () => {
        showWindow();
        send('focus-profile', { id: profile.id });
      },
    });
  }

  if (settings.notifyTelegram) {
    for (const item of items.slice(0, 5)) {
      const result = await sendTelegram(settings, buildMessage(profile, item));
      if (!result.ok && result.error) {
        log('error', `Telegram: ${result.error}`);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- мониторинг

async function runAll() {
  const profiles = store.getProfiles().filter((profile) => profile.enabled);
  for (const profile of profiles) {
    // Последовательно, чтобы не устроить Авито залп запросов.
    // eslint-disable-next-line no-await-in-loop
    await monitor.run(profile.id, { manual: true });
  }
}

function setupMonitor() {
  monitor = new Monitor({ store });

  monitor.on('profile-result', (payload) => send('profile-result', payload));
  monitor.on('profile-status', (payload) => {
    send('profile-status', payload);
    send('monitor-status', monitor.getStatus());
  });
  monitor.on('profile-error', (payload) => send('profile-error', payload));
  monitor.on('log', (entry) => log(entry.level, entry.message));

  monitor.on('new-items', (payload) => {
    send('new-items', payload);
    handleNewItems(payload).catch((error) => log('error', `Уведомления: ${error.message}`));
  });

  monitor.on('price-drops', ({ profile, items }) => {
    send('price-drops', { profile, items });
    const settings = store.getSettings();
    if (settings.notifyDesktop) {
      const first = items[0];
      showDesktop(
        `Цена снизилась: ${profile.name}`,
        `${first.title}\n${formatPrice(first.price)} (было ${formatPrice(first.price + first.priceDrop)})`,
        { onClick: () => showWindow() },
      );
    }
    if (settings.notifyTelegram) {
      sendTelegram(
        settings,
        `📉 <b>Цена снизилась</b>\n${items.slice(0, 3).map((item) => `${item.title}: ${formatPrice(item.price)}`).join('\n')}`,
      ).catch(() => {});
    }
  });

  monitor.start();
}

// ---------------------------------------------------------------- IPC

function buildState() {
  const profiles = store.getProfiles();
  return {
    version: app.getVersion(),
    platform: process.platform,
    settings: store.getSettings(),
    profiles,
    stats: store.stats(),
    status: monitor ? monitor.getStatus() : { running: [], next: {} },
    logs: logs.slice(-120),
    userDataPath: app.getPath('userData'),
    sources: [
      { id: 'auto', label: 'Авто (API → сайт)' },
      { id: 'web', label: 'Сайт Авито (все фильтры)' },
      { id: 'api', label: 'Мобильное API' },
      { id: 'demo', label: 'Демо (без сети)' },
    ],
  };
}

function registerIpc() {
  ipcMain.handle('app:get-state', () => buildState());

  ipcMain.handle('app:get-version', () => ({ version: app.getVersion() }));

  ipcMain.handle('app:open-userdata', async () => {
    await shell.openPath(app.getPath('userData'));
    return true;
  });

  ipcMain.handle('profiles:add', (_event, input) => {
    const profile = store.addProfile(input);
    refreshTrayMenu();
    monitor.rescheduleAll();
    send('config-changed', buildState());
    return profile;
  });

  ipcMain.handle('profiles:update', (_event, { id, patch }) => {
    const profile = store.updateProfile(id, patch);
    refreshTrayMenu();
    monitor.rescheduleAll();
    send('config-changed', buildState());
    return profile;
  });

  ipcMain.handle('profiles:remove', (_event, id) => {
    const ok = store.removeProfile(id);
    refreshTrayMenu();
    monitor.rescheduleAll();
    send('config-changed', buildState());
    return ok;
  });

  ipcMain.handle('profiles:clear-history', async (_event, id) => {
    store.clearState(id);
    monitor.results.delete(id);
    send('config-changed', buildState());
    return true;
  });

  ipcMain.handle('profiles:get-results', (_event, id) => {
    const cached = monitor.getResults(id);
    if (cached) return cached;
    const state = store.loadState(id);
    return {
      profileId: id,
      items: state.items || [],
      stats: state.lastRun
        ? { found: (state.items || []).length, newCount: 0, checkedAt: state.lastRun, sourceLabel: 'сохранено', warning: '' }
        : null,
      updatedAt: state.lastRun,
      error: state.lastError || '',
    };
  });

  ipcMain.handle('profiles:run', async (_event, id) => {
    const result = await monitor.run(id, { manual: true });
    return result;
  });

  ipcMain.handle('profiles:run-all', async () => {
    await runAll();
    return true;
  });

  ipcMain.handle('settings:update', (_event, patch) => {
    const settings = store.updateSettings(patch);
    monitor.rescheduleAll();
    send('config-changed', buildState());
    return settings;
  });

  ipcMain.handle('export:csv', async (_event, { profileId, items } = {}) => {
    let rows = Array.isArray(items) ? items : [];
    let name = 'avito-radar';
    if (!rows.length && profileId) {
      const cached = monitor.getResults(profileId);
      rows = cached?.items || store.loadState(profileId).items || [];
      name = store.getProfile(profileId)?.name || name;
    }
    if (!rows.length) return { ok: false, error: 'Нет объявлений для экспорта. Сначала выполните поиск.' };

    const stamp = new Date().toISOString().slice(0, 10);
    const defaultPath = path.join(app.getPath('downloads'), `${safeFileName(name)}-${stamp}.csv`);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Сохранить результаты в CSV',
      defaultPath,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(filePath, toCsv(rows), 'utf8');
      return { ok: true, path: filePath, count: rows.length };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('notify:test', () => {
    const shown = showDesktop('Avito Radar', 'Проверка уведомлений: всё работает 🎯', { onClick: () => showWindow() });
    return { ok: shown || !Notification.isSupported(), supported: Notification.isSupported() };
  });

  ipcMain.handle('telegram:test', async () => testTelegram(store.getSettings()));

  ipcMain.handle('shell:open-external', (_event, url) => openExternal(url));

  ipcMain.handle('ui:save', (_event, patch) => {
    store.updateUi(patch);
    return true;
  });

  ipcMain.handle('app:hide', () => {
    if (mainWindow) mainWindow.hide();
    return true;
  });

  ipcMain.handle('app:quit', () => {
    quitting = true;
    app.quit();
    return true;
  });
}

// ---------------------------------------------------------------- жизненный цикл

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    app.setAppUserModelId('ru.avito.radar');

    store = new Store(app.getPath('userData'));
    registerIpc();
    setupMonitor();
    createWindow();
    createTray();

    log('info', 'Avito Radar запущен. Интервал опроса: ' + store.getSettings().pollIntervalSec + ' с.');

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('window-all-closed', () => {
    // Работаем в трее, пока пользователь явно не закроет приложение.
    if (process.platform !== 'darwin' && !store?.getSettings().minimizeToTray) {
      quitting = true;
      app.quit();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    saveWindowBounds();
    monitor?.stop();
  });
}
