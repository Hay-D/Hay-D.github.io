import {readFile, writeFile, rename} from 'node:fs/promises';
import {resolveItem} from '../public/js/core.js';
import {materialSetItems, serviceItems} from '../public/js/editor-core.js';
import {validateMarket, MARKET_SOURCE} from '../public/js/market-prices.js';
import {pathToFileURL} from 'node:url';

export async function updateMarketPrices({fetcher = fetch, output = new URL('../public/data/market-prices.json', import.meta.url)} = {}) {
  const base = JSON.parse(await readFile(new URL('../public/data/catalog.json', import.meta.url), 'utf8')).items;
  const catalog = [...base, ...materialSetItems(base), ...serviceItems], byId = new Map(catalog.map(item => [item.id, item]));
  const entries = new Map;
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const url = new URL('/api/trading/overview', MARKET_SOURCE);
    url.search = new URLSearchParams({days: '7', type: 'all', sort: 'name', direction: 'asc', movement: 'all', page: String(page), q: ''});
    const response = await fetcher(url, {headers: {'Accept': 'application/json', 'User-Agent': 'HayDex/1.1 (+https://github.com/Hay-D/Hay-D.github.io)'}, signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`Price source returned HTTP ${response.status}; keeping the previous snapshot.`);
    const data = await response.json();
    if (data.ok !== true || !Array.isArray(data.items) || !Number.isSafeInteger(data.total_pages) || data.total_pages < 1 || data.total_pages > 80) throw new Error('Unexpected market response; keeping the previous snapshot.');
    if (page === 1) pages = data.total_pages;
    for (const raw of data.items) {
      const key = String(raw.item_key || '').replaceAll('_', '-');
      const item = byId.get(key) || resolveItem(String(raw.item_name || ''), catalog);
      if (!item) continue;
      const price = side => typeof raw['avg_' + side] === 'number' && Number.isFinite(raw['avg_' + side]) && raw['avg_' + side] >= 0 ? Math.round(raw['avg_' + side] * 100) / 100 : null;
      entries.set(item.id, {id: item.id, buy: price('buy'), sell: price('sell'), buyPosts: raw.buy_price_posts ?? raw.buy_posts, sellPosts: raw.sell_price_posts ?? raw.sell_posts});
    }
    if (page < pages) await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!entries.size) throw new Error('No matching market data; keeping the previous snapshot.');
  const data = validateMarket({version: 1, source: MARKET_SOURCE, periodDays: 7, updatedAt: new Date().toISOString(), items: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id))});
  const temp = new URL(output.href + '.tmp');
  await writeFile(temp, JSON.stringify(data) + '\n');
  await rename(temp, output);
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {const data = await updateMarketPrices(); console.log(`Updated ${data.items.length} trading prices from hayday.info.`);}
  catch (error) {console.error(error.message); process.exitCode = 1;}
}
