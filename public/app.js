/* UI do assistente de compras: voz (Web Speech API), chat, lista, cotações e
   padrões. Toda a lógica e os dados rodam no navegador (ver store.js). */
'use strict';

import * as store from './store.js';
import * as assistant from './assistant.js';
import { generateQuote } from './quotes.js';

const $ = (s) => document.querySelector(s);

/* ---------- helpers ---------- */
const brl = (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- abas ---------- */
document.querySelectorAll('nav button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $(`#tab-${b.dataset.tab}`).classList.add('active');
  });
});

/* ---------- chat / assistente ---------- */
function addBubble(text, cls) {
  const div = document.createElement('div');
  div.className = `bubble ${cls}`;
  div.textContent = text;
  $('#chat').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return div;
}

function speak(text) {
  if (!store.state.settings.falarRespostas || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'pt-BR';
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

async function sendMessage(text) {
  if (!text.trim()) return;
  addBubble(text, 'user');
  $('#msg-input').value = '';
  const thinking = addBubble('…', 'bot');
  try {
    const r = await assistant.handleMessage(text.trim());
    thinking.textContent = r.reply;
    speak(r.reply);
    renderAll();
    if (r.wantsQuote) {
      document.querySelector('nav button[data-tab="carrinhos"]').click();
      runQuote();
    }
  } catch (e) {
    thinking.textContent = `⚠️ ${e.message}`;
  }
}

$('#btn-send').addEventListener('click', () => sendMessage($('#msg-input').value));
$('#msg-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage($('#msg-input').value);
});

/* ---------- voz ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) {
  const rec = new SR();
  rec.lang = 'pt-BR';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  let listening = false;
  rec.onresult = (e) => sendMessage(e.results[0][0].transcript);
  rec.onend = () => {
    listening = false;
    $('#btn-mic').classList.remove('listening');
  };
  rec.onerror = (e) => {
    listening = false;
    $('#btn-mic').classList.remove('listening');
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      addBubble(`⚠️ Erro no microfone: ${e.error}`, 'info');
    }
  };
  $('#btn-mic').addEventListener('click', () => {
    if (listening) {
      rec.stop();
      return;
    }
    speechSynthesis?.cancel();
    rec.start();
    listening = true;
    $('#btn-mic').classList.add('listening');
  });
} else {
  $('#btn-mic').addEventListener('click', () =>
    addBubble('⚠️ Reconhecimento de voz não suportado neste navegador. Use o Chrome.', 'info')
  );
}

/* ---------- foto de produto ---------- */
$('#btn-photo').addEventListener('click', () => $('#photo-input').click());
$('#photo-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';
  const dataUrl = await resizeImage(file, 1024);
  addBubble('📷 Foto enviada, analisando o produto...', 'user');
  const thinking = addBubble('…', 'bot');
  try {
    const product = await assistant.analyzePhoto(dataUrl);
    const desc = [product.fullName || product.name, product.brand, product.package].filter(Boolean).join(' · ');
    thinking.textContent = `Identifiquei: ${desc}. Adicionar à lista?`;
    const btn = document.createElement('button');
    btn.textContent = '＋ Adicionar à lista';
    btn.className = 'primary';
    btn.style.marginTop = '8px';
    btn.onclick = () => {
      store.addItem(product);
      btn.replaceWith(Object.assign(document.createElement('small'), { textContent: '✅ Adicionado.' }));
      renderAll();
    };
    thinking.appendChild(document.createElement('br'));
    thinking.appendChild(btn);
    speak(thinking.firstChild.textContent || '');
  } catch (err) {
    thinking.textContent = `⚠️ ${err.message}`;
  }
});

