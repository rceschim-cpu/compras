// Servidor local: serve o PWA (public/) e o proxy /api/vtex — as mesmas
// funções que a Vercel exerce no deploy. Toda a lógica do app roda no
// navegador (public/*.js); os dados ficam no localStorage do usuário.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { searchVtex } = require('./scrapers/vtex');
const { STORES } = require('./scrapers/stores');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const LEGACY_DB = path.join(__dirname, '..', 'data', 'db.json');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/vtex') {
    const storeId = url.searchParams.get('store');
    const q = url.searchParams.get('q');
    const store = STORES.find((s) => s.id === storeId && s.type === 'vtex');
    if (!store) return json(res, 400, { error: 'Loja desconhecida.' });
    if (!q || q.length > 200) return json(res, 400, { error: 'Busca inválida.' });
    try {
      return json(res, 200, { offers: await searchVtex(store, q) });
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }

  // Migração: versões antigas guardavam os dados em data/db.json.
  if (req.method === 'GET' && url.pathname === '/api/legacy-state') {
    try {
      return json(res, 200, JSON.parse(fs.readFileSync(LEGACY_DB, 'utf8')));
    } catch {
      return json(res, 404, { error: 'Sem dados antigos.' });
    }
  }

  return json(res, 404, { error: 'Rota não encontrada.' });
}

function serveStatic(req, res, url) {
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  p = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, p);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: e.message });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Assistente de compras rodando em http://localhost:${PORT}`);
});
