'use strict';

/**
 * Дым-тест интерфейса без Electron: поднимаем index.html в jsdom с preview-mock
 * и проверяем, что рендерер рисует список, вкладки и модальные окна.
 *
 * Запуск (jsdom нужен только для этого скрипта):
 *   npm install jsdom --no-save
 *   node scripts/smoke-renderer.js
 */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', 'src', 'renderer');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => errors.push(error.message));
virtualConsole.on('error', (message) => errors.push(String(message)));

const dom = new JSDOM(html, {
  url: `file://${ROOT}/index.html`,
  runScripts: 'dangerously',
  resources: undefined,
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  },
});

// jsdom не грузит внешние скрипты через file:// с resources: undefined,
// поэтому подключаем их вручную в правильном порядке.
const window = dom.window;
const inject = (file) => {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  window.eval(code);
};
inject('preview-mock.js');
inject('app.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(name, condition, extra = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
    return true;
  }
  console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  errors.push(name);
  return false;
}

(async () => {
  await wait(600);
  const document = window.document;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  console.log('Интерфейс:');
  check('список поисков отрисован', $$('.profile-item').length === 2, `найдено ${$$('.profile-item').length}`);
  check('первый поиск активен', Boolean($('.profile-item.active')));
  check('заголовок профиля заполнен', $('#headName').textContent.length > 3);
  check('карточки объявлений есть', $$('.card').length > 0, `карточек: ${$$('.card').length}`);
  check('новые объявления подсвечены', $$('.card.is-new').length > 0);
  check('счётчик новых в сайдбаре', $('#tabNewCount').textContent !== '');
  check('демо-бейдж присутствует', document.body.textContent.includes('демо'));
  check('предпросмотр помечен баннером', $('#previewBanner').hidden === false);
  check('URL-адреса открываются через мост', typeof window.avitoRadar.invoke === 'function');

  // Переключение вкладок
  $$('.tab')[1].click();
  await wait(50);
  const newOnly = $$('.card').every((card) => card.classList.contains('is-new'));
  check('вкладка «Новые» фильтрует список', newOnly);

  $$('.tab')[0].click();
  await wait(50);
  check('вкладка «Все» возвращает список', $$('.card').length > 0);

  // Поиск по тексту
  const filter = $('#filterText');
  filter.value = 'велосипед';
  filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(50);
  const filtered = $$('.card .card-title').every((node) => node.textContent.toLowerCase().includes('велосипед'));
  check('текстовый фильтр работает', filtered);
  filter.value = '';
  filter.dispatchEvent(new window.Event('input', { bubbles: true }));

  // Модальное окно нового поиска
  $('#btnNewProfile').click();
  await wait(50);
  check('окно нового поиска открывается', $('#profileModal').hidden === false);
  check('подсказка источника заполнена', $('#sourceHint').textContent.length > 10);

  const form = $('#profileForm');
  form.elements.name.value = 'Тестовый поиск';
  form.elements.query.value = 'macbook';
  form.elements.priceMax.value = '120000';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(400);
  check('профиль сохраняется и становится активным', $('#headName').textContent === 'Тестовый поиск');
  check('окно закрылось после сохранения', $('#profileModal').hidden === true);

  // Настройки
  $('#btnSettings').click();
  await wait(50);
  check('окно настроек открывается', $('#settingsModal').hidden === false);
  check('журнал заполнен', $('#logView').textContent.includes('найдено'));

  // Запуск проверки
  $('#btnSettings').click();
  $$('.modal').forEach((modal) => { modal.hidden = true; });
  $('#btnRunOne').click();
  await wait(1500);
  check('ручная проверка добавляет новые объявления', $$('.card.is-new').length > 0);

  console.log(errors.length ? `\nПроблемы: ${errors.length}` : '\nВсе проверки интерфейса пройдены.');
  dom.window.close();
  process.exit(errors.length ? 1 : 0);
})().catch((error) => {
  console.error('Дым-тест упал:', error);
  process.exit(1);
});
