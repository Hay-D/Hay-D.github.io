import { number, totals, unitPrice, parsePrice, parseQuantity, resolveItem, parseImport } from './core.js';

import { PERMANENT_WATERMARK } from './branding.js';

export const imageDefaults = {
  layout: 'auto',
  columns: 4,
  width: 1e3,
  quality: 2,
  background: '#222222',
  border: '#737373',
  text: '#ffffff',
  names: true,
  itemNamesVersion: 1,
  prices: true,
  quantities: true,
  totals: true,
  payment: true,
  caption: true,
  captionText: '',
  captionPosition: 'bottom',
  watermark: PERMANENT_WATERMARK,
  padding: 14,
  gap: 4,
  simplify: true
};

export const editorDefaults = {
  defaultQuantity: 1,
  calculationItem: 'diamond-ring',
  toolbarPosition: 'bottom',
  sortOrder: 'quantity',
  level: null,
  textFormat: '{{quantity}} {{name}} ({{price}})',
  textSeparator: 'newline',
  customSeparator: ', '
};

export const serviceItems = [ {
  id: 'help',
  name: 'Help',
  category: 'Services',
  level: 1,
  maxPrice: null,
  image: 'assets/services/help.png',
  source: 'https://hayday.fandom.com/wiki/Help',
  service: true
} ];

export const materialGroups = {
  BEM: [ 'bolt', 'plank', 'duct-tape' ],
  SEM: [ 'nail', 'screw', 'wood-panel' ],
  LEM: [ 'land-deed', 'mallet', 'marker-stake' ]
};

export const colorPresets = [ {
  name: 'Charcoal',
  background: '#222222',
  border: '#656669',
  text: '#ffffff'
}, {
  name: 'Midnight',
  background: '#171c29',
  border: '#47526b',
  text: '#edf2ff'
}, {
  name: 'Forest',
  background: '#1b2923',
  border: '#4d6c5d',
  text: '#e9f1dc'
}, {
  name: 'Plum',
  background: '#2a202d',
  border: '#705575',
  text: '#f6eaf8'
}, {
  name: 'Coffee',
  background: '#2b2420',
  border: '#78604a',
  text: '#f8ecda'
}, {
  name: 'Slate',
  background: '#29323a',
  border: '#657686',
  text: '#f0f5fa'
}, {
  name: 'Cream',
  background: '#fff9cf',
  border: '#c8be91',
  text: '#272727'
}, {
  name: 'Sky',
  background: '#94c4fa',
  border: '#d6deea',
  text: '#ffffff'
} ];

export function editorColumns(count, image, width, compact = false) {
  if (image.layout === 'fixed') return image.columns;
  if (image.layout === 'device' && compact) return 4;
  const available = Math.max(0, width - image.padding * 2);
  const capacity = Math.min(8, Math.max(2, Math.round(available / (compact ? 89 : 140))));
  const preferred = count > 3 ? Math.ceil(Math.sqrt(count)) : count || 4;
  return Math.min(capacity, preferred);
}

export function imageGrid(count, image, width, columns) {
  const compact = image.layout !== 'fixed' && count > 0 && count <= 3;
  const sizingColumns = compact ? Math.max(4, columns) : columns;
  const available = Math.max(0, width - image.padding * 2);
  const cell = Math.max(0, (available - image.gap * (sizingColumns - 1)) / sizingColumns);
  const visibleColumns = compact ? Math.min(count, columns) : columns;
  const gridWidth = cell * visibleColumns + image.gap * (visibleColumns - 1);
  const left = compact ? image.padding + (available - gridWidth) / 2 : image.padding;
  return {
    columns: visibleColumns,
    cell: cell,
    gridWidth: gridWidth,
    left: left
  };
}

export function playerLevel(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const level = Number(value);
  if (!Number.isInteger(level) || level < 1 || level > 999) throw new Error('Level must be 1–999. Leave it blank to show all items.');
  return level;
}

export function materialCounts(quantity) {
  const sets = parseQuantity(quantity);
  return [ sets, sets, sets ];
}

export function materialSetItems(catalog) {
  const byId = new Map(catalog.map((item => [ item.id, item ])));
  return Object.entries(materialGroups).map((([group, components]) => ({
    id: group.toLowerCase() + '-set',
    name: group + ' set',
    category: 'Sets',
    group: group,
    level: Math.max(...components.map((id => byId.get(id).level))),
    maxPrice: components.reduce(((sum, id) => sum + byId.get(id).maxPrice), 0),
    image: `assets/sets/${group.toLowerCase()}-set.png`,
    bundle: true,
    components: components,
    minQuantity: 1
  })));
}

