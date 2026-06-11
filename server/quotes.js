// Orquestração de cotação: coleta preços (scrapers VTEX + busca web via
// OpenRouter) e pede ao modelo para compor propostas de carrinho com
// alternativas mais baratas e/ou mais saudáveis.
'use strict';

const db = require('./db');
const or = require('./openrouter');
const { searchVtex } = require('./scrapers/vtex');
const { STORES } = require('./scrapers/stores');

// Executa promessas com limite de concorrência.
async function pool(tasks, limit = 4) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try {
        results[idx] = await tasks[idx]();
      } catch (e) {
        results[idx] = { error: e.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function itemQuery(item) {
  return [item.name, item.brand, item.package].filter(Boolean).join(' ');
}

async function scrapePrices(items, progress) {
  const vtexStores = STORES.filter((s) => s.type === 'vtex');
  const tasks = [];
  for (const store of vtexStores) {
    for (const item of items) {
      tasks.push(async () => {
        const offers = await searchVtex(store, itemQuery(item));
        return { item: item.name, offers };
      });
    }
  }
  progress(`Consultando ${vtexStores.length} loja(s) com scraper direto...`);
  const res = await pool(tasks, 5);
  const offers = [];
  const errors = [];
  for (const r of res) {
    if (r?.offers) offers.push(...r.offers.map((o) => ({ ...o, forItem: r.item })));
    else if (r?.error) errors.push(r.error);
  }
  return { offers, errors: [...new Set(errors)] };
}

async function webPrices(items, progress) {
  const s = db.get().settings;
  const webStores = STORES.filter((x) => x.type === 'web').map((x) => x.name);
  const extra = (s.lojasWeb || []).filter((n) => !webStores.includes(n));
  const storeNames = [...webStores, ...extra];
  progress(`Pesquisando preços na web (${storeNames.slice(0, 4).join(', ')}...)`);

  const local = [s.cidade, s.cep && `CEP ${s.cep}`].filter(Boolean).join(', ');
  const prompt = `Pesquise na web os preços ATUAIS (hoje) dos produtos abaixo em supermercados online brasileiros, priorizando: ${storeNames.join(', ')}.${local ? ` Região do comprador: ${local}.` : ''}

Produtos:
${items.map((i) => `- ${itemQuery(i)} (qtd: ${i.qty || 1})`).join('\n')}

Responda SOMENTE com JSON no formato:
{"offers":[{"store":"nome da loja","product":"nome completo do produto","brand":"marca","price":12.34,"link":"url ou null","forItem":"nome do item da lista correspondente"}]}
Inclua apenas ofertas com preço encontrado de verdade na pesquisa; não invente preços.`;

  try {
    const data = await or.chatJson({
      model: s.searchModel,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 8000
    });
    const offers = (data.offers || []).filter((o) => o.price > 0);
    return { offers: offers.map((o) => ({ ...o, source: 'web', available: true })), errors: [] };
  } catch (e) {
    return { offers: [], errors: [`Busca web: ${e.message}`] };
  }
}

async function composeProposals(items, offers, progress) {
  const s = db.get().settings;
  progress('Montando propostas de carrinho e alternativas...');
  const prompt = `Você é um assistente de compras de supermercado no Brasil. Com base na LISTA do usuário e nas OFERTAS coletadas (preços reais encontrados agora), monte propostas de carrinho.

LISTA:
${JSON.stringify(items.map((i) => ({ name: i.name, brand: i.brand, package: i.package, qty: i.qty || 1 })), null, 1)}

OFERTAS COLETADAS:
${JSON.stringify(offers.slice(0, 120), null, 1)}

Regras:
1. Crie até 3 propostas de carrinho, cada uma concentrada em UMA loja (a entrega vem de um lugar só). Ordene da mais barata para a mais cara no total. Use apenas preços presentes nas OFERTAS.
2. Em cada proposta, para cada item da lista escolha a oferta que melhor corresponde (marca/embalagem pedida). Itens sem oferta na loja vão em "missing".
3. Gere "alternatives": sugestões de troca por item quando existir (a) opção mais barata equivalente (ex.: outra marca confiável por menos) ou (b) opção mais saudável/orgânica (ex.: sem ingrediente controverso) por pouco mais. Explique em 1 frase o porquê, em português, no tom: "Você pediu X, não gostaria de Y por R$ Z a menos?". Baseie alegações de saúde apenas em conhecimento geral confiável sobre os ingredientes; se não souber a composição, não invente.
4. Responda SOMENTE com JSON:
{"proposals":[{"store":"...","items":[{"name":"item da lista","product":"produto escolhido","brand":"...","qty":1,"unitPrice":0.0,"total":0.0,"link":null}],"missing":["..."],"subtotal":0.0,"note":"observação curta"}],
"alternatives":[{"forItem":"...","suggestion":"frase da sugestão","product":"...","store":"...","price":0.0,"priceDiff":-2.0,"reason":"cheaper|healthier","link":null}],
"summary":"resumo em 2-3 frases para ser falado em voz alta"}`;

  return or.chatJson({
    model: s.model,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 8000,
    temperature: 0.2
  });
}

async function generateQuote(progress = () => {}) {
  const items = db.get().list;
  if (!items.length) throw new Error('A lista de compras está vazia.');

  const [scraped, web] = await Promise.all([
    scrapePrices(items, progress),
    webPrices(items, progress)
  ]);
  const offers = [...scraped.offers, ...web.offers];
  const errors = [...scraped.errors, ...web.errors];
  if (!offers.length) {
    throw new Error(
      'Nenhum preço encontrado. ' + (errors.length ? `Erros: ${errors.join(' | ')}` : 'Verifique sua conexão e a chave do OpenRouter.')
    );
  }

  const result = await composeProposals(items, offers, progress);
  const quote = {
    createdAt: new Date().toISOString(),
    items: items.map((i) => ({ name: i.name, qty: i.qty || 1 })),
    proposals: result.proposals || [],
    alternatives: result.alternatives || [],
    summary: result.summary || '',
    offersCollected: offers.length,
    warnings: errors
  };
  db.update((d) => {
    d.lastQuote = quote;
  });
  return quote;
}

module.exports = { generateQuote };
