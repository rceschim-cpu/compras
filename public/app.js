/* Frontend do assistente de compras: voz (Web Speech API), chat, lista,
   cotações e padrões. */
'use strict';

const $ = (s) => document.querySelector(s);
const state = { settings: null, list: [], patterns: [], suggestions: [], lastQuote: null };

/* ---------- helpers ---------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}
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
  if (!state.settings?.falarRespostas || !('speechSynthesis' in window)) return;
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
    const r = await api('/api/assistant', { method: 'POST', body: { message: text } });
    thinking.textContent = r.reply;
    speak(r.reply);
    state.list = r.list;
    renderList();
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
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    sendMessage(text);
  };
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
    const { product } = await api('/api/photo', { method: 'POST', body: { image: dataUrl } });
    const desc = [product.fullName || product.name, product.brand, product.package].filter(Boolean).join(' · ');
    thinking.textContent = `Identifiquei: ${desc}. Adicionar à lista?`;
    const btn = document.createElement('button');
    btn.textContent = '＋ Adicionar à lista';
    btn.className = 'primary';
    btn.style.marginTop = '8px';
    btn.onclick = async () => {
      await api('/api/list', { method: 'POST', body: product });
      btn.replaceWith(Object.assign(document.createElement('small'), { textContent: '✅ Adicionado.' }));
      refresh();
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
  if (!state.list.length) {
    ul.innerHTML = '<p class="muted">Lista vazia. Diga "acabou o arroz" no assistente ou adicione abaixo.</p>';
  }
  for (const item of state.list) {
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
    li.querySelector('.del').onclick = async () => {
      const r = await api(`/api/list/${item.id}`, { method: 'DELETE' });
      state.list = r.list;
      renderList();
    };
    li.querySelector('.plus').onclick = () => changeQty(item, 1);
    li.querySelector('.minus').onclick = () => changeQty(item, -1);
    ul.appendChild(li);
  }
}

async function changeQty(item, delta) {
  const qty = Math.max(1, (item.qty || 1) + delta);
  const r = await api(`/api/list/${item.id}`, { method: 'PATCH', body: { qty } });
  state.list = r.list;
  renderList();
}

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#add-name').value.trim();
  if (!name) return;
  $('#add-name').value = '';
  const r = await api('/api/list', { method: 'POST', body: { name } });
  state.list = r.list;
  renderList();
});

$('#btn-purchased').addEventListener('click', async () => {
  if (!state.list.length) return;
  if (!confirm('Marcar todos os itens como comprados? Isso alimenta seu padrão e limpa a lista.')) return;
  await api('/api/purchased', { method: 'POST' });
  refresh();
});

/* ---------- cotação ---------- */
$('#btn-quote').addEventListener('click', () => {
  document.querySelector('nav button[data-tab="carrinhos"]').click();
  runQuote();
});

let quoting = false;
async function runQuote() {
  if (quoting) return;
  if (!state.list.length) {
    $('#quote-result').innerHTML = '<p class="muted">A lista está vazia — adicione itens antes de cotar.</p>';
    return;
  }
  quoting = true;
  const st = $('#quote-status');
  st.classList.remove('hidden');
  st.innerHTML = '<span class="spinner"></span>Buscando preços nas lojas e montando carrinhos... isso pode levar um minuto.';
  try {
    const { quote } = await api('/api/quotes', { method: 'POST' });
    state.lastQuote = quote;
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
  const q = state.lastQuote;
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

/* ---------- padrões ---------- */
function renderPatterns() {
  const ul = $('#patterns');
  ul.innerHTML = '';
  if (!state.patterns.length) {
    ul.innerHTML = '<p class="muted">Nada aprendido ainda. Use o assistente no dia a dia ("acabou o leite") e marque compras como feitas.</p>';
    return;
  }
  for (const p of state.patterns) {
    const li = document.createElement('li');
    li.className = 'pattern';
    const due =
      p.dueInDays === null
        ? '<span class="muted">aprendendo frequência...</span>'
        : p.dueInDays <= 0
          ? '<span class="due now">deve ter acabado</span>'
          : `<span class="due">acaba em ~${p.dueInDays} dia(s)</span>`;
    li.innerHTML = `
      <div class="name">${esc(p.name)} <span class="muted">${esc([p.brand, p.package].filter(Boolean).join(' · '))}</span></div>
      <div class="detail muted">${p.timesSeen} registro(s)${p.avgIntervalDays ? ` · repõe a cada ~${p.avgIntervalDays} dias` : ''} · ${due}</div>`;
    ul.appendChild(li);
  }
}

function renderDueBanner() {
  const b = $('#due-banner');
  if (!state.suggestions.length) {
    b.classList.add('hidden');
    return;
  }
  b.classList.remove('hidden');
  b.textContent = `📌 Pelo seu padrão, deve estar acabando: ${state.suggestions.map((s) => s.name).join(', ')}. Diga "adiciona" ou toque aqui para incluir tudo.`;
  b.onclick = async () => {
    for (const s of state.suggestions) {
      await api('/api/list', { method: 'POST', body: { name: s.name, brand: s.brand, package: s.package } });
    }
    refresh();
  };
}

/* ---------- config ---------- */
function renderSettings() {
  const s = state.settings;
  $('#set-model').value = s.model;
  $('#set-vision').value = s.visionModel;
  $('#set-search').value = s.searchModel;
  $('#set-cidade').value = s.cidade || '';
  $('#set-cep').value = s.cep || '';
  $('#set-falar').checked = !!s.falarRespostas;
  $('#key-state').textContent = s.hasKey
    ? '✅ Chave configurada (deixe em branco para manter).'
    : '❌ Nenhuma chave configurada — o assistente precisa dela para funcionar.';
  $('#status-dot').classList.toggle('ok', s.hasKey);
}

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    model: $('#set-model').value.trim(),
    visionModel: $('#set-vision').value.trim(),
    searchModel: $('#set-search').value.trim(),
    cidade: $('#set-cidade').value.trim(),
    cep: $('#set-cep').value.trim(),
    falarRespostas: $('#set-falar').checked
  };
  const key = $('#set-key').value.trim();
  if (key) body.openrouterKey = key;
  const r = await api('/api/settings', { method: 'PUT', body });
  state.settings = r.settings;
  $('#set-key').value = '';
  renderSettings();
  $('#settings-saved').textContent = '✅ Salvo.';
  setTimeout(() => ($('#settings-saved').textContent = ''), 2500);
});

/* ---------- bootstrap ---------- */
async function refresh() {
  const s = await api('/api/state');
  Object.assign(state, s);
  renderList();
  renderPatterns();
  renderSettings();
  renderDueBanner();
  if (state.lastQuote) renderQuote();
}

refresh().then(() => {
  if (!$('#chat').children.length) {
    addBubble(
      'Oi! Eu cuido das suas compras. Me diga coisas como:\n• "acabou o arroz"\n• "compra 2 sabão em pó OMO"\n• "monta o carrinho com os melhores preços"\nOu toque no 📷 para cadastrar um produto pela foto.',
      'bot'
    );
    if (!state.settings?.hasKey) {
      addBubble('⚙️ Antes de começar, cole sua chave do OpenRouter na aba Config.', 'info');
    }
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