export function sortRows(rows, byId, order = 'quantity') {
  if (order === 'manual') return [ ...rows ];
  return [ ...rows ].sort(((a, b) => {
    const itemA = byId.get(a.id), itemB = byId.get(b.id);
    const delta = order === 'quantity' ? b.quantity - a.quantity : order === 'price' ? unitPrice(b, itemB) - unitPrice(a, itemA) : order === 'total' ? unitPrice(b, itemB) * b.quantity - unitPrice(a, itemA) * a.quantity : 0;
    return delta || itemA.name.localeCompare(itemB.name);
  }));
}

export function selectedRows(rows, selection) {
  return selection.size ? rows.filter((row => selection.has(row.id))) : [ ...rows ];
}

export function paymentItems(catalog, query = '', order = 'high', level = null) {
  const text = String(query).toLowerCase();
  return catalog.filter((item => item.maxPrice > 0 && !item.bundle && (!text || `${item.name} ${item.id}`.toLowerCase().includes(text)) && (level === null || item.level <= level))).sort(((a, b) => (order === 'low' ? a.maxPrice - b.maxPrice : order === 'name' ? 0 : b.maxPrice - a.maxPrice) || a.name.localeCompare(b.name)));
}

export function priceLabel(row, simplify = true) {
  if (row.price === undefined || row.unpriced) return '';
  if (row.mode === 'ratio') return row.ratio || row.priceInput;
  if (!simplify && row.priceInput) return row.priceInput;
  if (row.mode === 'multiplier') return number(row.price) + 'x';
  const value = row.price;
  return value >= 1e6 && value % 1e4 === 0 ? number(value / 1e6) + 'm' : value >= 1e3 && value % 10 === 0 ? number(value / 1e3) + 'k' : number(value);
}

export function paymentSummary(rows, byId, paymentId) {
  const total = totals(rows, byId), item = byId.get(paymentId), base = item?.maxPrice;
  return {
    ...total,
    item: item,
    equivalent: base > 0 ? total.coins / base : null
  };
}

export function tradeOverview(rows, byId, paymentId) {
  const summary = paymentSummary(rows, byId, paymentId);
  return {
    ...summary,
    goods: rows.length,
    unpriced: rows.filter((row => row.unpriced || row.price === undefined)).length,
    ratios: rows.filter((row => !row.unpriced && row.mode === 'ratio')).length,
    zeroPrices: rows.filter((row => !row.unpriced && row.price !== undefined && row.mode !== 'ratio' && unitPrice(row, byId.get(row.id)) === 0)).length
  };
}

export function listText(rows, byId, format, separator) {
  return rows.map((row => {
    const text = format.replace(/\{\{(name|quantity|price|total|unit)\}\}/g, ((_, key) => ({
      name: byId.get(row.id).name,
      quantity: row.quantity,
      price: priceLabel(row),
      total: number(unitPrice(row, byId.get(row.id)) * row.quantity),
      unit: number(unitPrice(row, byId.get(row.id)))
    }[key])));
    return row.unpriced ? text.replace(/\s*\(\s*\)/g, '') : text;
  })).join(separator);
}

export function captionPartials(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/[ \t]+/g, ' ');
  if (text === 'partials accepted') return true;
  if (text === 'no partials accepted' || text === 'no partials') return false;
  return null;
}

export function imageCaption(image, partials = true) {
  const text = String(image.captionText ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 160);
  if (text && captionPartials(text) === null) return text;
  return partials ? 'Partials Accepted' : 'No Partials Accepted';
}

export function validHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? value : fallback;
}

export function validateImage(options = {}) {
  const image = {
    ...imageDefaults,
    ...options
  };
  image.layout = [ 'fixed', 'auto', 'device' ].includes(image.layout) ? image.layout : imageDefaults.layout;
  image.columns = Math.min(12, Math.max(1, Math.round(Number(image.columns) || 4)));
  image.width = Math.min(2400, Math.max(400, Math.round(Number(image.width) || 1e3)));
  image.quality = Math.min(3, Math.max(1, Number(image.quality) || 2));
  image.padding = Math.min(40, Math.max(0, Number(image.padding) || 0));
  image.gap = Math.min(16, Math.max(0, Number(image.gap) || 0));
  for (const key of [ 'background', 'border', 'text' ]) image[key] = validHex(image[key], imageDefaults[key]);
  image.captionText = String(image.captionText || '').replace(/\r\n?/g, '\n').trim().slice(0, 160);
  image.watermark = PERMANENT_WATERMARK;
  image.captionPosition = image.captionPosition === 'top' ? 'top' : 'bottom';
  for (const key of [ 'names', 'prices', 'quantities', 'totals', 'payment', 'caption', 'simplify' ]) image[key] = !!image[key];
  return image;
}

