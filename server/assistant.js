// Assistente: interpreta comandos de voz/texto (via OpenRouter), atualiza a
// lista, registra padrões e responde em linguagem natural. Também lê fotos de
// produtos com modelo de visão.
'use strict';

const crypto = require('crypto');
const db = require('./db');
const or = require('./openrouter');
const patterns = require('./patterns');

function newId() {
  return crypto.randomUUID();
}

function listSnapshot() {
  return db.get().list.map((i) => ({
    name: i.name, brand: i.brand, package: i.package, qty: i.qty
  }));
}

const SYSTEM = `Você é o assistente de compras de supermercado de um usuário brasileiro. Ele fala frases curtas do dia a dia como "acabou o arroz", "compra duas batatas palha", "tira o sabão da lista", "já comprei tudo", "o que tem na lista?".

Sua tarefa: interpretar a frase e devolver SOMENTE JSON neste formato:
{
 "reply": "resposta curta e natural em português, para ser falada em voz alta",
 "actions": [
   {"type": "add", "item": {"name": "...", "brand": null, "package": null, "qty": 1}},
   {"type": "ran_out", "item": {"name": "..."}},
   {"type": "remove", "item": {"name": "..."}},
   {"type": "set_qty", "item": {"name": "...", "qty": 2}},
   {"type": "purchased_all"},
   {"type": "quote"}
 ]
}

Regras:
- "acabou X" => ações ran_out E add (acabou implica repor: entra na lista).
- "comprei X" / "já comprei tudo" => purchased_all ou remove do item comprado.
- Pedidos de cotação/preços ("monta o carrinho", "busca os preços") => action quote.
- Perguntas ("o que tem na lista?") => apenas reply, actions [].
- Extraia marca e embalagem quando ditas ("arroz tio joão 5kg" => name "arroz", brand "Tio João", package "5kg").
- Se a frase não tiver a ver com compras, responda educadamente que você cuida das compras. actions [].
- reply sempre confirma o que foi feito ("Anotei: arroz na lista. Já são 5 itens.").`;

async function handleMessage(message) {
  const d = db.get();
  const recentChat = d.chatLog.slice(-6);
  const data = await or.chatJson({
    model: d.settings.model,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `Lista atual: ${JSON.stringify(listSnapshot())}\n` +
          `Itens recorrentes que devem estar acabando: ${JSON.stringify(
            patterns.suggestions().map((s) => s.name)
          )}\n` +
          (recentChat.length ? `Conversa recente: ${JSON.stringify(recentChat)}\n` : '') +
          `Frase do usuário: "${message}"`
      }
    ],
    temperature: 0.2
  });

  const applied = applyActions(data.actions || []);
  db.update((x) => {
    x.chatLog.push({ user: message, assistant: data.reply });
    if (x.chatLog.length > 30) x.chatLog = x.chatLog.slice(-30);
  });
  return {
    reply: data.reply || 'Feito.',
    actions: applied,
    list: db.get().list,
    wantsQuote: applied.some((a) => a.type === 'quote')
  };
}

function applyActions(actions) {
  const applied = [];
  for (const a of actions) {
    const item = a.item || {};
    switch (a.type) {
      case 'add': {
        addItem({ ...item, source: 'voz' });
        applied.push(a);
        break;
      }
      case 'ran_out': {
        patterns.recordEvent(item, 'ran_out');
        applied.push(a);
        break;
      }
      case 'remove': {
        const key = patterns.normKey(item.name);
        db.update((d) => {
          d.list = d.list.filter((i) => patterns.normKey(i.name) !== key);
        });
        applied.push(a);
        break;
      }
      case 'set_qty': {
        const key = patterns.normKey(item.name);
        db.update((d) => {
          const t = d.list.find((i) => patterns.normKey(i.name) === key);
          if (t) t.qty = item.qty || 1;
        });
        applied.push(a);
        break;
      }
      case 'purchased_all': {
        markPurchased();
        applied.push(a);
        break;
      }
      case 'quote': {
        applied.push(a); // o frontend dispara /api/quotes ao ver esta ação
        break;
      }
    }
  }
  return applied;
}

function addItem(item) {
  const enriched = patterns.enrich(item);
  const key = patterns.normKey(enriched.name);
  let added;
  db.update((d) => {
    const existing = d.list.find((i) => patterns.normKey(i.name) === key);
    if (existing) {
      if (item.qty) existing.qty = item.qty;
      if (item.brand) existing.brand = item.brand;
      if (item.package) existing.package = item.package;
      added = existing;
    } else {
      added = {
        id: newId(),
        name: enriched.name,
        brand: enriched.brand || null,
        package: enriched.package || null,
        qty: item.qty || 1,
        note: item.note || null,
        source: item.source || 'manual',
        addedAt: new Date().toISOString()
      };
      d.list.push(added);
    }
  });
  return added;
}

// Marca a lista atual como comprada: alimenta o histórico/padrões e limpa a lista.
function markPurchased() {
  const items = db.get().list;
  for (const i of items) patterns.recordEvent(i, 'purchased');
  db.update((d) => {
    d.list = [];
  });
  return items.length;
}

// Foto de produto -> modelo de visão extrai nome, marca, embalagem, ingredientes.
async function analyzePhoto(dataUrl) {
  const d = db.get();
  const data = await or.chatJson({
    model: d.settings.visionModel,
    maxTokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Esta é a foto de um produto de supermercado brasileiro. Extraia as informações visíveis e responda SOMENTE com JSON:
{"name":"nome genérico (ex: arroz, batata palha)","brand":"marca","package":"tamanho/embalagem (ex: 5kg, 500g)","category":"categoria","ingredients":"lista de ingredientes se legível, senão null","fullName":"nome completo do produto"}`
          },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
  });
  if (!data.name) throw new Error('Não consegui identificar o produto na foto.');
  // Enriquecer o catálogo com o que foi lido na embalagem
  patterns.recordEvent(
    { name: data.name, brand: data.brand, package: data.package, category: data.category, ingredients: data.ingredients },
    'photo_info'
  );
  return data;
}

module.exports = { handleMessage, addItem, markPurchased, analyzePhoto };
