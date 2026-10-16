export const VERSION = 1;

export const MAX_QUANTITY = 999999;

export const MAX_PRICE = 1e9;

export const normalize = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const number = value => new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2
}).format(value);

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, (c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;'
}[c])));

export const storage = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(`hayday.${key}`)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`hayday.${key}`, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
};

export function parsePrice(value) {
  const text = String(value).trim().toLowerCase().replace(/,/g, '');
  const ratio = text.match(/^(\d{1,6})\s*:\s*(\d{1,6})$/);
  if (ratio) {
    if (Number(ratio[1]) < 1 || Number(ratio[2]) < 1) throw new Error('Both sides of a ratio must be positive.');
    return {
      mode: 'ratio',
      value: 0,
      ratio: `${Number(ratio[1])}:${Number(ratio[2])}`
    };
  }
  const multiplier = /(?:xmp|x)$/.test(text);
  const amount = arithmetic(multiplier ? text.replace(/(?:xmp|x)$/, '') : text);
  if (amount < 0 || amount > MAX_PRICE || !Number.isFinite(amount)) throw new Error('Price must be between 0 and 1 billion coins.');
  return {
    mode: multiplier ? 'multiplier' : 'coins',
    value: amount
  };
}

export function arithmetic(value) {
  const source = String(value).replace(/,/g, '').replace(/\s/g, '').toLowerCase();
  if (!source || source.length > 180) throw new Error('Enter a number, 3k, 5x, or arithmetic like 20*4.');
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)[km]?|[()+\-*/]/g) || [];
  if (tokens.join('') !== source || tokens.length > 100) throw new Error('Use numbers and +, −, *, /, or parentheses.');
  let index = 0;
  function atom(depth = 0) {
    if (depth > 24) throw new Error('Expression is too complex.');
    const token = tokens[index++];
    if (token === '+' || token === '-') return (token === '-' ? -1 : 1) * atom(depth + 1);
    if (token === '(') {
      const result = sum(depth + 1);
      if (tokens[index++] !== ')') throw new Error('Close the expression parentheses.');
      return result;
    }
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)[km]?$/.test(token)) throw new Error('The expression is incomplete.');
    return Number(token.replace(/[km]$/, '')) * (token.endsWith('k') ? 1e3 : token.endsWith('m') ? 1e6 : 1);
  }
  function product(depth) {
    let result = atom(depth);
    while ([ '*', '/' ].includes(tokens[index])) {
      const operator = tokens[index++], next = atom(depth);
      if (operator === '/' && next === 0) throw new Error('Cannot divide by zero.');
      result = operator === '*' ? result * next : result / next;
    }
    return result;
  }
  function sum(depth = 0) {
    let result = product(depth);
    while ([ '+', '-' ].includes(tokens[index])) {
      const operator = tokens[index++], next = product(depth);
      result = operator === '+' ? result + next : result - next;
    }
    return result;
  }
  const result = sum();
  if (index !== tokens.length || !Number.isFinite(result)) throw new Error('Invalid number expression.');
  return result;
}

export function parseQuantity(value) {
  const result = arithmetic(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_QUANTITY) throw new Error('Quantity must be a whole number from 1 to 999,999.');
  return result;
}

export function unitPrice(row, item) {
  if (row.mode === 'ratio' || row.price === undefined || row.unpriced) return 0;
  return Math.round((row.mode === 'multiplier' ? Number(item.maxPrice) * row.price : row.price) * 100) / 100;
}

export function totals(rows, byId) {
  return rows.reduce(((total, row) => {
    total.units += row.quantity;
    total.coins += Math.round(unitPrice(row, byId.get(row.id)) * row.quantity * 100) / 100;
    return total;
  }), {
    units: 0,
    coins: 0
  });
}

export function resolveItem(value, catalog) {
  const query = normalize(value);
  const aliases = {
    ducktape: 'duct tape',
    tape: 'duct tape',
    tapes: 'duct tape',
    bolts: 'bolt',
    planks: 'plank',
    nails: 'nail',
    screws: 'screw',
    mallets: 'mallet',
    markers: 'marker stake',
    deeds: 'land deed',
    blankets: 'blanket',
    mussels: 'mussel meat'
  };
  const key = aliases[query] || query;
  return catalog.find((item => normalize(item.id) === key || normalize(item.name) === key));
}

