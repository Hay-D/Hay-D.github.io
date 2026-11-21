import {number, parseImport, parsePrice, resolveItem, totals} from './core.js';

export const MAX_EXCHANGES = 40;
export const MAX_SIDE_ITEMS = 16;
const MAX_DEALS = 250;
const MODES = ['sell', 'buy', 'trade'];

export function readDiscount(value) {
  const percent = Number(value?.percent ?? 0);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Enter a discount from 0 to 100%.');
  const rounded = Math.round(percent * 100) / 100;
  if (!rounded) return null;
  return {percent: rounded, name: String(value.name ?? '').trim().slice(0, 50) || 'Bundle deal'};
}

export function applyDiscount(coins, value) {
  const subtotal = Math.round(coins * 100) / 100;
  const discount = value?.percent ? readDiscount(value) : null;
  const saved = discount ? Math.round(subtotal * discount.percent) / 100 : 0;
  return {subtotal, discount, saved, coins: Math.round((subtotal - saved) * 100) / 100};
}

export function discountLines(total) {
  if (!total.discount) return [];
  return [
    'Subtotal · ' + number(total.subtotal) + ' coins',
    total.discount.name + ' (' + number(total.discount.percent) + '% off) · −' + number(total.saved) + ' coins'
  ];
}

export function readExchangeRatio(value) {
  const ratio = String(value ?? '').trim().replace('/', ':');
  if (!ratio) return '';
  if (!/^\d{1,6}\s*:\s*\d{1,6}$/.test(ratio)) throw new Error('Enter a Have:Want ratio such as 1:85.');
  return parsePrice(ratio).ratio;
}

export function checkExchanges(values, catalog) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > MAX_EXCHANGES) throw new Error('Use up to ' + MAX_EXCHANGES + ' exchanges per post.');
  return values.map(exchange => {
    const side = rows => {
      if (!Array.isArray(rows) || !rows.length || rows.length > MAX_SIDE_ITEMS) {
        throw new Error('Add 1 to ' + MAX_SIDE_ITEMS + ' items to both Have and Want.');
      }
      return parseImport(JSON.stringify(rows.map(row => ({id: row.id, name: row.name, quantity: row.quantity}))), catalog);
    };
    const ratio = readExchangeRatio(exchange?.ratio);
    const terms = String(exchange?.terms ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    return {have: side(exchange?.have), want: side(exchange?.want), ...(ratio && {ratio}), ...(terms && {terms})};
  });
}

export function formatPostItems(rows, byId, priceLabel) {
  return rows.map(row => {
    const price = priceLabel?.(row);
    return row.quantity + ' ' + byId.get(row.id).name + (price ? ' @ ' + price : '');
  }).join('\n');
}

export function exchangeText(exchanges, byId, discord = false) {
  const label = value => discord ? '**' + value + '**' : value;
  return exchanges.map(({have, want, ratio, terms}, i) => [
    exchanges.length > 1 ? label('Exchange ' + (i + 1)) : '',
    label('Have'), formatPostItems(have, byId),
    label('Want'), formatPostItems(want, byId),
    ratio ? label('Ratio · ' + ratio + ' (Have:Want)') : '',
    terms ? 'Terms · ' + terms : ''
  ].filter(Boolean).join('\n')).join('\n\n');
}

