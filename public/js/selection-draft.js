import { parseQuantity } from './core.js';

import { checkedPrice, materialCounts } from './editor-core.js';

export function selectionRows(rows, selected, edits) {
  return rows.map((row => selected.has(row.id) && edits.has(row.id) ? {
    ...edits.get(row.id)
  } : {
    ...row
  }));
}

export function selectionEdit(original, current, patch, item) {
  const next = {
    ...current
  };
  if (Object.hasOwn(patch, 'quantity')) {
    const quantity = parseQuantity(patch.quantity);
    if (quantity > original.quantity) throw new Error(`Use up to ${original.quantity} ${item.name}.`);
    if (item.bundle) materialCounts(quantity);
    next.quantity = quantity;
  }
  if (Object.hasOwn(patch, 'priceInput')) {
    const text = String(patch.priceInput).trim();
    delete next.mode;
    delete next.price;
    delete next.ratio;
    delete next.priceInput;
    delete next.unpriced;
    if (text) {
      const price = checkedPrice(text, item);
      Object.assign(next, {
        mode: price.mode,
        price: price.value,
        priceInput: text
      });
      if (price.ratio) next.ratio = price.ratio;
    } else next.unpriced = true;
  }
  return next;
}

export function pruneSelectionEdits(edits, selected) {
  for (const id of edits.keys()) if (!selected.has(id)) edits.delete(id);
}

export function commitSelectionPrices(rows, selected, edits) {
  const keys = [ 'mode', 'price', 'ratio', 'priceInput', 'unpriced' ];
  let count = 0;
  const next = rows.map((row => {
    const edited = selected.has(row.id) ? edits.get(row.id) : null;
    if (!edited || keys.every((key => row[key] === edited[key]))) return {
      ...row
    };
    const saved = {
      ...row
    };
    for (const key of keys) {
      delete saved[key];
      if (Object.hasOwn(edited, key)) saved[key] = edited[key];
    }
    count++;
    return saved;
  }));
  return {
    rows: next,
    count: count
  };
}
