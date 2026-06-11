// Aprendizado de padrões de consumo: registra eventos ("acabou", "comprei"),
// calcula intervalo médio entre reposições e prevê o que está para acabar.
'use strict';

const db = require('./db');

function normKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function recordEvent(item, type, date = new Date().toISOString()) {
  const key = normKey(item.name);
  if (!key) return null;
  let entry;
  db.update((d) => {
    entry = d.catalog[key] || { name: item.name, history: [] };
    // informações novas (marca, embalagem, foto) enriquecem o catálogo
    for (const f of ['brand', 'package', 'category', 'ingredients']) {
      if (item[f]) entry[f] = item[f];
    }
    if (item.name && item.name.length > (entry.name || '').length) entry.name = item.name;
    entry.history.push({ type, date });
    if (entry.history.length > 200) entry.history = entry.history.slice(-200);
    entry.avgIntervalDays = avgInterval(entry.history);
    d.catalog[key] = entry;
  });
  return entry;
}

// Intervalo médio entre eventos de reposição (acabou/comprou contam como ciclo;
// eventos informativos como 'photo_info' não entram na conta).
function avgInterval(history) {
  const dates = history
    .filter((h) => h.type === 'ran_out' || h.type === 'purchased')
    .map((h) => new Date(h.date).getTime())
    .sort((a, b) => a - b);
  if (dates.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    const days = (dates[i] - dates[i - 1]) / 86400000;
    if (days >= 1) gaps.push(days); // ignora eventos no mesmo dia
  }
  if (!gaps.length) return null;
  return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
}

function summary() {
  const d = db.get();
  const now = Date.now();
  const items = Object.entries(d.catalog).map(([key, c]) => {
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
      dueInDays
    };
  });
  items.sort((a, b) => (a.dueInDays ?? 9999) - (b.dueInDays ?? 9999));
  return items;
}

// Itens recorrentes que provavelmente estão acabando (vence em <= 3 dias)
// e ainda não estão na lista atual.
function suggestions() {
  const d = db.get();
  const inList = new Set(d.list.map((i) => normKey(i.name)));
  return summary().filter(
    (i) => i.timesSeen >= 2 && i.dueInDays !== null && i.dueInDays <= 3 && !inList.has(i.key)
  );
}

// Enriquecimento: ao adicionar um item só pelo nome, recupera marca/embalagem aprendidas.
function enrich(item) {
  const c = db.get().catalog[normKey(item.name)];
  if (!c) return item;
  return {
    ...item,
    brand: item.brand || c.brand || null,
    package: item.package || c.package || null,
    category: item.category || c.category || null
  };
}

module.exports = { normKey, recordEvent, summary, suggestions, enrich };
