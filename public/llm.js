// Cliente do OpenRouter direto do navegador: a chave fica no seu aparelho e
// só trafega para a própria API do OpenRouter (que suporta CORS).
'use strict';

import { state } from './store.js';

const BASE = 'https://openrouter.ai/api/v1/chat/completions';

export async function chat({ messages, model, json = false, maxTokens = 4096, temperature = 0.3 }) {
  const key = state.settings.openrouterKey;
  if (!key) {
    throw new Error('Chave do OpenRouter não configurada. Abra a aba Config e cole sua chave.');
  }
  const body = {
    model: model || state.settings.model,
    messages,
    max_tokens: maxTokens,
    temperature
  };
  if (json) body.response_format = { type: 'json_object' };

  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/rceschim-cpu/compras',
      'X-Title': 'Assistente de Compras'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter retornou resposta vazia.');
  return content;
}

// Extrai JSON mesmo se o modelo devolver cercas de código ou texto em volta.
export function parseJson(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.search(/[{[]/);
    if (start >= 0) {
      const open = t[start];
      const close = open === '{' ? '}' : ']';
      const end = t.lastIndexOf(close);
      if (end > start) return JSON.parse(t.slice(start, end + 1));
    }
    throw new Error('Não consegui interpretar a resposta do modelo como JSON.');
  }
}

export async function chatJson(opts) {
  const content = await chat({ ...opts, json: true });
  return parseJson(content);
}