function resizeImage(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- lista ---------- */
function renderList() {
  const ul = $('#list');
  ul.innerHTML = '';
  if (!store.state.list.length) {
    ul.innerHTML = '<p class="muted">Lista vazia. Diga "acabou o arroz" no assistente ou adicione abaixo.</p>';
  }
  for (const item of store.state.list) {
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML = `
      <div class="grow">
        <div class="name">${esc(item.name)}</div>
        <div class="detail">${esc([item.brand, item.package].filter(Boolean).join(' · '))}</div>
      </div>
      <span class="qty">${item.qty || 1}x</span>
      <button class="minus" title="Diminuir">−</button>
      <button class="plus" title="Aumentar">＋</button>
      <button class="del" title="Remover">🗑️</button>`;
    li.querySelector('.del').onclick = () => {
      store.removeItemById(item.id);
      renderList();
    };
    li.querySelector('.plus').onclick = () => {
      store.updateItem(item.id, { qty: (item.qty || 1) + 1 });
      renderList();
    };
    li.querySelector('.minus').onclick = () => {
      store.updateItem(item.id, { qty: Math.max(1, (item.qty || 1) - 1) });
      renderList();
    };
    ul.appendChild(li);
  }
}

$('#add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#add-name').value.trim();
  if (!name) return;
  $('#add-name').value = '';
  store.addItem({ name });
  renderList();
});

$('#btn-purchased').addEventListener('click', () => {
  if (!store.state.list.length) return;
  if (!confirm('Marcar todos os itens como comprados? Isso alimenta seu padrão e limpa a lista.')) return;
  store.markPurchased();
  renderAll();
});

/* ---------- cotação ---------- */
$('#btn-quote').addEventListener('click', () => {
  document.querySelector('nav button[data-tab="carrinhos"]').click();
  runQuote();
});

let quoting = false;
async function runQuote() {
  if (quoting) return;
  if (!store.state.list.length) {
    $('#quote-result').innerHTML = '<p class="muted">A lista está vazia — adicione itens antes de cotar.</p>';
    return;
  }
  quoting = true;
  const st = $('#quote-status');
  st.classList.remove('hidden');
  const setProgress = (msg) => {
    st.innerHTML = `<span class="spinner"></span>${esc(msg)}`;
  };
  setProgress('Buscando preços nas lojas... isso pode levar um minuto.');
  try {
    const quote = await generateQuote(setProgress);
    renderQuote();
    speak(quote.summary || 'Cotação pronta.');
  } catch (e) {
    $('#quote-result').innerHTML = `<p class="banner">⚠️ ${esc(e.message)}</p>`;
  } finally {
    st.classList.add('hidden');
    quoting = false;
  }
}

function renderQuote() {
  const q = store.state.lastQuote;
  const box = $('#quote-result');
  if (!q) return;
  let html = `<p class="muted">Cotação de ${new Date(q.createdAt).toLocaleString('pt-BR')} · ${q.offersCollected} ofertas analisadas</p>`;
  if (q.estimated) {
    html += '<div class="banner warn">⚠️ Nenhuma fonte de preço ao vivo respondeu — os valores abaixo são <b>estimativas</b> do modelo. Confirme nos sites das lojas antes de comprar.</div>';
  }
  if (q.summary) html += `<div class="banner">${esc(q.summary)}</div>`;

  for (const p of q.proposals || []) {
    html += `<div class="proposal">
      <h3><span>🏬 ${esc(p.store)}</span><span class="total">${brl(p.subtotal)}</span></h3>
      ${p.note ? `<div class="muted">${esc(p.note)}</div>` : ''}
      <table>${(p.items || [])
        .map(
          (i) => `<tr>
            <td>${esc(i.qty || 1)}x ${esc(i.product || i.name)}${i.link ? ` <a href="${esc(i.link)}" target="_blank" rel="noopener">↗</a>` : ''}</td>
            <td class="price">${brl(i.total ?? i.unitPrice)}</td>
          </tr>`
        )
        .join('')}</table>
      ${p.missing?.length ? `<div class="missing">Não encontrado nesta loja: ${esc(p.missing.join(', '))}</div>` : ''}
    </div>`;
  }

  if (q.alternatives?.length) {
    html += '<h2>💡 Sugestões de troca</h2>';
    for (const a of q.alternatives) {
      html += `<div class="alt ${a.reason === 'cheaper' ? 'cheaper' : ''}">
        ${a.reason === 'cheaper' ? '💸' : '🌱'} ${esc(a.suggestion)}
        <div class="muted">${esc([a.product, a.store, a.price ? brl(a.price) : null].filter(Boolean).join(' · '))}
        ${a.link ? ` <a href="${esc(a.link)}" target="_blank" rel="noopener">ver produto ↗</a>` : ''}</div>
      </div>`;
    }
  }

  if (q.warnings?.length) {
    html += `<p class="muted">Avisos: ${esc(q.warnings.join(' | '))}</p>`;
  }
  box.innerHTML = html;
}