function validateRow(row, catalog) {
  const item = resolveItem(row.id ?? row.name ?? row.item, catalog);
  if (!item) throw new Error(`Unknown item: ${row.id ?? row.name ?? row.item ?? '(missing name)'}`);
  const quantity = Number(row.quantity ?? row.qty);
  const minimum = item.minQuantity || 1, maximum = item.maxQuantity || MAX_QUANTITY;
  if (!Number.isSafeInteger(quantity) || quantity < minimum || quantity > maximum) throw new Error(`${item.name}: quantity must be a whole number from ${minimum} to ${number(maximum)}.`);
  const result = {
    id: item.id,
    quantity: quantity
  };
  if (row.price !== undefined && row.price !== null) {
    const price = typeof row.price === 'string' ? parsePrice(row.price) : {
      mode: row.mode ?? 'coins',
      value: Number(row.price),
      ratio: row.ratio
    };
    if (![ 'coins', 'multiplier', 'ratio' ].includes(price.mode) || !Number.isFinite(price.value) || price.value < 0 || price.value > MAX_PRICE) throw new Error(`${item.name}: invalid price.`);
    if (price.mode !== 'coins' && item.maxPrice === null) throw new Error(`${item.name}: enter a coin price; this item has no shop maximum.`);
    if (price.mode === 'ratio') {
      const checked = parsePrice(price.ratio);
      if (checked.mode !== 'ratio') throw new Error('Invalid trade ratio.');
      result.ratio = checked.ratio;
      price.value = 0;
    }
    result.price = price.value;
    result.mode = price.mode;
  }
  if (row.unpriced === true && result.price === undefined) result.unpriced = true;
  return result;
}

export function parseImport(text, catalog) {
  let input = String(text).trim();
  if (!input || input.length > 5e5) throw new Error('Paste an item list (up to 500 KB).');
  input = input.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
  input = input.replace(/^HDTRADE1\s*\n?/, '').trim();
  let rows;
  if (/^[\[{]/.test(input)) {
    let data;
    try {
      data = JSON.parse(input);
    } catch {
      throw new Error('The JSON is incomplete. Copy the full list from HayDex Scanner.');
    }
    if (!Array.isArray(data) && data.version !== undefined && data.version !== VERSION) throw new Error('Unsupported import version.');
    rows = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(rows)) throw new Error('JSON must contain an items array.');
  } else {
    rows = input.split(/\n+/).filter((line => line.trim() && !line.trim().startsWith('#'))).map(((line, index) => {
      const [left, price, extra] = line.split('@');
      if (extra !== undefined) throw new Error(`Line ${index + 1}: use one @ before the price.`);
      let match = left.trim().match(/^(\d+)\s*(?:x\s+|[,;]\s*)?(.+)$/i);
      if (!match) {
        const reverse = left.trim().match(/^(.+?)\s*[,;]\s*(\d+)$/);
        if (reverse) match = [ reverse[0], reverse[2], reverse[1] ];
      }
      if (!match) throw new Error(`Line ${index + 1}: use “20 Beeswax @ 3k”.`);
      return {
        quantity: match[1],
        name: match[2].trim(),
        ...price !== undefined ? {
          price: price.trim()
        } : {}
      };
    }));
  }
  if (!rows.length || rows.length > 2e3) throw new Error('List must contain 1 to 2,000 item rows.');
  const unique = new Map;
  for (const raw of rows) {
    const row = validateRow(raw, catalog);
    const previous = unique.get(row.id);
    if (previous) {
      if (previous.unpriced !== row.unpriced || (previous.price !== undefined || row.price !== undefined) && (previous.price !== row.price || previous.mode !== row.mode || previous.ratio !== row.ratio)) throw new Error(`${resolveItem(row.id, catalog).name} has conflicting prices. Combine it into one row.`);
      row.quantity += previous.quantity;
      if (row.quantity > (resolveItem(row.id, catalog).maxQuantity || MAX_QUANTITY)) throw new Error('Combined quantity is too large.');
    }
    unique.set(row.id, row);
  }
  return [ ...unique.values() ];
}

export function serializeItems(items) {
  return 'HDTRADE1\n' + JSON.stringify({
    version: VERSION,
    items: items.map((row => ({
      id: row.id,
      quantity: row.quantity,
      ...row.unpriced ? {
        unpriced: true
      } : {},
      ...row.price !== undefined ? {
        price: row.price,
        mode: row.mode,
        ...row.ratio ? {
          ratio: row.ratio
        } : {}
      } : {}
    })))
  }, null, 2);
}

export function deduplicateScans(rows) {
  const result = new Map;
  for (const row of rows) {
    if (!row.id || !Number.isSafeInteger(row.quantity) || row.quantity < 1) continue;
    const previous = result.get(row.id);
    if (!previous || row.quantity > previous.quantity) result.set(row.id, {
      ...row,
      duplicate: !!previous
    }); else previous.duplicate = true;
  }
  return [ ...result.values() ];
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {}
  const field = document.createElement('textarea');
  field.value = text;
  field.style.position = 'fixed';
  field.style.top = '-1000px';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Clipboard access is unavailable. Use the download button.');
}

export function downloadFile(name, content, type = 'application/json') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([ content ], {
    type: type
  }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout((() => URL.revokeObjectURL(url)), 1e3);
}
