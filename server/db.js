// Armazenamento local em arquivo JSON (data/db.json) com escrita atômica.
// Para um app de uso pessoal, dispensa banco de dados externo.
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const DEFAULTS = {
  settings: {
    openrouterKey: '',            // pode também vir da env OPENROUTER_API_KEY
    model: 'openai/gpt-4o-mini',  // modelo p/ entender voz/texto e compor carrinhos
    visionModel: 'openai/gpt-4o-mini', // modelo p/ ler fotos de produtos
    searchModel: 'openai/gpt-4o-mini:online', // modelo com busca web (sufixo :online do OpenRouter)
    cep: '',
    cidade: '',
    lojasWeb: ['Atacadão', 'Assaí', 'Pão de Açúcar', 'Extra', 'iFood Mercado'],
    falarRespostas: true
  },
  // Lista de compras atual: [{ id, name, brand, package, qty, note, addedAt, source }]
  list: [],
  // Catálogo aprendido: { [chaveNormalizada]: { name, brand, package, category,
  //   ingredients, history: [{type:'ran_out'|'purchased', date}], avgIntervalDays } }
  catalog: {},
  // Última cotação gerada (propostas de carrinho)
  lastQuote: null,
  // Log de conversas recentes do assistente (contexto curto)
  chatLog: []
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    cache = structuredClone(DEFAULTS);
  }
  // garante chaves novas após upgrades
  for (const k of Object.keys(DEFAULTS)) {
    if (cache[k] === undefined) cache[k] = structuredClone(DEFAULTS[k]);
  }
  for (const k of Object.keys(DEFAULTS.settings)) {
    if (cache.settings[k] === undefined) cache.settings[k] = structuredClone(DEFAULTS.settings[k]);
  }
  return cache;
}

function save() {
  if (!cache) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function get() {
  return load();
}

function update(fn) {
  const db = load();
  fn(db);
  save();
  return db;
}

function apiKey() {
  return process.env.OPENROUTER_API_KEY || load().settings.openrouterKey || '';
}

module.exports = { get, update, save, apiKey, DB_PATH };