/* ---------- nota fiscal ---------- */
$('#btn-receipt').addEventListener('click', () => $('#receipt-input').click());
$('#receipt-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';
  const box = $('#receipt-review');
  box.classList.remove('hidden');
  box.innerHTML = '<div class="banner"><span class="spinner"></span>Lendo a nota fiscal...</div>';
  try {
    // resolução maior que a foto de produto: letras de cupom são pequenas
    const dataUrl = await resizeImage(file, 1600);
    const receipt = await assistant.analyzeReceipt(dataUrl);
    renderReceiptReview(receipt);
  } catch (err) {
    box.innerHTML = `<div class="banner warn">⚠️ ${esc(err.message)}</div>`;
  }
});

function renderReceiptReview(receipt) {
  const box = $('#receipt-review');
  const when = receipt.date && !isNaN(Date.parse(receipt.date))
    ? new Date(receipt.date).toLocaleDateString('pt-BR')
    : 'hoje';
  box.innerHTML = `
    <div class="proposal">
      <h3><span>🧾 ${esc(receipt.store || 'Mercado')}</span><span class="muted">${esc(when)}</span></h3>
      <p class="muted">Confira o que foi lido e desmarque o que não quiser registrar:</p>
      <table>${receipt.items
        .map(
          (i, idx) => `<tr>
            <td><label class="check" style="margin:0"><input type="checkbox" data-idx="${idx}" checked />
              ${esc(i.qty || 1)}x ${esc([i.name, i.brand, i.package].filter(Boolean).join(' '))}</label></td>
            <td class="price">${brl(i.unitPrice)}</td>
          </tr>`
        )
        .join('')}</table>
      <div class="row-between" style="margin-top:12px">
        <button id="receipt-cancel" class="ghost" style="margin:0">Cancelar</button>
        <button id="receipt-confirm" class="primary">✅ Registrar compra</button>
      </div>
    </div>`;
  $('#receipt-cancel').onclick = () => {
    box.classList.add('hidden');
    box.innerHTML = '';
  };
  $('#receipt-confirm').onclick = () => {
    const checked = [...box.querySelectorAll('input[type="checkbox"]:checked')].map(
      (c) => receipt.items[Number(c.dataset.idx)]
    );
    const count = store.applyReceipt({ ...receipt, items: checked });
    box.innerHTML = `<div class="banner">✅ ${count} item(ns) registrados no histórico${receipt.store ? ` (${esc(receipt.store)})` : ''}. Seu padrão de compras ficou mais preciso.</div>`;
    setTimeout(() => {
      box.classList.add('hidden');
      box.innerHTML = '';
    }, 4000);
    renderAll();
  };
}

/* ---------- padrões ---------- */
function renderPatterns() {
  const ul = $('#patterns');
  const patterns = store.patternsSummary();
  ul.innerHTML = '';
  if (!patterns.length) {
    ul.innerHTML = '<p class="muted">Nada aprendido ainda. Use o assistente no dia a dia ("acabou o leite") e marque compras como feitas.</p>';
    return;
  }
  for (const p of patterns) {
    const li = document.createElement('li');
    li.className = 'pattern';
    const due =
      p.dueInDays === null
        ? '<span class="muted">aprendendo frequência...</span>'
        : p.dueInDays <= 0
          ? '<span class="due now">deve ter acabado</span>'
          : `<span class="due">acaba em ~${p.dueInDays} dia(s)</span>`;
    const paid = p.lastPrice
      ? ` · pagou ${brl(p.lastPrice.price)}${p.lastPrice.store ? ` (${esc(p.lastPrice.store)})` : ''}`
      : '';
    li.innerHTML = `
      <div class="name">${esc(p.name)} <span class="muted">${esc([p.brand, p.package].filter(Boolean).join(' · '))}</span></div>
      <div class="detail muted">${p.timesSeen} registro(s)${p.avgIntervalDays ? ` · repõe a cada ~${p.avgIntervalDays} dias` : ''}${paid} · ${due}</div>`;
    ul.appendChild(li);
  }
}

