'use strict';

/**
 * Уведомления: системные (Windows/macOS/Linux), звук и Telegram.
 */

const { Notification } = require('electron');
const { formatPrice } = require('./sources/util');

function telegramEnabled(settings) {
  return Boolean(settings.notifyTelegram && settings.telegramToken && settings.telegramChatId);
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Отправка сообщения в Telegram (без внешних библиотек). */
async function sendTelegram(settings, text) {
  if (!telegramEnabled(settings)) return { ok: false, skipped: true };
  const url = `https://api.telegram.org/bot${settings.telegramToken}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: settings.telegramChatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.ok === false) {
      return { ok: false, error: json.description || `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/** Проверка, что токен и chat_id рабочие (кнопка «Проверить» в настройках). */
async function testTelegram(settings) {
  return sendTelegram(settings, '🔔 <b>Avito Radar</b> подключён. Сюда будут приходить новые объявления по вашим поискам.');
}

function buildMessage(profile, item) {
  const price = formatPrice(item.price);
  return [
    `🆕 <b>${escapeHtml(profile.name)}</b>`,
    `<b>${escapeHtml(item.title)}</b>`,
    `💰 ${escapeHtml(price)}`,
    item.location ? `📍 ${escapeHtml(item.location)}` : '',
    item.url ? `<a href="${escapeHtml(item.url)}">Открыть на Авито</a>` : '',
  ].filter(Boolean).join('\n');
}

/** Системное уведомление Electron. */
function showDesktop(title, body, { onClick } = {}) {
  if (!Notification.isSupported()) return false;
  try {
    const notification = new Notification({ title, body, silent: false });
    if (typeof onClick === 'function') notification.on('click', onClick);
    notification.show();
    return true;
  } catch {
    return false;
  }
}

module.exports = { sendTelegram, testTelegram, buildMessage, showDesktop, telegramEnabled };
