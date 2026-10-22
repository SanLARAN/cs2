'use strict';

/**
 * Фабрика источников + логика автопереключения.
 *
 * Режимы профиля:
 *  - auto   — сначала мобильное API, при ошибке веб-страница (и наоборот при 403);
 *  - web    — только веб-версия (полный набор фильтров, включая районы);
 *  - api    — только мобильное API;
 *  - demo   — генератор без сети.
 */

const web = require('./web');
const mobileApi = require('./mobileApi');
const demo = require('./demo');
const { SourceError, sleep } = require('./util');

const SOURCE_LABELS = {
  web: 'Сайт',
  api: 'Мобильное API',
  demo: 'Демо',
};

/**
 * @returns {Promise<{items: Array, source: string, hasMore: boolean, warning: string}>}
 */
async function fetchPage(profile, { page = 1, round = 0, locationId } = {}) {
  const mode = profile.source || 'auto';

  if (mode === 'demo') {
    const result = demo.search(profile, { round });
    return { ...result, source: 'demo', warning: '' };
  }

  if (mode === 'web') {
    const result = await web.search(profile, { page });
    return { ...result, source: 'web', warning: '' };
  }

  if (mode === 'api') {
    const result = await mobileApi.search(profile, { page, locationId });
    return { ...result, source: 'api', warning: '', locationId: result.locationId };
  }

  // auto: пробуем API, затем сайт; при антиботе — наоборот.
  const order = profile.url ? ['api', 'web'] : ['api', 'web'];
  const problems = [];

  for (const candidate of order) {
    try {
      if (candidate === 'api') {
        const result = await mobileApi.search(profile, { page, locationId });
        return {
          ...result,
          source: 'api',
          warning: problems.length ? `Мобильное API сработало со второй попытки. ${problems.join(' ')}` : '',
        };
      }
      const result = await web.search(profile, { page });
      return { ...result, source: 'web', warning: problems.join(' ') };
    } catch (error) {
      problems.push(`${SOURCE_LABELS[candidate]}: ${error.message}`);
      if (error.kind === 'blocked' || error.kind === 'timeout') await sleep(1200);
    }
  }

  throw new SourceError(`Не удалось получить данные ни из одного источника. ${problems.join(' ')}`, { kind: 'both' });
}

module.exports = { fetchPage, SOURCE_LABELS, web, mobileApi, demo };
