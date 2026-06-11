// Função serverless (Vercel): proxy para a API de catálogo VTEX dos mercados.
// Necessária porque os sites das lojas não liberam CORS para o navegador.
// Só aceita lojas cadastradas em server/scrapers/stores.js (nada de URL livre).
'use strict';

const { searchVtex } = require('../server/scrapers/vtex');
const { STORES } = require('../server/scrapers/stores');

module.exports = async (req, res) => {
  const { store: storeId, q } = req.query || {};
  const store = STORES.find((s) => s.id === storeId && s.type === 'vtex');
  if (!store) return res.status(400).json({ error: 'Loja desconhecida.' });
  if (!q || String(q).length > 200) return res.status(400).json({ error: 'Busca inválida.' });
  try {
    const offers = await searchVtex(store, String(q));
    res.status(200).json({ offers });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
