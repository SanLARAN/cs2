'use strict';

/**
 * Мост между интерфейсом и главным процессом.
 * Наружу отдаём только явный список методов и событий — никакого доступа к Node.
 */

const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_CHANNELS = new Set([
  'app:get-state',
  'app:open-userdata',
  'app:get-version',
  'profiles:add',
  'profiles:update',
  'profiles:remove',
  'profiles:clear-history',
  'profiles:get-results',
  'profiles:run',
  'profiles:run-all',
  'settings:update',
  'export:csv',
  'notify:test',
  'telegram:test',
  'shell:open-external',
  'ui:save',
  'app:quit',
  'app:hide',
]);

const EVENT_CHANNELS = new Set([
  'profile-result',
  'profile-status',
  'profile-error',
  'new-items',
  'price-drops',
  'log',
  'config-changed',
  'monitor-status',
  'focus-profile',
]);

const listeners = new Map();

for (const channel of EVENT_CHANNELS) {
  ipcRenderer.on(channel, (_event, payload) => {
    const set = listeners.get(channel);
    if (!set) return;
    for (const callback of set) {
      try {
        callback(payload);
      } catch (error) {
        console.error('Ошибка обработчика', channel, error);
      }
    }
  });
}

contextBridge.exposeInMainWorld('avitoRadar', {
  invoke(channel, ...args) {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Неизвестный канал: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, callback) {
    if (!EVENT_CHANNELS.has(channel) || typeof callback !== 'function') return () => {};
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(callback);
    return () => listeners.get(channel)?.delete(callback);
  },
  platform: process.platform,
});
