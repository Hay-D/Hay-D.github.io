export const MARKET_SOURCE = 'https://hayday.info/trading';

export function validateMarket(data) {
  if (data?.version !== 1 || data.source !== MARKET_SOURCE || data.periodDays !== 7 || !Number.isFinite(Date.parse(data.updatedAt)) || !Array.isArray(data.items) || data.items.length > 2000) throw new Error('Trading prices are unavailable.');
  const seen = new Set;
  const items = data.items.map(item => {
    if (!/^[a-z0-9-]{1,80}$/.test(item.id) || seen.has(item.id)) throw new Error('Invalid price list.');
    seen.add(item.id);
    const result = {id: item.id};
    for (const key of ['buy', 'sell']) {
      if (item[key] !== null && (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || item[key] < 0 || item[key] > 1e10)) throw new Error('Invalid market price.');
      result[key] = item[key];
      const count = item[key + 'Posts'];
      result[key + 'Posts'] = Number.isSafeInteger(count) && count >= 0 ? count : 0;
    }
    return result;
  });
  return {version: 1, source: MARKET_SOURCE, periodDays: 7, updatedAt: data.updatedAt, items};
}

let pending, fetchedAt = 0;
export function loadMarketPrices(reload = false) {
  if (!pending || reload || Date.now() - fetchedAt >= 5 * 60000) {
    fetchedAt = Date.now();
    pending = (async () => {
      const controller = new AbortController, timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(new URL('../data/market-prices.json', import.meta.url), {signal: controller.signal, cache: reload ? 'reload' : 'no-cache', credentials: 'omit'});
        if (!response.ok) throw new Error('Trading prices are unavailable.');
        return validateMarket(await response.json());
      } finally {clearTimeout(timeout);}
    })().catch(error => {pending = null; fetchedAt = 0; throw error;});
  }
  return pending;
}

export function marketRows(data, catalog, query = '', level = null) {
  const prices = new Map(data.items.map(item => [item.id, item]));
  const text = query.trim().toLowerCase();
  return catalog.filter(item => prices.has(item.id) && (level === null || item.level <= level) && `${item.name} ${item.id}`.toLowerCase().includes(text)).map(item => ({item, ...prices.get(item.id)})).sort((a, b) => b.buyPosts + b.sellPosts - a.buyPosts - a.sellPosts || a.item.name.localeCompare(b.item.name));
}