function cleanLine(line) {
  return line.trim().replace(/^>\s*/, '').replace(/^[-•]\s+/, '').replace(/\*\*|__|`/g, '').trim();
}

function cleanItem(text) {
  return text.replace(/<a?:[\w-]+:\d{3,25}>|:[\w+-]+:|\p{Extended_Pictographic}|\uFE0F|\u200D/gu, ' ').trim();
}

function oldPrice(value, catalog) {
  const text = value.trim().replace(/\s*(?:each|ea\.?|per(?:\s+(?:item|set))?)$/i, '');
  if (/^(?:mp|max price)$/i.test(text)) return '1x';
  const currency = text.match(/^([\d,.]+)\s+(?:(?:diamond )?rings?|blankets?|coins?)$/i);
  if (currency) {
    const factor = /ring/i.test(text) ? resolveItem('diamond-ring', catalog)?.maxPrice :
      /blanket/i.test(text) ? resolveItem('blanket', catalog)?.maxPrice : 1;
    if (factor) return String(Math.round(Number(currency[1].replaceAll(',', '')) * factor * 100) / 100);
  }
  return text;
}

function itemLine(line, catalog) {
  const leading = line.match(/^([\d,]+)\s*(?:[x×]\s+|[;,]\s*|\s+)(.+)$/i);
  const trailing = line.match(/^(.+?)\s+[x×]\s*([\d,]+)(.*)$/i);
  if (!leading && !trailing) return null;
  const quantity = Number((leading ? leading[1] : trailing[2]).replaceAll(',', ''));
  let label = cleanItem(leading ? leading[2] : trailing[1] + trailing[3]);
  let price = '';
  if (!resolveItem(label, catalog)) {
    const priced = label.match(/^(.+?)\s*(?:@\s*(.+)|\(([^)]+)\)|[–—]\s*(.+))$/) ||
      label.match(/^(.+?)\s+([\d.]+(?:[kmx]|\s*xmp)?\s*(?:coins?\s*)?(?:ea\.?|each|per(?: item| set)?))$/i);
    if (priced) {
      label = priced[1].trim();
      price = oldPrice(priced[2] || priced[3] || priced[4], catalog);
    }
  }
  const item = resolveItem(label, catalog);
  if (!item) return null;
  return {id: item.id, quantity, ...(price ? {price} : {unpriced: true})};
}

export function importPost(text, catalog, fallback = 'sell') {
  const input = String(text).trim().replace(/^\x60{3}(?:json|text)?[ \t]*\r?\n|\r?\n\x60{3}$/gi, '');
  if (!input || input.length > 500000) throw new Error('Paste an old post up to 500 KB.');
  if (/^(?:HDTRADE1|[\[{])/.test(input)) {
    if (/^[\[{]/.test(input)) {
      let data;
      try {data = JSON.parse(input);} catch {throw new Error('The JSON could not be read.');}
      if (data?.type === 'haydex-post' && data.version === 1) return {post: data.post, skipped: []};
      if (data?.type === 'hayday-editor-backup' && data.version === 1) return {post: data.draft, skipped: []};
    }
    return {post: {items: parseImport(input, catalog), mode: fallback === 'buy' ? 'buy' : 'sell'}, skipped: []};
  }

  const items = [], swaps = [], skipped = [], caption = [];
  let mode = fallback === 'buy' ? 'buy' : 'sell';
  let name = 'Imported post', partials = true, discount = null, current = null, side = null;
  for (const raw of input.split(/\r?\n/)) {
    let line = cleanLine(raw);
    if (!line || /^~~.*~~$/.test(line) || /^(?:https?:\/\/|Hay-D\.github\.io)/i.test(line)) continue;
    const heading = line.match(/^#*\s*(selling|buying|trading|wts|wtb|wtt|trade|sell|buy)(?:(?:\s*[·:—-]\s*)(.*))?$/i);
    if (heading) {
      const action = heading[1].toLowerCase();
      mode = ['buying', 'buy', 'wtb'].includes(action) ? 'buy' : ['trading', 'trade', 'wtt'].includes(action) ? 'trade' : 'sell';
      if (heading[2]) name = heading[2].trim().slice(0, 50);
      continue;
    }
    if (/^(?:exchange|deal)\s+\d+:?$/i.test(line)) {
      current = null;
      side = null;
      continue;
    }
    const sideHeading = line.match(/^(?:i\s+)?(have|want|need)s?\b\s*:?\s*(.*)$/i);
    if (sideHeading) {
      mode = 'trade';
      side = sideHeading[1].toLowerCase() === 'have' ? 'have' : 'want';
      if (!current || (side === 'have' && current.want.length)) {
        current = {have: [], want: []};
        swaps.push(current);
      }
      line = sideHeading[2];
      if (!line) continue;
    }
    const ratio = current && line.match(/^(?:ratio\s*[·:]?\s*)?(\d{1,6}\s*[:/]\s*\d{1,6})(?:\s*\((?:have:want|me:you)\))?$/i);
    if (ratio) {
      current.ratio = readExchangeRatio(ratio[1]);
      continue;
    }
    const terms = current && line.match(/^terms\s*[·:]\s*(.+)$/i);
    if (terms) {
      current.terms = terms[1];
      continue;
    }
    const rebate = line.match(/^(.+?)\s+\(([\d.]+)%\s+off\)(?:\s*·.*)?$/i);
    if (rebate) {
      discount = readDiscount({name: rebate[1], percent: rebate[2]});
      continue;
    }
    if (/^(?:subtotal|total)(?:$|[\s:·])/i.test(line) || /^[\d,.]+\s+coins(?:\s*·|$)/i.test(line)) continue;

    const row = itemLine(line, catalog);
    if (row) {
      if (current && side) current[side].push(row);
      else items.push(row);
      continue;
    }

    if (/^(?:no )?partials(?: accepted)?\b/i.test(line)) {
      partials = !/^no\b/i.test(line);
      caption.push(line);
    } else {
      skipped.push(raw.trim().slice(0, 180));
    }
  }
  const post = {name, mode, partials, discount, image: {captionText: caption.join('\n')}, items: [], swaps: []};
  if (mode === 'trade') {
    post.swaps = checkExchanges(swaps.filter(exchange => exchange.have.length || exchange.want.length), catalog);
    if (!post.swaps.length) throw new Error('Use Have and Want headings with quantities beneath each one.');
  } else {
    if (!items.length) throw new Error('No items found. Try lines like “20 Beeswax @ 3k” or “Lobster tail x12”.');
    post.items = parseImport(JSON.stringify(items), catalog);
  }
  return {post, skipped};
}

export function dealValue(post, byId) {
  if (post.mode === 'trade') {
    const units = post.swaps.flatMap(row => [...row.have, ...row.want]).reduce((sum, row) => sum + row.quantity, 0);
    return {units, coins: 0};
  }
  const value = totals(post.items, byId);
  return {...value, ...applyDiscount(value.coins, post.mode === 'sell' ? post.discount : null)};
}

export function checkedLedger(entries, checkPost) {
  if (!Array.isArray(entries) || entries.length > MAX_DEALS) throw new Error('This backup has an invalid deals list.');
  const used = new Set();
  return entries.map(entry => {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(entry.id) || used.has(entry.id)) {
      throw new Error('This backup has an invalid deal.');
    }
    const post = checkPost(entry.post);
    if (!MODES.includes(post.mode) || !(post.mode === 'trade' ? post.swaps.length : post.items.length)) {
      throw new Error('A saved deal has no items.');
    }
    const createdAt = new Date(entry.createdAt), completedAt = entry.completedAt ? new Date(entry.completedAt) : null;
    if (!Number.isFinite(+createdAt) || (completedAt && !Number.isFinite(+completedAt))) throw new Error('A deal date is invalid.');
    used.add(entry.id);
    return {id: entry.id, partner: String(entry.partner ?? '').slice(0, 60), post, createdAt: createdAt.toISOString(), completedAt: completedAt?.toISOString() || null};
  });
}

export function upsertDeal(entries, deal) {
  const index = entries.findIndex(entry => entry.id === deal.id);
  if (index < 0 && entries.length >= MAX_DEALS) throw new Error('The device has 250 saved deals. Export a backup before removing old entries.');
  return index < 0 ? [deal, ...entries] : entries.map((entry, i) => i === index ? deal : entry);
}

export function dealStats(entries, byId, from = 0) {
  const data = {sold: 0, bought: 0, traded: 0, earned: 0, spent: 0, count: 0, sales: [], partners: []};
  const soldItems = new Map(), partners = new Map();
  for (const entry of entries) {
    if (!entry.completedAt || Date.parse(entry.completedAt) < from) continue;
    const {post, partner} = entry, value = dealValue(post, byId);
    data.count++;
    if (partner) partners.set(partner, (partners.get(partner) || 0) + 1);
    if (post.mode === 'buy') {
      data.bought += value.units;
      data.spent += value.coins;
    } else if (post.mode === 'trade') {
      data.traded += value.units;
    } else {
      data.sold += value.units;
      data.earned += value.coins;
      for (const row of post.items) soldItems.set(row.id, (soldItems.get(row.id) || 0) + row.quantity);
    }
  }
  const ranked = map => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  data.sales = ranked(soldItems);
  data.partners = ranked(partners);
  return data;
}
