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

function webStoreNames() {
  const s = db.get().settings;
  const base = STORES.filter((x) => x.type === 'web').map((x) => x.name);
  const extra = (s.lojasWeb || []).filter((n) => !base.includes(n));
  return [...base, ...extra];
}

async function webPrices(items, progress) {
  const s = db.get().settings;
  const storeNames = webStoreNames();
  progress(`Pesquisando preços na web (${storeNames.slice(0, 4).join(', ')}...)`);

  const local = [s.cidade, s.cep && `CEP ${s.cep}`].filter(Boolean).join(', ');
  // Em blocos pequenos a busca acha mais preços do que com a lista inteira de uma vez.
  const chunks = [];
  for (let i = 0; i < items.length; i += 5) chunks.push(items.slice(i, i + 5));

  const offers = [];
  const errors = [];
  for (const [ci, chunk] of chunks.entries()) {
    const prompt = `Pesquise na web os preços ATUAIS (hoje) dos produtos abaixo em supermercados online brasileiros, priorizando: ${storeNames.join(', ')}.${local ? ` Região do comprador: ${local}.` : ''}

Produtos:
${chunk.map((i) => `- ${itemQuery(i)} (qtd: ${i.qty || 1})`).join('\n')}

Responda SOMENTE com JSON no formato:
{"offers":[{"store":"nome da loja","product":"nome completo do produto","brand":"marca","price":12.34,"link":"url ou null","forItem":"nome do item da lista correspondente"}]}
Inclua apenas ofertas com preço encontrado de verdade na pesquisa; não invente preços. Se não encontrar nada, responda {"offers":[]}.`;

    try {
      // sem response_format: alguns modelos de busca não aceitam JSON mode;
      // o parse tolerante extrai o JSON da resposta.
      const text = await or.chat({
        model: s.searchModel,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 8000
      });
      const data = or.parseJson(text);
      for (const o of data.offers || []) {
        if (o.price > 0) offers.push({ ...o, source: 'web', available: true });
      }
    } catch (e) {
      errors.push(`Busca web${chunks.length > 1 ? ` (parte ${ci + 1})` : ''}: ${e.message}`);
    }
  }
  if (!offers.length && !errors.length) {
    errors.push('A busca web não retornou preços — experimente outro modelo de busca na aba Config (ex.: perplexity/sonar).');
  }
  return { offers, errors };
}

// Último recurso quando nada ao vivo funciona: o modelo estima preços típicos.
// A cotação fica marcada como estimativa para o usuário conferir antes de comprar.
async function estimatePrices(items, progress) {
  const s = db.get().settings;
  progress('Sem preços ao vivo — gerando estimativa pelo modelo...');
  const data = await or.chatJson({
    model: s.model,
    maxTokens: 8000,
    messages: [
      {
        role: 'user',
        content: `Estime o preço típico ATUAL no Brasil${s.cidade ? ` (região de ${s.cidade})` : ''} dos produtos abaixo nestes mercados: ${webStoreNames().join(', ')}. Use valores realistas de supermercado online; diferencie atacarejo (mais barato) de rede premium.

Produtos:
${items.map((i) => `- ${itemQuery(i)} (qtd: ${i.qty || 1})`).join('\n')}

Responda SOMENTE com JSON:
{"offers":[{"store":"...","product":"...","brand":"...","price":12.34,"link":null,"forItem":"item da lista"}]}
Gere ofertas em pelo menos 2 lojas por item.`
      }
    ]
  });
  return (data.offers || [])
    .filter((o) => o.price > 0)
    .map((o) => ({ ...o, source: 'estimativa', available: true }));
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
  let offers = [...scraped.offers, ...web.offers];
  const errors = [...scraped.errors, ...web.errors];
  let estimated = false;

  if (!offers.length) {
    try {
      offers = await estimatePrices(items, progress);
      estimated = offers.length > 0;
    } catch (e) {
      errors.push(`Estimativa: ${e.message}`);
    }
  }
  if (!offers.length) {
    throw new Error(
      'Nenhum preço encontrado. ' + (errors.length ? `Erros: ${errors.join(' | ')}` : 'Verifique sua conexão e a chave do OpenRouter.')
    );
  }
  if (estimated) {
    errors.push('Nenhuma fonte de preço ao vivo respondeu; os valores abaixo são ESTIMATIVAS do modelo.');
  }

  const result = await composeProposals(items, offers, progress);
  const quote = {
    createdAt: new Date().toISOString(),
    items: items.map((i) => ({ name: i.name, qty: i.qty || 1 })),
    proposals: result.proposals || [],
    alternatives: result.alternatives || [],
    summary: result.summary || '',
    offersCollected: offers.length,
    estimated,
    warnings: errors
  };
  db.update((d) => {
    d.lastQuote = quote;
  });
  return quote;
}

module.exports = { generateQuote };
