'use strict';

/**
 * Мини-сервер для просмотра интерфейса в браузере без установки приложения.
 * Поднимает src/renderer на http://localhost:4173 — работает с preview-mock.js.
 *
 * Запуск: npm run preview
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src', 'renderer');
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((request, response) => {
  const urlPath = decodeURIComponent((request.url || '/').split('?')[0]);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(ROOT, relative);

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Не найдено');
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Предпросмотр интерфейса: http://localhost:${PORT}`);
});