function renderDueBanner() {
  const b = $('#due-banner');
  const suggestions = store.dueSuggestions();
  if (!suggestions.length) {
    b.classList.add('hidden');
    return;
  }
  b.classList.remove('hidden');
  b.textContent = `📌 Pelo seu padrão, deve estar acabando: ${suggestions.map((s) => s.name).join(', ')}. Toque aqui para incluir tudo na lista.`;
  b.onclick = () => {
    for (const s of suggestions) {
      store.addItem({ name: s.name, brand: s.brand, package: s.package });
    }
    renderAll();
  };
}

/* ---------- config ---------- */
function renderSettings() {
  const s = store.state.settings;
  $('#set-model').value = s.model;
  $('#set-vision').value = s.visionModel;
  $('#set-search').value = s.searchModel;
  $('#set-cidade').value = s.cidade || '';
  $('#set-cep').value = s.cep || '';
  $('#set-falar').checked = !!s.falarRespostas;
  $('#key-state').textContent = s.openrouterKey
    ? '✅ Chave salva neste navegador (deixe em branco para manter).'
    : '❌ Nenhuma chave configurada — o assistente precisa dela para funcionar.';
  $('#status-dot').classList.toggle('ok', !!s.openrouterKey);
}

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const s = store.state.settings;
  s.model = $('#set-model').value.trim() || s.model;
  s.visionModel = $('#set-vision').value.trim() || s.visionModel;
  s.searchModel = $('#set-search').value.trim() || s.searchModel;
  s.cidade = $('#set-cidade').value.trim();
  s.cep = $('#set-cep').value.trim();
  s.falarRespostas = $('#set-falar').checked;
  const key = $('#set-key').value.trim();
  if (key) s.openrouterKey = key;
  store.save();
  $('#set-key').value = '';
  renderSettings();
  $('#settings-saved').textContent = '✅ Salvo neste navegador.';
  setTimeout(() => ($('#settings-saved').textContent = ''), 2500);
});

/* ---------- backup ---------- */
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `compras-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#btn-import').addEventListener('click', () => $('#import-input').click());
$('#import-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';
  try {
    store.importJson(await file.text());
    renderAll();
    alert('✅ Backup importado.');
  } catch (err) {
    alert(`⚠️ ${err.message}`);
  }
});

/* ---------- bootstrap ---------- */
function renderAll() {
  renderList();
  renderPatterns();
  renderSettings();
  renderDueBanner();
  if (store.state.lastQuote) renderQuote();
}

async function migrateLegacy() {
  // Versões antigas guardavam os dados no servidor local (data/db.json).
  if (store.state.list.length || Object.keys(store.state.catalog).length) return;
  try {
    const res = await fetch('/api/legacy-state');
    if (!res.ok) return;
    const data = await res.json();
    if (store.adoptLegacy(data)) {
      addBubble('📦 Importei seus dados antigos do servidor local.', 'info');
      renderAll();
    }
  } catch {
    /* sem servidor legado — normal no deploy */
  }
}

renderAll();
migrateLegacy();

addBubble(
  'Oi! Eu cuido das suas compras. Me diga coisas como:\n• "acabou o arroz"\n• "compra 2 sabão em pó OMO"\n• "monta o carrinho com os melhores preços"\nOu toque no 📷 para cadastrar um produto pela foto.',
  'bot'
);
if (!store.state.settings.openrouterKey) {
  addBubble('⚙️ Antes de começar, cole sua chave do OpenRouter na aba Config.', 'info');
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
