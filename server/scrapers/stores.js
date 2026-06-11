// Lojas conhecidas. type 'vtex' = tem scraper direto (API de catálogo VTEX);
// type 'web' = preço pesquisado via OpenRouter com busca na web.
// Para adicionar outro mercado VTEX, inclua { id, name, base, type: 'vtex' }.
'use strict';

const STORES = [
  { id: 'carrefour', name: 'Carrefour Mercado', base: 'https://mercado.carrefour.com.br', type: 'vtex' },
  { id: 'condor', name: 'Condor', base: 'https://www.condor.com.br', type: 'vtex' },
  { id: 'sonda', name: 'Sonda Delivery', base: 'https://www.sondadelivery.com.br', type: 'vtex' },
  { id: 'paodeacucar', name: 'Pão de Açúcar', type: 'web' },
  { id: 'extra', name: 'Extra Mercado', type: 'web' },
  { id: 'atacadao', name: 'Atacadão', type: 'web' },
  { id: 'assai', name: 'Assaí Atacadista', type: 'web' },
  { id: 'ifood', name: 'iFood Mercado', type: 'web' }
];

module.exports = { STORES };