export function restoreImageSettings(options = {}) {
  return validateImage({
    ...options,
    layout: options.layout === 'device' ? 'auto' : options.layout || imageDefaults.layout,
    ...options.itemNamesVersion === 1 ? {} : {
      names: true
    },
    itemNamesVersion: 1
  });
}

export function itemPrice(item, settings = {}) {
  const text = settings.prices?.[item?.id] ?? settings.defaultPrice ?? '';
  if (!item || String(text).trim() === '') return {
    unpriced: true
  };
  try {
    const parsed = checkedPrice(text, item);
    return {
      mode: parsed.mode,
      price: parsed.value,
      ...parsed.ratio ? {
        ratio: parsed.ratio
      } : {}
    };
  } catch {
    return {
      unpriced: true
    };
  }
}

export function checkedPrice(value, item) {
  const price = parsePrice(value);
  if (price.mode !== 'coins' && item.maxPrice === null) throw new Error('Help uses a coin price.');
  return price;
}

export function readLegacyBackup(text, catalog) {
  let data = JSON.parse(text);
  if (typeof data === 'string') data = JSON.parse(data);
  if (!data?.VERSION_NUMBER || data.data?.profiles?.SPECIAL_TYPE !== 'Map' || !Array.isArray(data.data.profiles.data)) return null;
  const lists = [];
  for (const [name, profile] of data.data.profiles.data.slice(0, 50)) {
    const entries = profile.items?.SPECIAL_TYPE === 'Map' ? profile.items.data : null;
    if (!Array.isArray(entries)) throw new Error('Invalid original-site item map.');
    const items = [];
    for (const [key, wrapped] of entries) {
      const old = wrapped?.SPECIAL_TYPE === 'Item' ? wrapped.data : wrapped;
      if (!old || Number(old.quantity) === 0) continue;
      const item = resolveItem(old.name || key, catalog);
      if (!item) throw new Error(`Original backup contains an unknown item: ${old.name || key}`);
      const price = checkedPrice(old.priceOrMultiplier || '1x', item);
      items.push({
        id: item.id,
        quantity: parseQuantity(old.quantity),
        mode: price.mode,
        price: price.value,
        ...price.ratio ? {
          ratio: price.ratio
        } : {},
        priceInput: old.priceOrMultiplier
      });
    }
    const previous = profile.settings || {}, theme = previous.currentTheme || {};
    const image = validateImage({
      layout: previous.itemsPerRowMode === 'fixed' ? 'fixed' : 'auto',
      columns: previous.itemsPerRow || 4,
      quality: previous.imageQuality || 2,
      background: theme.backgroundColor || '#222222',
      border: theme.gridBorderColor || '#737373',
      text: theme.textInnerColorPrimary || '#ffffff',
      prices: !previous.hidePriceOrMultiplier,
      quantities: !previous.hideQuantity,
      caption: !!previous.bottomText,
      captionText: previous.bottomText || '',
      captionPosition: previous.showBottomTextAtTop ? 'top' : 'bottom'
    });
    lists.push({
      id: `imported-${lists.length}`,
      name: String(name).slice(0, 50),
      date: (new Date).toISOString(),
      draft: {
        name: String(name).slice(0, 50),
        mode: 'sell',
        partials: true,
        notes: '',
        items: items.length ? parseImport(JSON.stringify(items), catalog) : [],
        image: image
      },
      defaults: {
        defaultPrice: previous.defaultPriceOrMultiplier || '5x',
        defaultQuantity: previous.defaultQuantity || 1,
        calculationItem: resolveItem(previous.priceCalculationItemName || 'Diamond Ring', catalog)?.id || 'diamond-ring',
        textFormat: previous.textListFormat || editorDefaults.textFormat,
        textSeparator: previous.textListSeparatorMode === 'comma' ? 'comma' : previous.textListSeparatorMode === 'custom' ? 'custom' : 'newline',
        customSeparator: previous.textListCustomSeparator || ', '
      }
    });
  }
  if (!lists.length) throw new Error('Original backup contains no profiles.');
  return {
    lists: lists,
    active: lists.find((list => list.name === data.data.activeProfileName)) || lists[0]
  };
}

export function itemsAtLevel(catalog, level) {
  const limit = playerLevel(level);
  return catalog.filter((item => limit === null || item.level <= limit));
}

export function emptyArtwork(catalog, level, previous = [], random = Math.random) {
  const pool = itemsAtLevel(catalog, level).filter((item => !item.service && !item.bundle));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [ pool[j], pool[i] ];
  }
  let chosen = pool.slice(0, 3);
  if (chosen.length > 1 && chosen.every(((item, index) => item.id === previous[index]))) {
    if (pool.length > chosen.length) chosen[chosen.length - 1] = pool[chosen.length]; else chosen = [ ...chosen.slice(1), chosen[0] ];
  }
  return chosen;
}
