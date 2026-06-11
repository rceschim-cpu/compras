// Scraper genérico para lojas na plataforma VTEX (API pública de catálogo).
// Muitos mercados brasileiros usam VTEX; basta cadastrar a URL base em stores.js.
'use strict';

async function searchVtex(store, query, limit = 6) {
  const url =
    `${store.base}/api/catalog_system/pub/products/search/` +
    `${encodeURIComponent(query)}?_from=0&_to=${limit - 1}` +
    (store.salesChannel ? `&sc=${store.salesChannel}` : '');
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`${store.name}: HTTP ${res.status}`);
  const products = await res.json();
  if (!Array.isArray(products)) return [];

  const offers = [];
  for (const p of products) {
    const item = p.items?.[0];
    const seller = item?.sellers?.find((s) => s.commertialOffer?.IsAvailable) || item?.sellers?.[0];
    const offer = seller?.commertialOffer;
    if (!offer || !offer.Price) continue;
    offers.push({
      store: store.name,
      storeId: store.id,
      product: p.productName,
      brand: p.brand || null,
      price: offer.Price,
      listPrice: offer.ListPrice || null,
      available: !!offer.IsAvailable,
      unit: item?.measurementUnit || null,
      link: p.link || (p.linkText ? `${store.base}/${p.linkText}/p` : null),
      source: 'scraper'
    });
  }
  return offers;
}

module.exports = { searchVtex };
