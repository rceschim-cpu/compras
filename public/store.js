// Estado do app no navegador (localStorage): lista, catálogo aprendido,
// configurações e histórico ficam só no seu aparelho — nada vai para o
// servidor, que atua apenas como proxy de scraping.
'use strict';

const KEY = 'compras-state-v1';

export const DEFAULTS = {
  settings: {
    openrouterKey: '',
    model: 'openai/gpt-4o-mini',
    visionModel: 'openai/gpt-4o-mini',
    searchModel: 'perplexity/sonar',
    cep: '',
    cidade: '',
    lojasWeb: ['Atacadão', 'Assaí', 'Pão de Açúcar', 'Extra', 'iFood Mercado'],
    falarRespostas: true
  },
  list: [],
  catalog: {},
  lastQuote: null,
  chatLog: []
};

export let state = load();

function load() {
  let s;
  try {
    s = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    s = {};
  }
  const merged = { ...structuredClone(DEFAULTS), ...s };
  merged.settings = { ...DEFAULTS.settings, ...(s.settings || {}) };
  return merged;
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function exportJson() {
  return JSON.stringify(state, null, 2);
}

export function importJson(text) {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object' || (!s.list && !s.catalog)) {
    throw new Error('O arquivo não parece um backup deste app.');
  }
  localStorage.setItem(KEY, JSON.stringify(s));
  state = load();
}

// Adota dados do antigo armazenamento no servidor (data/db.json), se existirem.
export function adoptLegacy(s) {
  if (!s || typeof s !== 'object') return false;
  let changed = false;
  if (s.catalog && Object.keys(s.catalog).length && !Object.keys(state.catalog).length) {
    state.catalog = s.catalog;
    changed = true;
  }
  if (Array.isArray(s.list) && s.list.length && !state.list.length) {
    state.list = s.list;
    changed = true;
  }
  if (changed) save();
  return changed;
}

/* ---------------- padrões de consumo ---------------- */

export function normKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function recordEvent(item, type, date = new Date().toISOString()) {
  const key = normKey(item.name);
  if (!key) return null;
  const entry = state.catalog[key] || { name: item.name, history: [] };
  for (const f of ['brand', 'package', 'category', 'ingredients']) {
    if (item[f]) entry[f] = item[f];
  }
  if (item.name && item.name.length > (entry.name || '').length) entry.name = item.name;
  entry.history.push({ type, date });
  if (entry.history.length > 200) entry.history = entry.history.slice(-200);
  entry.avgIntervalDays = avgInterval(entry.history);
  state.catalog[key] = entry;
  save();
  return entry;
}

// Intervalo médio entre reposições (eventos informativos não contam).
function avgInterval(history) {
  const dates = history
    .filter((h) => h.type === 'ran_out' || h.type === 'purchased')
    .map((h) => new Date(h.date).getTime())
    .sort((a, b) => a - b);
  if (dates.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    const days = (dates[i] - dates[i - 1]) / 86400000;
    if (days >= 1) gaps.push(days);
  }
  if (!gaps.length) return null;
  return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
}

export function patternsSummary() {
  const now = Date.now();
  const items = Object.entries(state.catalog).map(([key, c]) => {
    const last = c.history.length ? c.history[c.history.length - 1] : null;
    const lastDate = last ? new Date(last.date).getTime() : null;
    let dueInDays = null;
    if (lastDate && c.avgIntervalDays) {
      dueInDays = Math.round(c.avgIntervalDays - (now - lastDate) / 86400000);
    }
    return {
      key,
      name: c.name,
      brand: c.brand || null,
      package: c.package || null,
      category: c.category || null,
      timesSeen: c.history.length,
      avgIntervalDays: c.avgIntervalDays || null,
      lastEvent: last,
      lastPrice: c.prices?.length ? c.prices[c.prices.length - 1] : null,
      dueInDays
    };
  });
  items.sort((a, b) => (a.dueInDays ?? 9999) - (b.dueInDays ?? 9999));
  return items;
}

export function dueSuggestions() {
  const inList = new Set(state.list.map((i) => normKey(i.name)));
  return patternsSummary().filter(
    (i) => i.timesSeen >= 2 && i.dueInDays !== null && i.dueInDays <= 3 && !inList.has(i.key)
  );
}

export function enrich(item) {
  const c = state.catalog[normKey(item.name)];
  if (!c) return item;
  return {
    ...item,
    brand: item.brand || c.brand || null,
    package: item.package || c.package || null,
    category: item.category || c.category || null
  };
}

/* ---------------- lista de compras ---------------- */

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

export function addItem(item) {
  const enriched = enrich(item);
  const key = normKey(enriched.name);
  const existing = state.list.find((i) => normKey(i.name) === key);
  if (existing) {
    if (item.qty) existing.qty = item.qty;
    if (item.brand) existing.brand = item.brand;
    if (item.package) existing.package = item.package;
    save();
    return existing;
  }
  const added = {
    id: newId(),
    name: enriched.name,
    brand: enriched.brand || null,
    package: enriched.package || null,
    qty: item.qty || 1,
    note: item.note || null,
    source: item.source || 'manual',
    addedAt: new Date().toISOString()
  };
  state.list.push(added);
  save();
  return added;
}

export function removeItem(name) {
  const key = normKey(name);
  state.list = state.list.filter((i) => normKey(i.name) !== key);
  save();
}

export function removeItemById(id) {
  state.list = state.list.filter((i) => i.id !== id);
  save();
}

export function setQty(name, qty) {
  const key = normKey(name);
  const t = state.list.find((i) => normKey(i.name) === key);
  if (t) {
    t.qty = qty || 1;
    save();
  }
}

export function updateItem(id, fields) {
  const it = state.list.find((i) => i.id === id);
  if (!it) return;
  for (const k of ['name', 'brand', 'package', 'qty', 'note']) {
    if (fields[k] !== undefined) it[k] = fields[k];
  }
  save();
}

// Marca tudo como comprado: alimenta o padrão e limpa a lista.
export function markPurchased() {
  const items = state.list;
  for (const i of items) recordEvent(i, 'purchased');
  state.list = [];
  save();
  return items.length;
}

// Registra uma nota fiscal escaneada: cada item vira evento "comprado" na
// data da nota, com preço pago guardado no catálogo; itens correspondentes
// saem da lista atual (já foram comprados).
export function applyReceipt(receipt) {
  let date = new Date().toISOString();
  if (receipt.date && !isNaN(Date.parse(receipt.date))) {
    date = new Date(receipt.date).toISOString();
  }
  let count = 0;
  for (const it of receipt.items || []) {
    if (!it.name) continue;
    // históricos de compras podem trazer uma data por item
    const itemDate =
      it.date && !isNaN(Date.parse(it.date)) ? new Date(it.date).toISOString() : date;
    const entry = recordEvent(
      { name: it.name, brand: it.brand, package: it.package, category: it.category },
      'purchased',
      itemDate
    );
    if (entry && it.unitPrice > 0) {
      entry.prices = entry.prices || [];
      entry.prices.push({ date: itemDate, store: receipt.store || null, price: it.unitPrice });
      if (entry.prices.length > 50) entry.prices = entry.prices.slice(-50);
    }
    removeItem(it.name);
    count++;
  }
  save();
  return count;
}

export function pushChat(user, assistant) {
  state.chatLog.push({ user, assistant });
  if (state.chatLog.length > 30) state.chatLog = state.chatLog.slice(-30);
  save();
}
