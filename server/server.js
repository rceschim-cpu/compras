// Servidor HTTP sem dependências externas: serve o PWA (public/) e a API.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const db = require('./db');
const patterns = require('./patterns');
const assistant = require('./assistant');
const { generateQuote } = require('./quotes');
const { STORES } = require('./scrapers/stores');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
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
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req, maxBytes = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error('Corpo da requisição grande demais.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function publicSettings() {
  const s = db.get().settings;
  return { ...s, openrouterKey: '', hasKey: !!db.apiKey() };
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/state') {
    return json(res, 200, {
      list: db.get().list,
      settings: publicSettings(),
      patterns: patterns.summary(),
      suggestions: patterns.suggestions(),
      lastQuote: db.get().lastQuote,
      stores: STORES,
      chatLog: db.get().chatLog.slice(-20)
    });
  }

  if (route === 'PUT /api/settings') {
    const body = await readBody(req);
    db.update((d) => {
      for (const k of ['model', 'visionModel', 'searchModel', 'cep', 'cidade', 'falarRespostas', 'lojasWeb']) {
        if (body[k] !== undefined) d.settings[k] = body[k];
      }
      // só sobrescreve a chave se uma nova foi digitada
      if (body.openrouterKey) d.settings.openrouterKey = body.openrouterKey.trim();
      if (body.openrouterKey === null) d.settings.openrouterKey = '';
    });
    return json(res, 200, { ok: true, settings: publicSettings() });
  }

  if (route === 'POST /api/assistant') {
    const { message } = await readBody(req);
    if (!message?.trim()) return json(res, 400, { error: 'Mensagem vazia.' });
    const result = await assistant.handleMessage(message.trim());
    return json(res, 200, result);
  }

  if (route === 'POST /api/photo') {
    const { image } = await readBody(req);
    if (!image?.startsWith('data:image/')) return json(res, 400, { error: 'Imagem inválida.' });
    const product = await assistant.analyzePhoto(image);
    return json(res, 200, { product });
  }

  if (route === 'POST /api/list') {
    const body = await readBody(req);
    if (!body.name?.trim()) return json(res, 400, { error: 'Nome do item é obrigatório.' });
    const item = assistant.addItem({ ...body, name: body.name.trim() });
    return json(res, 200, { item, list: db.get().list });
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/list/')) {
    const id = url.pathname.split('/').pop();
    const body = await readBody(req);
    db.update((d) => {
      const it = d.list.find((i) => i.id === id);
      if (it) {
        for (const k of ['name', 'brand', 'package', 'qty', 'note']) {
          if (body[k] !== undefined) it[k] = body[k];
        }
      }
    });
    return json(res, 200, { list: db.get().list });
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/list/')) {
    const id = url.pathname.split('/').pop();
    db.update((d) => {
      d.list = d.list.filter((i) => i.id !== id);
    });
    return json(res, 200, { list: db.get().list });
  }

  if (route === 'POST /api/purchased') {
    const count = assistant.markPurchased();
    return json(res, 200, { ok: true, count, list: db.get().list });
  }

  if (route === 'POST /api/quotes') {
    // Cotação pode demorar (busca web + LLM); resposta única com timeout largo.
    req.setTimeout(0);
    res.setTimeout(0);
    const quote = await generateQuote((msg) => console.log('[cotação]', msg));
    return json(res, 200, { quote });
  }

  if (route === 'GET /api/quotes') {
    return json(res, 200, { quote: db.get().lastQuote });
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

server.requestTimeout = 0; // cotações podem levar mais de 1 minuto
server.listen(PORT, () => {
  console.log(`Assistente de compras rodando em http://localhost:${PORT}`);
  console.log(`Dados locais em: ${db.DB_PATH}`);
});
