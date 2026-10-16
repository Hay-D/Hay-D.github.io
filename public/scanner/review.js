import { deduplicateScans } from '../js/core.js';

import { checkedPrice, playerLevel } from '../js/editor-core.js';

export function excludedItemIds(value, byId) {
  return new Set(Array.isArray(value) ? value.filter((id => typeof id === 'string' && byId.has(id))) : []);
}

export function canListScan(row, byId, excluded) {
  return row.enabled && !excluded.has(row.id) && byId.has(row.id) && Number.isSafeInteger(row.quantity) && row.quantity > 0 && row.quantity <= 999999;
}

export function scannerPrice(row, item, settings = {}, options = {}) {
  const text = row.priceInput ?? settings.prices?.[row.id] ?? (options.useDefaultPrice ? settings.defaultPrice ?? '' : '');
  if (!item || text === undefined || text === null || String(text).trim() === '') return null;
  try {
    const price = checkedPrice(text, item);
    return {
      mode: price.mode,
      price: price.value,
      ...price.ratio ? {
        ratio: price.ratio
      } : {}
    };
  } catch {
    return null;
  }
}

export function exclusionItems(catalog, excluded, query = '', level = null, only = false) {
  const limit = playerLevel(level), text = query.trim().toLowerCase();
  return catalog.filter((item => (limit === null || item.level <= limit) && (!only || excluded.has(item.id)) && `${item.name} ${item.id}`.toLowerCase().includes(text))).sort(((a, b) => a.name.localeCompare(b.name)));
}

export function scanTradeRows(rows, byId, excluded, settings, options = {}) {
  return deduplicateScans(rows.filter((row => row.confirmed && canListScan(row, byId, excluded)))).map((row => ({
    id: row.id,
    quantity: row.quantity,
    ...settings ? scannerPrice(row, byId.get(row.id), settings, options) || {
      unpriced: true
    } : {}
  })));
}

export function reviewBounds(icon, quantity, width, height) {
  const boxes = quantity ? [ icon, quantity ] : [ icon ];
  const x = Math.max(0, Math.floor(Math.min(...boxes.map((box => box[0]))) - 3));
  const y = Math.max(0, Math.floor(Math.min(...boxes.map((box => box[1]))) - 3));
  const right = Math.min(width, Math.ceil(Math.max(...boxes.map((box => box[0] + box[2]))) + 3));
  const bottom = Math.min(height, Math.ceil(Math.max(...boxes.map((box => box[1] + box[3]))) + 3));
  return {
    x: x,
    y: y,
    w: Math.max(1, right - x),
    h: Math.max(1, bottom - y)
  };
}
