import './images.js';

import { storage, number, escapeHTML as e, parseImport, parseQuantity, unitPrice, totals, serializeItems, copyText, downloadFile, resolveItem } from './core.js';

import { icon } from './icons.js';

import { SITE_NAME, PERMANENT_WATERMARK } from './branding.js';

import { aboutContent } from './about.js';

import { selectionRows, selectionEdit, pruneSelectionEdits, commitSelectionPrices } from './selection-draft.js';

import { readPreferences, writePreferences, setGlobalLevel, onPreferencesChange } from './preferences.js';

import { imageDefaults, editorDefaults, editorColumns, imageGrid, itemsAtLevel, serviceItems, materialSetItems, materialCounts, materialGroups, colorPresets, playerLevel, sortRows, selectedRows, paymentItems, priceLabel, paymentSummary, tradeOverview, listText, validateImage, restoreImageSettings, itemPrice, checkedPrice, readLegacyBackup } from './editor-core.js';

import { renderTradePage, exportPlan, pngBlob } from './trade-renderer.js';

import { makeZip } from '../scanner/zip.js';

const $ = id => document.getElementById(id);

const defaults = {
  ...editorDefaults,
  defaultPrice: '',
  priceDefaultsVersion: 1,
  prices: {},
  favorites: [],
  farm: '',
  tag: '',
  discord: ''
};

let settings = {
  ...defaults,
  ...storage.get('settings', {})
};

let draft = {
  items: [],
  name: 'My trade',
  mode: 'sell',
  partials: true,
  notes: '',
  ...storage.get('draft', {})
};

draft.image = restoreImageSettings(draft.image || {
  ...imageDefaults,
  columns: Number(draft.cardColumns) || 4
});

let catalog = [], byId = new Map, selection = new Set, selecting = false, columns = 4;

let refreshLevelView = null;

let undoStack = [], redoStack = [], toastTimer, dragId = null, touchDrag = null, pickerCategory = 'All', pickerLimit = 50, scannerActive = false;

let selectionEdits = new Map, selectionUndo = [], selectionRedo = [], savedStatus = 'Saved';

const displayRows = () => selectionRows(draft.items, selection, selectionEdits);

const scope = () => selectedRows(displayRows(), selection);

function setSelection(next) {
  selection = next;
  pruneSelectionEdits(selectionEdits, selection);
  selectionUndo = [];
  selectionRedo = [];
  render(false);
}

function editSelection(patches) {
  const next = new Map(selectionEdits);
  for (const [id, patch] of patches) {
    const original = draft.items.find((row => row.id === id));
    if (!original || !selection.has(id)) continue;
    next.set(id, selectionEdit(original, next.get(id) || original, patch, byId.get(id)));
  }
  selectionUndo.push(structuredClone(selectionEdits));
  if (selectionUndo.length > 40) selectionUndo.shift();
  selectionRedo = [];
  selectionEdits = next;
  render(false);
}

function toast(message, undo = false) {
  $('toast-message').textContent = message;
  $('toast-undo').hidden = !undo;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout((() => $('toast').classList.remove('show')), undo ? 6e3 : 4e3);
}

function save() {
  const a = storage.set('draft', draft), b = writePreferences(settings);
  savedStatus = a && b ? 'Saved' : 'Storage full · export a backup';
  $('save-status').textContent = selectionEdits.size ? 'Temporary' : savedStatus;
  $('save-status').dataset.temporary = String(selectionEdits.size > 0);
}

function modal(title, html, {wide: wide = false, back: back = false} = {}) {
  refreshLevelView = null;
  const host = $('modal-content');
  host.onclick = null;
  host.onchange = null;
  host.innerHTML = html;
  $('modal-title').textContent = title;
  $('modal').classList.toggle('wide', wide);
  $('modal-back').hidden = !back;
  if (!$('modal').open) $('modal').showModal();
  $('modal').scrollTop = 0;
}

function closeModal() {
  $('modal').close();
}

$('close-modal').onclick = closeModal;

$('modal-back').onclick = () => settingsPanel();

$('modal').addEventListener('click', (event => {
  if (event.target !== $('modal')) return;
  const r = $('modal').getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeModal();
}));

function remember() {
  undoStack.push(structuredClone(draft));
  if (undoStack.length > 40) undoStack.shift();
  redoStack = [];
}

function applySort() {
  draft.items = sortRows(draft.items, byId, settings.sortOrder);
}

function change(fn) {
  remember();
  fn();
  applySort();
  save();
  render();
}

function defaultPrice(item) {
  return itemPrice(item, settings);
}

function pricedRow(row) {
  if (row.unpriced) return {
    id: row.id,
    quantity: row.quantity,
    unpriced: true
  };
  const next = {
    ...defaultPrice(byId.get(row.id)),
    ...row
  };
  if (next.price !== undefined) delete next.unpriced;
  if (next.mode !== 'ratio') delete next.ratio;
  return next;
}

function quantityFor(item, value) {
  const quantity = parseQuantity(value);
  if (item.bundle) materialCounts(quantity);
  return quantity;
}

function add(id, quantity = settings.defaultQuantity) {
  const item = byId.get(id);
  if (!item) return;
  quantity = quantityFor(item, quantity);
  const old = draft.items.find((row => row.id === id)), combined = (old?.quantity || 0) + quantity;
  quantityFor(item, combined);
  const price = defaultPrice(item);
  change((() => {
    if (old) old.quantity = combined; else draft.items.push({
      id: id,
      quantity: quantity,
      ...price
    });
  }));
}

function remove(ids) {
  const count = draft.items.filter((row => ids.has(row.id))).length;
  if (!count) return;
  change((() => draft.items = draft.items.filter((row => !ids.has(row.id)))));
  toast(`${count === 1 ? 'Item' : count + ' items'} removed`, true);
}

function undo() {
  if (selection.size) {
    if (!selectionUndo.length) return;
    selectionRedo.push(structuredClone(selectionEdits));
    selectionEdits = selectionUndo.pop();
    render(false);
    return;
  }
  if (!undoStack.length) return;
  redoStack.push(structuredClone(draft));
  draft = undoStack.pop();
  save();
  render();
}

function redo() {
  if (selection.size) {
    if (!selectionRedo.length) return;
    selectionUndo.push(structuredClone(selectionEdits));
    selectionEdits = selectionRedo.pop();
    render(false);
    return;
  }
  if (!redoStack.length) return;
  undoStack.push(structuredClone(draft));
  draft = redoStack.pop();
  save();
  render();
}

$('undo-button').onclick = undo;

$('redo-button').onclick = redo;

$('toast-undo').onclick = () => {
  undo();
  $('toast').classList.remove('show');
};

function details() {
  return {
    partials: draft.partials,
    farm: settings.farm,
    tag: settings.tag,
    discord: settings.discord,
    notes: draft.notes
  };
}

function stageColumns(count = draft.items.length) {
  return editorColumns(count, draft.image, $('image-region').clientWidth || $('main').clientWidth, innerWidth <= 680);
}

function render(rebuild = true) {
  selection = new Set([ ...selection ].filter((id => draft.items.some((row => row.id === id)))));
  pruneSelectionEdits(selectionEdits, selection);
  if (!selection.size) {
    selectionUndo = [];
    selectionRedo = [];
  }
  const image = draft.image, region = $('image-region');
  region.hidden = !draft.items.length;
  $('stage-empty').hidden = !!draft.items.length;
  columns = stageColumns();
  const grid = imageGrid(draft.items.length, image, region.clientWidth, columns);
  region.style.setProperty('--columns', grid.columns);
  region.style.setProperty('--tile-size', Math.max(35, grid.cell) + 'px');
  region.style.setProperty('--grid-width', grid.gridWidth + 'px');
  for (const key of [ 'padding', 'gap' ]) region.style.setProperty('--image-' + key, image[key] + 'px');
  for (const key of [ 'background', 'border', 'text' ]) region.style.setProperty('--image-' + key, image[key]);
  $('current-list-name').textContent = draft.name || 'My trade';
  $('board-count').textContent = draft.items.length;
  $('header-level').textContent = settings.level ? 'Lv. ' + settings.level : 'Level';
  $('sort-label').textContent = {
    quantity: 'Quantity',
    price: 'Price',
    total: 'Value',
    name: 'Name',
    manual: 'Manual'
  }[settings.sortOrder];
  document.body.classList.toggle('selecting', selecting);
  document.body.classList.toggle('has-selection', selection.size > 0);
  $('select-mode').setAttribute('aria-pressed', String(selecting));
  $('selection-tools').hidden = !selecting && !selection.size;
  $('selection-count').textContent = `${selection.size} selected`;
  $('save-selected').disabled = !commitSelectionPrices(draft.items, selection, selectionEdits).count;
  $('undo-button').disabled = !(selection.size ? selectionUndo.length : undoStack.length);
  $('redo-button').disabled = !(selection.size ? selectionRedo.length : redoStack.length);
  $('save-status').textContent = selectionEdits.size ? 'Temporary' : savedStatus;
  $('save-status').dataset.temporary = String(selectionEdits.size > 0);
  document.querySelectorAll('[data-mode]').forEach((button => {
    const active = button.dataset.mode === draft.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }));
  if (rebuild) $('trade-grid').innerHTML = displayRows().map((row => {
    const item = byId.get(row.id), label = priceLabel(row, image.simplify), name = image.names;
    return `<article class="trade-tile ${name ? 'has-name' : ''} ${item.bundle ? 'bundle-tile' : ''} ${selection.has(row.id) ? 'selected' : ''}" data-id="${row.id}" draggable="true" aria-label="${e(item.name)}"><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" class="tile-image" src="${e(item.image)}" alt="${e(item.name)}" loading="lazy"><div class="tile-price-group" ${image.prices ? '' : 'hidden'}><input class="tile-price" value="${e(label)}" aria-label="${e(item.name)} price" spellcheck="false" style="--price-width:${Math.min(9, Math.max(2, label.length))}ch">${row.mode === 'coins' ? '<img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" class="tile-coin" src="assets/services/coin.png" alt="coins">' : ''}</div><div class="tile-footer">${name ? `<span class="tile-name" title="${e(item.name)}">${e(item.name)}</span>` : ''}<input class="tile-quantity" inputmode="numeric" value="${row.quantity}" aria-label="${e(item.name)} quantity" ${image.quantities ? '' : 'hidden'}></div><button class="tile-remove" data-remove="${row.id}" aria-label="Remove ${e(item.name)}">${icon('close')}</button><button class="tile-grip" data-grip="${row.id}" aria-label="Drag ${e(item.name)} to move or delete" title="Drag to move or delete">${icon('grip')}</button><button class="tile-select" data-select="${row.id}" aria-label="Select ${e(item.name)}" aria-pressed="${selection.has(row.id)}">${selection.has(row.id) ? icon('check') : icon('plus')}</button></article>`;
  })).join('');
  for (const tile of $('trade-grid').children) {
    const original = draft.items.find((row => row.id === tile.dataset.id));
    if (!original) continue;
    const row = selection.has(original.id) && selectionEdits.has(original.id) ? selectionEdits.get(original.id) : original;
    const price = tile.querySelector('.tile-price'), quantity = tile.querySelector('.tile-quantity'), label = priceLabel(row, image.simplify), group = tile.querySelector('.tile-price-group');
    if (document.activeElement !== price) price.value = label;
    if (document.activeElement !== quantity) quantity.value = row.quantity;
    quantity.style.setProperty('--quantity-width', (String(row.quantity).length + .25) + 'ch');
    price.style.setProperty('--price-width', Math.min(9, Math.max(2, label.length)) + 'ch');
    const coin = group.querySelector('.tile-coin');
    if (row.mode === 'coins' && !coin) {
      const img = document.createElement('img');
      img.className = 'tile-coin';
      img.src = 'assets/services/coin.png';
      img.alt = 'coins';
      group.append(img);
    } else if (row.mode !== 'coins' && coin) coin.remove();
    tile.classList.toggle('selected', selection.has(row.id));
    const button = tile.querySelector('[data-select]');
    const pressed = String(selection.has(row.id));
    if (button.getAttribute('aria-pressed') !== pressed) {
      button.setAttribute('aria-pressed', pressed);
      button.innerHTML = selection.has(row.id) ? icon('check') : icon('plus');
    }
  }
  const caption = image.captionText || (draft.partials ? 'Partials Accepted' : 'No Partials');
  for (const position of [ 'top', 'bottom' ]) {
    const input = $('caption-' + position);
    input.hidden = !image.caption || image.captionPosition !== position;
    if (document.activeElement !== input) input.value = caption;
  }
  const contact = [ settings.farm, settings.tag, settings.discord ].filter(Boolean).join(' · ');
  $('image-contact').hidden = !contact;
  $('image-contact').textContent = contact;
  $('image-notes').hidden = !draft.notes;
  $('image-notes').textContent = draft.notes;
  const summary = tradeOverview(scope(), byId, settings.calculationItem);
  updateTradeStatus(summary);
  $('image-footer').hidden = false;
  $('image-totals').hidden = !image.totals;
  $('image-totals').innerHTML = `${selection.size ? `<span class="scope-label">${selection.size} selected</span>` : ''}<strong>${number(summary.coins)}</strong><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="assets/services/coin.png" alt="coins">${image.payment && summary.equivalent !== null ? `<strong>${number(summary.equivalent)}</strong><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="${e(summary.item.image)}" alt="${e(summary.item.name)} equivalent">` : ''}<small>${number(summary.units)} items</small>`;
  $('image-totals').setAttribute('aria-label', `${number(summary.coins)} coins · ${number(summary.units)} items. Choose payment item.`);
  $('image-watermark').textContent = PERMANENT_WATERMARK;
  $('image-watermark').hidden = false;
}

function updateTradeStatus(summary) {
  $('summary-partials').checked = draft.partials;
  const notices = [];
  if (summary.unpriced) notices.push(`${summary.unpriced} unpriced`);
  if (summary.ratios) notices.push('Ratios excluded from coin total');
  $('trade-notice').hidden = !notices.length;
  $('trade-notice').textContent = notices.join(' · ');
}

$('image-totals').onclick = () => paymentPicker();

$('summary-partials').onchange = event => change((() => draft.partials = event.target.checked));

document.addEventListener('focusin', (event => {
  if (event.target.matches('[data-price-id],#default-price,#edit-price')) event.target.select();
}));

document.addEventListener('click', (event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'trade-home') {
    if (scannerActive) closeScanner();
    return;
  }
  if (action === 'payment-picker') {
    paymentPicker();
    return;
  }
  if (action === 'save-list') {
    saveNamed();
    return;
  }
  const target = $(action);
  if (target && !target.disabled) target.click();
}));

for (const position of [ 'top', 'bottom' ]) $('caption-' + position).onchange = event => change((() => draft.image.captionText = event.target.value.trim().slice(0, 160)));

for (const id of [ 'caption-top', 'caption-bottom' ]) $(id).onkeydown = event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.target.blur();
  }
};

$('image-contact').onclick = () => settingsPanel('Farm');

$('image-notes').onclick = () => editCaption(true);

$('trade-grid').addEventListener('focusin', (event => {
  if (event.target.matches('input')) {
    event.target.closest('.trade-tile').draggable = false;
    event.target.select();
  }
}));

$('trade-grid').addEventListener('input', (event => {
  const tile = event.target.closest('[data-id]');
  if (tile && selection.has(tile.dataset.id) && event.target.classList.contains('tile-price')) $('save-selected').disabled = false;
}));

$('trade-grid').addEventListener('focusout', (event => {
  if (event.target.matches('input')) {
    const tile = event.target.closest('.trade-tile');
    if (tile) tile.draggable = true;
  }
}));

$('trade-grid').onkeydown = event => {
  if (event.target.matches('input') && event.key === 'Enter') {
    event.preventDefault();
    event.target.blur();
  }
};

$('trade-grid').onchange = event => {
  const tile = event.target.closest('[data-id]');
  if (!tile) return;
  const row = draft.items.find((row => row.id === tile.dataset.id)), item = byId.get(row.id);
  try {
    if (selection.has(row.id)) {
      const patch = event.target.classList.contains('tile-price') ? {
        priceInput: event.target.value
      } : {
        quantity: event.target.value
      };
      editSelection([ [ row.id, patch ] ]);
      return;
    }
    if (event.target.classList.contains('tile-price')) {
      const next = selectionEdit(row, row, {
        priceInput: event.target.value
      }, item);
      change((() => {
        for (const key of [ 'mode', 'price', 'priceInput', 'ratio', 'unpriced' ]) delete row[key];
        Object.assign(row, next);
      }));
    } else if (event.target.classList.contains('tile-quantity')) {
      const quantity = quantityFor(item, event.target.value);
      change((() => row.quantity = quantity));
    }
  } catch (error) {
    toast(error.message);
    const current = selection.has(row.id) && selectionEdits.has(row.id) ? selectionEdits.get(row.id) : row;
    event.target.value = event.target.classList.contains('tile-price') ? priceLabel(current, draft.image.simplify) : current.quantity;
    render(false);
  }
};

$('trade-grid').onclick = event => {
  const tile = event.target.closest('[data-id]');
  if (!tile) return;
  const removeButton = event.target.closest('[data-remove]');
  if (removeButton) {
    remove(new Set([ tile.dataset.id ]));
    return;
  }
  if (event.target.closest('[data-grip]') || event.target.matches('input')) return;
  if (event.target.closest('[data-select]') || selecting || event.ctrlKey || event.metaKey) {
    const next = new Set(selection);
    next.has(tile.dataset.id) ? next.delete(tile.dataset.id) : next.add(tile.dataset.id);
    setSelection(next);
    return;
  }
  if (!event.target.matches('input')) editItem(tile.dataset.id);
};

$('select-mode').onclick = () => {
  selecting = !selecting;
  if (!selecting) setSelection(new Set); else render(false);
};

$('select-all').onclick = () => setSelection(new Set(draft.items.map((row => row.id))));

$('clear-selection').onclick = () => {
  selecting = false;
  setSelection(new Set);
};

$('delete-selected').onclick = () => remove(selection);

$('save-selected').onclick = () => {
  const result = commitSelectionPrices(draft.items, selection, selectionEdits);
  if (!result.count) return;
  remember();
  draft.items = result.rows;
  applySort();
  for (const [id, edited] of selectionEdits) {
    const original = draft.items.find((row => row.id === id));
    if (original && edited.quantity !== original.quantity) selectionEdits.set(id, {
      ...original,
      quantity: edited.quantity
    }); else selectionEdits.delete(id);
  }
  selectionUndo = [];
  selectionRedo = [];
  save();
  render();
  toast(result.count === 1 ? 'Price saved' : 'Prices saved');
};

function moveItem(id, target) {
  const from = draft.items.findIndex((row => row.id === id)), to = draft.items.findIndex((row => row.id === target));
  if (from < 0 || to < 0 || from === to) return;
  settings.sortOrder = 'manual';
  change((() => {
    const [row] = draft.items.splice(from, 1);
    draft.items.splice(to, 0, row);
  }));
}

function beginDrag(id) {
  dragId = id;
  document.body.classList.add('drag-active');
  $('delete-zone').hidden = false;
  document.querySelector(`[data-id="${id}"]`)?.classList.add('dragging');
}

function endDrag() {
  dragId = null;
  document.body.classList.remove('drag-active');
  $('delete-zone').hidden = true;
  $('delete-zone').classList.remove('over');
  document.querySelectorAll('.dragging,.drag-target').forEach((x => x.classList.remove('dragging', 'drag-target')));
}

$('trade-grid').ondragstart = event => {
  const tile = event.target.closest('[data-id]');
  if (!tile || event.target.matches('input') || selecting) return event.preventDefault();
  event.dataTransfer.setData('text/plain', tile.dataset.id);
  event.dataTransfer.effectAllowed = 'move';
  beginDrag(tile.dataset.id);
};

$('trade-grid').ondragover = event => {
  const tile = event.target.closest('[data-id]');
  if (!tile || tile.dataset.id === dragId) return;
  event.preventDefault();
  document.querySelectorAll('.drag-target').forEach((x => x.classList.remove('drag-target')));
  tile.classList.add('drag-target');
};

$('trade-grid').ondrop = event => {
  event.preventDefault();
  const tile = event.target.closest('[data-id]');
  if (tile && dragId) moveItem(dragId, tile.dataset.id);
  endDrag();
};

$('trade-grid').ondragend = endDrag;

$('delete-zone').ondragover = event => {
  event.preventDefault();
  $('delete-zone').classList.add('over');
};

$('delete-zone').ondragleave = () => $('delete-zone').classList.remove('over');

$('delete-zone').ondrop = event => {
  event.preventDefault();
  if (dragId) remove(new Set([ dragId ]));
  endDrag();
};

$('trade-grid').addEventListener('pointerdown', (event => {
  const handle = event.target.closest('[data-grip]');
  if (!handle || event.pointerType === 'mouse' || selecting) return;
  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  touchDrag = {
    id: handle.dataset.grip,
    handle: handle,
    pointer: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    target: null,
    active: false
  };
}));

$('trade-grid').addEventListener('pointermove', (event => {
  if (!touchDrag || event.pointerId !== touchDrag.pointer) return;
  event.preventDefault();
  if (!touchDrag.active && Math.hypot(event.clientX - touchDrag.x, event.clientY - touchDrag.y) > 6) {
    touchDrag.active = true;
    beginDrag(touchDrag.id);
    const ghost = new Image;
    ghost.crossOrigin = 'anonymous';
    ghost.referrerPolicy = 'no-referrer';
    ghost.src = byId.get(touchDrag.id).image;
    ghost.className = 'drag-ghost';
    document.body.append(ghost);
    touchDrag.ghost = ghost;
  }
  if (!touchDrag.active) return;
  touchDrag.ghost.style.left = event.clientX - 47 + 'px';
  touchDrag.ghost.style.top = event.clientY - 47 + 'px';
  const rect = $('delete-zone').getBoundingClientRect();
  touchDrag.deleting = event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientX >= rect.left && event.clientX <= rect.right;
  $('delete-zone').classList.toggle('over', touchDrag.deleting);
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.trade-tile');
  touchDrag.target = target?.dataset.id;
  document.querySelectorAll('.drag-target').forEach((x => x.classList.remove('drag-target')));
  if (target && target.dataset.id !== touchDrag.id) target.classList.add('drag-target');
  if (!touchDrag.deleting && event.clientY < 95) window.scrollBy(0, -12);
  if (!touchDrag.deleting && event.clientY > innerHeight - 130) window.scrollBy(0, 12);
}));

function finishPointer(event) {
  if (!touchDrag || event.pointerId !== touchDrag.pointer) return;
  const state = touchDrag;
  touchDrag = null;
  state.ghost?.remove();
  if (event.type !== 'pointercancel' && state.active) {
    if (state.deleting) remove(new Set([ state.id ])); else if (state.target) moveItem(state.id, state.target);
  } else if (event.type !== 'pointercancel' && !state.active) editItem(state.id);
  endDrag();
}

$('trade-grid').addEventListener('pointerup', finishPointer);

$('trade-grid').addEventListener('pointercancel', finishPointer);

function bulk(field) {
  if (!selection.size) return toast('Select items first.');
  modal(field === 'price' ? 'Set price' : 'Set quantity', `<p class="helper">${selection.size} selected items</p><label class="field-label">${field === 'price' ? 'Price each' : 'Quantity'}<input id="bulk-input" value="${field === 'price' ? priceLabel(scope()[0]) || '0' : scope()[0].quantity}" ${field === 'quantity' ? 'inputmode="numeric"' : ''}></label><p class="editor-error" id="bulk-error"></p><div class="dialog-actions"><button class="button primary" id="apply-bulk">Apply</button></div>`);
  $('apply-bulk').onclick = () => {
    try {
      const text = $('bulk-input').value;
      editSelection([ ...selection ].map((id => [ id, field === 'price' ? {
        priceInput: text
      } : {
        quantity: text
      } ])));
      closeModal();
    } catch (error) {
      $('bulk-error').textContent = error.message;
    }
  };
}

$('bulk-price').onclick = () => bulk('price');

$('bulk-quantity').onclick = () => bulk('quantity');

function editItem(id) {
  const original = draft.items.find((row => row.id === id)), row = selection.has(id) && selectionEdits.has(id) ? selectionEdits.get(id) : original, item = byId.get(id);
  modal(item.name, `<div class="edit-item-heading"><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="${e(item.image)}" alt=""><div><p>${item.bundle ? materialCounts(row.quantity).join(' + ') + ' materials' : item.service ? 'Service' : `Level ${item.level}`}</p><p>${item.bundle ? 'Price per set' : item.maxPrice === null ? 'Coin price' : `Shop max ${number(item.maxPrice)} coins`}</p></div></div><div class="form-grid"><label class="field-label">Quantity<input id="edit-quantity" value="${row.quantity}" inputmode="numeric"></label><label class="field-label">Price each<input id="edit-price" value="${e(row.priceInput || priceLabel(row))}" placeholder="3k or 5x"></label></div><label class="toggle-label"><input id="remember-price" type="checkbox">Remember this price</label><label class="toggle-label"><input id="favorite-item" type="checkbox" ${settings.favorites.includes(id) ? 'checked' : ''}>Favorite</label><p class="editor-error" id="edit-error"></p><div class="move-actions"><button class="button quiet" id="move-earlier">Move left</button><button class="button quiet" id="move-later">Move right</button><button class="button quiet danger-text" id="remove-item">Delete</button></div><div class="dialog-actions"><button class="button primary" id="save-item">Done</button></div>`);
  $('save-item').onclick = () => {
    try {
      if (selection.has(id)) {
        editSelection([ [ id, {
          quantity: $('edit-quantity').value,
          priceInput: $('edit-price').value
        } ] ]);
        closeModal();
        return;
      }
      const quantity = quantityFor(item, $('edit-quantity').value), text = $('edit-price').value, price = text.trim() ? checkedPrice(text, item) : null;
      if ($('remember-price').checked) {
        if (price) settings.prices[id] = text; else delete settings.prices[id];
      }
      settings.favorites = settings.favorites.filter((x => x !== id));
      if ($('favorite-item').checked) settings.favorites.push(id);
      change((() => {
        row.quantity = quantity;
        if (price) {
          row.price = price.value;
          row.mode = price.mode;
          row.priceInput = text;
          delete row.unpriced;
          if (price.ratio) row.ratio = price.ratio; else delete row.ratio;
        } else {
          delete row.price;
          delete row.mode;
          delete row.priceInput;
          delete row.ratio;
          row.unpriced = true;
        }
      }));
      closeModal();
    } catch (error) {
      $('edit-error').textContent = error.message;
    }
  };
  if (selection.has(id)) {
    for (const input of [ $('remember-price'), $('favorite-item') ]) input.closest('label').hidden = true;
    document.querySelector('.move-actions').hidden = true;
  }
  for (const [button, direction] of [ [ 'move-earlier', -1 ], [ 'move-later', 1 ] ]) $(button).onclick = () => {
    const index = draft.items.findIndex((row => row.id === id)), target = draft.items[index + direction];
    if (target) moveItem(id, target.id);
  };
  $('remove-item').onclick = () => {
    remove(new Set([ id ]));
    closeModal();
  };
}

function setLevel(value) {
  setGlobalLevel(value);
}

function bindLevel(input) {
  input.onchange = event => {
    try {
      setLevel(event.target.value);
    } catch (error) {
      toast(error.message);
      event.target.value = settings.level ?? '';
    }
  };
}

function syncLevelInputs() {
  for (const input of document.querySelectorAll('[data-global-level]')) if (document.activeElement !== input) input.value = settings.level ?? '';
}

onPreferencesChange((value => {
  if (!catalog.length) return;
  try {
    settings = checkedSettings(value);
  } catch {
    return;
  }
  syncLevelInputs();
  render(false);
  if (refreshLevelView) refreshLevelView();
}));

function picker() {
  pickerCategory = 'All';
  pickerLimit = 50;
  modal('Add items', `<div class="picker-head"><div class="search-wrap">${icon('search')}<input id="picker-search" type="search" placeholder="Find an item" aria-label="Find an item"></div><label class="picker-level">Level<input id="picker-level" data-global-level type="number" min="1" max="999" value="${settings.level ?? ''}" placeholder="All" aria-label="Your Hay Day level"></label></div><div class="picker-controls"><div class="picker-categories" id="picker-tabs"></div><label class="picker-qty">Qty<input id="picker-quantity" value="${settings.defaultQuantity}" inputmode="numeric" aria-label="Quantity to add"></label></div><div class="picker-grid" id="picker-grid"></div><div class="picker-footer"><button class="text-button" id="picker-import">Paste list</button><button class="text-button" id="picker-more">Show more</button><button class="button primary" id="picker-done">Done</button></div>`, {
    wide: true
  });
  refreshLevelView = renderPicker;
  renderPicker();
  $('picker-search').oninput = () => {
    pickerLimit = 50;
    renderPicker();
  };
  $('picker-search').onkeydown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = $('picker-grid').querySelector('[data-pick]');
      if (first) pick(first.dataset.pick);
    }
  };
  bindLevel($('picker-level'));
  $('picker-tabs').onclick = event => {
    const button = event.target.closest('[data-category]');
    if (button) {
      pickerCategory = button.dataset.category;
      pickerLimit = 50;
      renderPicker();
    }
  };
  $('picker-grid').onclick = event => {
    const button = event.target.closest('[data-pick]');
    if (button) pick(button.dataset.pick);
  };
  $('picker-more').onclick = () => {
    pickerLimit += 50;
    renderPicker();
  };
  $('picker-import').onclick = () => importItems();
  $('picker-done').onclick = closeModal;
  setTimeout((() => $('picker-search')?.focus()), 60);
}

function renderPicker() {
  const query = $('picker-search').value.trim().toLowerCase(), resolved = resolveItem(query, catalog);
  $('picker-tabs').innerHTML = [ 'All', 'Favorites', 'Sets', 'Materials', 'Products', 'Animal goods', 'Crops', 'Tools', 'Services', 'New' ].map((name => `<button class="${pickerCategory === name ? 'active' : ''}" data-category="${e(name)}">${e(name)}</button>`)).join('');
  const items = catalog.filter((item => (settings.level === null || item.level <= settings.level) && (pickerCategory === 'All' || item.category === pickerCategory || pickerCategory === 'Favorites' && settings.favorites.includes(item.id) || pickerCategory === 'New' && item.new) && (!query || `${item.name} ${item.id} ${item.machine || ''} ${item.group || ''}`.toLowerCase().includes(query) || item.id === resolved?.id)));
  const popular = [ 'beeswax', 'bolt', 'plank', 'duct-tape', 'diamond-ring', 'blanket', 'necklace', 'bem-set', 'sem-set', 'lem-set', 'butter', 'cheese', 'help' ];
  items.sort(((a, b) => (popular.includes(a.id) ? popular.indexOf(a.id) : 999) - (popular.includes(b.id) ? popular.indexOf(b.id) : 999) || a.level - b.level || a.name.localeCompare(b.name)));
  $('picker-grid').innerHTML = items.slice(0, pickerLimit).map((item => {
    const row = draft.items.find((row => row.id === item.id)), price = defaultPrice(item);
    return `<button class="picker-item" data-pick="${item.id}" aria-label="Add ${e(item.name)}"><span class="item-level">Lv. ${item.level}</span>${row ? `<span class="picker-added">${icon('check')}</span>` : ''}<img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="${e(item.image)}" alt="" loading="lazy"><strong>${e(item.name)}</strong><small>${item.bundle ? '1 set' : priceLabel(price)}</small></button>`;
  })).join('') || '<p class="empty-note">No items at this level.</p>';
  $('picker-more').hidden = items.length <= pickerLimit;
}

function pick(id) {
  try {
    add(id, parseQuantity($('picker-quantity').value));
    renderPicker();
  } catch (error) {
    toast(error.message);
  }
}

$('open-add').onclick = () => {
  if (scannerActive) closeScanner(); else picker();
};

$('empty-add').onclick = picker;

function importItems(initial = '') {
  modal('Import list', `<textarea id="import-input" class="export-text" aria-label="Item list" placeholder="20 Beeswax @ 3k\nOr paste a scanner code">${e(initial)}</textarea><label class="field-label">Items<select id="import-mode"><option value="replace">Replace this list</option><option value="merge">Add to this list</option></select></label><p class="editor-error" id="import-error"></p><div class="dialog-actions"><button class="button primary" id="confirm-import">Import</button></div>`);
  $('confirm-import').onclick = () => {
    try {
      const rows = parseImport($('import-input').value, catalog).map(pricedRow);
      let next = rows;
      if ($('import-mode').value === 'merge') {
        const map = new Map(draft.items.map((row => [ row.id, {
          ...row
        } ])));
        for (const row of rows) {
          const old = map.get(row.id);
          if (old) {
            quantityFor(byId.get(row.id), old.quantity + row.quantity);
            old.quantity += row.quantity;
          } else map.set(row.id, row);
        }
        next = [ ...map.values() ];
      }
      change((() => {
        draft.items = next;
        selection.clear();
        selecting = false;
      }));
      closeModal();
      toast(`${rows.length} items imported`);
    } catch (error) {
      $('import-error').textContent = error.message;
    }
  };
}

$('open-import').onclick = () => importItems();

function settingsPanel(section = 'Home') {
  if (section === 'Home') {
    const menus = [ [ 'Image', 'image', 'Image', 'Layout, colors & caption' ], [ 'Farm', 'star', 'Your farm', 'Level & contact' ], [ 'Defaults', 'sort', 'Prices & sorting', 'Defaults & item order' ], [ 'Payment', 'tag', 'Payment item', byId.get(settings.calculationItem)?.name || 'Diamond ring' ], [ 'Text', 'list', 'Text format', 'How your list is copied' ], [ 'Data', 'bookmark', 'Lists & backup', 'Save, restore & export' ], [ 'About', 'shield', 'About', 'Changelog, privacy & terms' ] ];
    modal('Settings', `<label class="settings-row global-level-row"><span>Farm level<small>Applies everywhere</small></span><input id="global-level" data-global-level type="number" min="1" max="999" value="${settings.level ?? ''}" placeholder="All" aria-label="Global farm level"></label><div class="settings-menu">${menus.map((([key, ico, name, detail]) => `<button data-section="${key}"><span class="menu-icon">${icon(ico)}</span><span><strong>${name}</strong><small>${e(detail)}</small></span>${icon('chevron-right')}</button>`)).join('')}</div>`);
    bindLevel($('global-level'));
    $('modal-content').onclick = event => {
      const button = event.target.closest('[data-section]');
      if (button) settingsPanel(button.dataset.section);
    };
    return;
  }
  if (section === 'Payment') {
    paymentPicker(true);
    return;
  }
  const titles = {
    Image: 'Image',
    Farm: 'Your farm',
    Defaults: 'Prices & sorting',
    Text: 'Text format',
    Data: 'Lists & backup',
    About: 'About'
  };
  modal(titles[section], '<div class="settings-section" id="settings-section"></div><div class="dialog-actions"><button class="button primary" id="settings-done">Done</button></div>', {
    back: true
  });
  $('settings-done').onclick = closeModal;
  const host = $('settings-section'), image = draft.image;
  if (section === 'About') host.innerHTML = aboutContent();
  if (section === 'Image') {
    host.innerHTML = `<h3>Color</h3><div class="preset-grid">${colorPresets.map(((preset, i) => `<button class="preset-swatch ${preset.background === image.background ? 'active' : ''}" data-preset="${i}" aria-label="${preset.name} color" style="--swatch-border:${preset.border}"><span style="background:${preset.background};color:${preset.text}"><i>3k</i><i>8</i></span><small>${preset.name}</small></button>`)).join('')}</div><h3>Layout</h3><label class="settings-row"><span>Image columns<small>Default: 4 on phones, Auto on larger screens.</small></span><select id="image-layout"><option value="auto">Auto</option>${[ 1, 2, 3, 4, 5, 6, 8, 10, 12 ].map((n => `<option value="${n}">${n} columns</option>`)).join('')}</select></label><label class="settings-row"><span>Show item names</span><input type="checkbox" data-image-flag="names" ${image.names ? 'checked' : ''}></label><h3>Caption</h3><label class="field-label"><input id="image-caption-text" maxlength="160" value="${e(image.captionText)}" placeholder="Partials Accepted" aria-label="Caption text"></label><label class="settings-row"><span>Position</span><select id="caption-position"><option value="bottom">Below items</option><option value="top">Above items</option><option value="off">Hidden</option></select></label><details class="advanced"><summary>More image options</summary><div class="inline-colors">${[ 'background', 'border', 'text' ].map((key => `<label>${key[0].toUpperCase() + key.slice(1)}<input type="color" data-color="${key}" value="${image[key]}"></label>`)).join('')}</div><h3>Show</h3><div class="check-grid">${[ [ 'prices', 'Prices' ], [ 'quantities', 'Quantities' ], [ 'totals', 'Totals' ], [ 'payment', 'Payment item' ], [ 'simplify', 'Simplify prices' ] ].map((([key, label]) => `<label class="toggle-label"><input type="checkbox" data-image-flag="${key}" ${image[key] ? 'checked' : ''}>${label}</label>`)).join('')}</div><label class="settings-row"><span>Image width</span><select id="image-width">${[ 600, 1e3, 1400, 1800, 2400 ].map((n => `<option value="${n}">${n}px</option>`)).join('')}</select></label><label class="settings-row"><span>Quality</span><select id="image-quality"><option value="1">Standard</option><option value="2">High</option><option value="3">Maximum</option></select></label><div class="form-grid"><label class="field-label">Padding<input id="image-padding" type="number" min="0" max="40" value="${image.padding}"></label><label class="field-label">Gap<input id="image-gap" type="number" min="0" max="16" value="${image.gap}"></label></div></details>`;
    $('image-layout').value = image.layout === 'fixed' ? image.columns : image.layout === 'device' && innerWidth <= 680 ? 4 : 'auto';
    $('caption-position').value = image.caption ? image.captionPosition : 'off';
    $('image-width').value = image.width;
    $('image-quality').value = Math.round(image.quality);
    const update = (key, value) => change((() => draft.image = validateImage({
      ...draft.image,
      [key]: value
    })));
    $('image-layout').onchange = event => change((() => {
      const value = event.target.value;
      draft.image.layout = [ 'auto', 'device' ].includes(value) ? value : 'fixed';
      if (draft.image.layout === 'fixed') draft.image.columns = Number(value);
    }));
    $('caption-position').onchange = event => change((() => {
      draft.image.caption = event.target.value !== 'off';
      if (draft.image.caption) draft.image.captionPosition = event.target.value;
    }));
    for (const [id, key] of [ [ 'image-caption-text', 'captionText' ], [ 'image-width', 'width' ], [ 'image-quality', 'quality' ], [ 'image-padding', 'padding' ], [ 'image-gap', 'gap' ] ]) $(id).onchange = event => update(key, event.target.value);
    host.querySelectorAll('[data-image-flag]').forEach((input => input.onchange = () => update(input.dataset.imageFlag, input.checked)));
    host.querySelectorAll('[data-color]').forEach((input => input.onchange = () => update(input.dataset.color, input.value)));
    host.querySelectorAll('[data-preset]').forEach((button => button.onclick = () => {
      const {name: name, ...colors} = colorPresets[Number(button.dataset.preset)];
      change((() => draft.image = {
        ...draft.image,
        ...colors
      }));
      settingsPanel('Image');
    }));
  }
  if (section === 'Farm') {
    host.innerHTML = `<label class="settings-row"><span>Hay Day level<small>Filters items you can use</small></span><input id="farm-level" data-global-level type="number" min="1" max="999" placeholder="All" value="${settings.level ?? ''}" aria-label="Hay Day level"></label><label class="field-label">Farm name<input id="farm-name" maxlength="60" value="${e(settings.farm)}" placeholder="Optional"></label><details class="advanced"><summary>Contact & trade details</summary><label class="field-label">Player tag<input id="farm-tag" maxlength="60" value="${e(settings.tag)}" placeholder="#ABC123"></label><label class="field-label">Discord<input id="farm-discord" maxlength="60" value="${e(settings.discord)}" placeholder="Username"></label><label class="toggle-label"><input id="partials" type="checkbox" ${draft.partials ? 'checked' : ''}>Accept partials</label><label class="field-label">Trade note<textarea id="trade-notes" maxlength="200" placeholder="Optional">${e(draft.notes)}</textarea></label></details><p class="editor-error" id="farm-error"></p>`;
    bindLevel($('farm-level'));
    for (const [id, key] of [ [ 'farm-name', 'farm' ], [ 'farm-tag', 'tag' ], [ 'farm-discord', 'discord' ] ]) $(id).onchange = event => {
      settings[key] = event.target.value.trim().slice(0, 60);
      save();
      render(false);
    };
    $('partials').onchange = event => change((() => draft.partials = event.target.checked));
    $('trade-notes').onchange = event => change((() => draft.notes = event.target.value.slice(0, 200)));
  }
  if (section === 'Defaults') {
    host.innerHTML = `<label class="settings-row"><span>Item order</span><select id="tile-sort"><option value="quantity">Highest quantity</option><option value="price">Highest price each</option><option value="total">Highest total value</option><option value="name">Name</option><option value="manual">Manual</option></select></label><label class="settings-row"><span>Default quantity</span><input id="default-quantity" value="${settings.defaultQuantity}" inputmode="numeric"></label><label class="settings-row"><span>Default price</span><input id="default-price" value="${e(settings.defaultPrice)}" aria-label="Default price" style="width:100px;text-align:right"></label><p class="settings-note">3k = 3,000 coins each · 5x = 5 × shop max</p><div class="settings-top-actions"><button class="button secondary" id="defaults-prices">Saved prices</button><button class="button secondary" id="defaults-sets">Material sets</button></div><p class="editor-error" id="defaults-error"></p>`;
    $('tile-sort').value = settings.sortOrder;
    $('tile-sort').onchange = event => {
      settings.sortOrder = event.target.value;
      change((() => {}));
    };
    $('default-quantity').onchange = event => {
      try {
        settings.defaultQuantity = parseQuantity(event.target.value);
        save();
        $('defaults-error').textContent = '';
      } catch (error) {
        $('defaults-error').textContent = error.message;
        event.target.value = settings.defaultQuantity;
      }
    };
    $('default-price').onchange = event => {
      try {
        const text = event.target.value.trim();
        if (text) checkedPrice(text, {
          maxPrice: 1
        });
        settings.defaultPrice = text;
        save();
        $('defaults-error').textContent = '';
      } catch (error) {
        $('defaults-error').textContent = error.message;
        event.target.value = settings.defaultPrice;
      }
    };
    $('defaults-prices').onclick = priceBook;
    $('defaults-sets').onclick = () => materialSet();
  }
  if (section === 'Text') {
    host.innerHTML = `<label class="field-label">Format<input id="text-format" value="${e(settings.textFormat)}" maxlength="240"></label><div class="settings-top-actions"><button class="button quiet" data-text-format="{{quantity}} {{name}} ({{price}})">Quantity + name + price</button><button class="button quiet" data-text-format="{{quantity}} {{name}}">Quantity + name</button></div><label class="settings-row"><span>Separate items with</span><select id="text-separator"><option value="newline">New line</option><option value="comma">Comma</option><option value="custom">Custom</option></select></label><label class="field-label" id="custom-separator-field">Separator<input id="custom-separator" value="${e(settings.customSeparator)}" maxlength="20"></label><details class="advanced"><summary>Format variables</summary><p class="helper">{{name}} · {{quantity}} · {{price}} · {{unit}} · {{total}}</p></details><label class="field-label">Preview<textarea id="text-preview" readonly rows="5"></textarea></label>`;
    const update = () => {
      $('text-preview').value = plainText();
      $('custom-separator-field').hidden = settings.textSeparator !== 'custom';
    };
    $('text-separator').value = settings.textSeparator;
    update();
    for (const [id, key] of [ [ 'text-format', 'textFormat' ], [ 'text-separator', 'textSeparator' ], [ 'custom-separator', 'customSeparator' ] ]) $(id).onchange = event => {
      settings[key] = event.target.value;
      save();
      update();
    };
    host.querySelectorAll('[data-text-format]').forEach((button => button.onclick = () => {
      settings.textFormat = button.dataset.textFormat;
      $('text-format').value = settings.textFormat;
      save();
      update();
    }));
  }
  if (section === 'Data') {
    host.innerHTML = `<div class="settings-menu"><button id="data-save"><span class="menu-icon">${icon('bookmark')}</span><span><strong>Save this list</strong><small>Keep it for another trade</small></span>${icon('chevron-right')}</button><button id="data-lists"><span class="menu-icon">${icon('list')}</span><span><strong>Saved lists</strong><small>Load a previous trade</small></span>${icon('chevron-right')}</button></div><h3>Backup</h3><div class="settings-top-actions"><button class="button secondary" id="backup-all">Download backup</button><button class="button secondary" id="restore-button">Restore<input id="restore-all" type="file" accept=".json" hidden></button></div><p class="editor-error" id="backup-error"></p><details class="advanced"><summary>More data options</summary><div class="settings-top-actions"><button class="button quiet" id="export-code">Export item code</button><button class="button quiet danger-text" id="clear-all">Clear this list</button></div></details>`;
    $('data-save').onclick = saveNamed;
    $('data-lists').onclick = savedLists;
    $('backup-all').onclick = () => downloadFile('hayday-backup.json', JSON.stringify({
      type: 'hayday-editor-backup',
      version: 1,
      draft: draft,
      settings: settings,
      lists: storage.get('lists', [])
    }, null, 2));
    $('restore-button').onclick = event => {
      if (event.target !== $('restore-all')) $('restore-all').click();
    };
    $('restore-all').onchange = restoreBackup;
    $('export-code').onclick = () => downloadFile('hayday-items.json', JSON.stringify({
      version: 1,
      items: draft.items
    }, null, 2));
    $('clear-all').onclick = clearAll;
  }
}

$('open-settings').onclick = () => {
  if (scannerActive) scannerMessage('settings'); else settingsPanel();
};

$('open-layout').onclick = () => settingsPanel('Image');

$('open-farm').onclick = () => {
  if (scannerActive) closeScanner();
  settingsPanel('Farm');
};

$('sort-menu').onclick = () => settingsPanel('Defaults');

function editCaption(notes = false) {
  modal(notes ? 'Trade note' : 'Caption', `<label class="field-label"><textarea id="quick-caption" maxlength="${notes ? 200 : 160}" aria-label="${notes ? 'Trade note' : 'Caption'}">${e(notes ? draft.notes : draft.image.captionText || (draft.partials ? 'Partials Accepted' : 'No Partials'))}</textarea></label><div class="dialog-actions"><button class="button primary" id="save-caption">Done</button></div>`);
  $('save-caption').onclick = () => {
    const value = $('quick-caption').value;
    change((() => {
      if (notes) draft.notes = value; else {
        draft.image.caption = true;
        draft.image.captionText = value;
      }
    }));
    closeModal();
  };
}

function priceBook() {
  modal('Prices', `<div class="tabs"><button class="active" id="prices-book-tab">Saved prices</button><button id="prices-calc-tab">Payment item</button></div><div class="price-book-controls"><div class="search-wrap">${icon('search')}<input id="price-search" type="search" placeholder="Find an item" aria-label="Find saved price"></div><label class="compact-level">Level<input id="price-level" data-global-level type="number" min="1" max="999" value="${settings.level ?? ''}" placeholder="All" aria-label="Price filter level"></label></div><div class="editor-price-list" id="price-list"></div><div class="dialog-actions"><button class="text-button" id="save-current-prices">Save current prices</button><button class="button primary" id="prices-done">Done</button></div>`);
  const list = () => {
    const text = $('price-search').value.toLowerCase();
    $('price-list').innerHTML = itemsAtLevel(catalog, settings.level).filter((item => `${item.name} ${item.id}`.toLowerCase().includes(text))).sort(((a, b) => Number(Object.hasOwn(settings.prices, b.id)) - Number(Object.hasOwn(settings.prices, a.id)) || a.name.localeCompare(b.name))).slice(0, 150).map((item => `<label class="editor-price-row"><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="${e(item.image)}" alt=""><div><strong>${e(item.name)}</strong><small>${item.bundle ? 'Per set' : item.service ? 'Service' : `Lv. ${item.level} · max ${number(item.maxPrice)}`}</small></div><div class="saved-price-input"><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="assets/services/coin.png" alt="coins"><input data-price-id="${item.id}" value="${e(settings.prices[item.id] ?? '')}" placeholder="" aria-label="Saved ${e(item.name)} price"></div></label>`)).join('') || '<p class="empty-note">No items at this level.</p>';
  };
  refreshLevelView = list;
  list();
  $('price-search').oninput = list;
  bindLevel($('price-level'));
  $('price-list').onchange = event => {
    const id = event.target.dataset.priceId;
    if (!id) return;
    try {
      const text = event.target.value.trim();
      if (text) {
        checkedPrice(text, byId.get(id));
        settings.prices[id] = text;
      } else delete settings.prices[id];
      save();
    } catch (error) {
      toast(error.message);
      event.target.value = settings.prices[id] ?? '';
    }
  };
  $('save-current-prices').onclick = () => {
    selectedRows(draft.items, selection).forEach((row => {
      if (row.price !== undefined && !row.unpriced) settings.prices[row.id] = row.priceInput || priceLabel(row);
    }));
    save();
    toast('Prices saved');
  };
  $('prices-calc-tab').onclick = () => paymentPicker();
  $('prices-done').onclick = closeModal;
}

$('open-prices').onclick = () => {
  if (scannerActive) closeScanner();
  priceBook();
};

function paymentPicker(back = false) {
  const summary = paymentSummary(scope(), byId, settings.calculationItem);
  modal('Payment item', `<div class="calc-summary" id="calc-summary"></div><div class="calc-controls"><div class="search-wrap">${icon('search')}<input id="payment-search" type="search" placeholder="Find an item" aria-label="Find payment item"></div><select id="payment-sort" aria-label="Sort payment items"><option value="high">Highest price</option><option value="low">Lowest price</option><option value="level">Highest at my level</option><option value="name">Name</option></select></div><label class="payment-level" id="payment-level-field">My level<input id="payment-level" data-global-level type="number" min="1" max="999" value="${settings.level ?? ''}" placeholder="All" aria-label="Payment filter level"></label><div class="payment-grid" id="payment-grid"></div><p class="helper" id="payment-scope" style="margin-top:13px">${selection.size ? selection.size + ' selected items' : number(summary.units) + ' items'} · ${number(summary.coins)} coins</p><div class="dialog-actions"><button class="button primary" id="payment-done">Done</button></div>`, {
    back: back
  });
  const renderPayment = () => {
    const total = paymentSummary(scope(), byId, settings.calculationItem);
    $('calc-summary').innerHTML = `<img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="${e(total.item.image)}" alt=""><div><strong>${number(total.equivalent)}</strong><small>${e(total.item.name)} · ${number(total.item.maxPrice)} coins each</small></div>`;
    const items = paymentItems(catalog, $('payment-search').value, $('payment-sort').value, settings.level);
    $('payment-grid').innerHTML = items.slice(0, 120).map((item => `<button class="payment-item ${item.id === settings.calculationItem ? 'active' : ''}" data-payment="${item.id}" aria-label="Use ${e(item.name)}" aria-pressed="${item.id === settings.calculationItem}"><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="${e(item.image)}" alt="" loading="lazy"><strong>${e(item.name)}</strong><small>${number(item.maxPrice)}</small><span class="item-level">Lv. ${item.level}</span></button>`)).join('') || '<p class="empty-note">No items at this level.</p>';
  };
  refreshLevelView = renderPayment;
  renderPayment();
  $('payment-search').oninput = renderPayment;
  $('payment-sort').onchange = renderPayment;
  bindLevel($('payment-level'));
  $('payment-grid').onclick = event => {
    const button = event.target.closest('[data-payment]');
    if (button) {
      settings.calculationItem = button.dataset.payment;
      save();
      render(false);
      renderPayment();
    }
  };
  $('payment-done').onclick = closeModal;
}

function materialSet(group = 'BEM', initialQuantity = 1) {
  const canUse = id => settings.level === null || byId.get(id.toLowerCase() + '-set').level <= settings.level;
  if (!canUse(group)) group = Object.keys(materialGroups).find(canUse);
  if (!group) return toast('No material sets are available at this farm level.');
  let combined = true;
  modal('Material set', `<label class="field-label">Set<select id="set-type">${Object.keys(materialGroups).map((name => `<option value="${name}" ${canUse(name) ? '' : 'disabled'}>${name} set${canUse(name) ? '' : ' · Lv. 22'}</option>`)).join('')}</select></label><label class="settings-row"><span>Sets<small>1 of each material per set</small></span><input id="set-quantity" value="${initialQuantity}" inputmode="numeric" aria-label="Number of sets"></label><div class="set-preview" id="set-preview"></div><div class="segmented" role="group" aria-label="Set display"><button id="set-combined" class="active">One tile</button><button id="set-individual">Individual tiles</button></div><p class="editor-error" id="set-error"></p><div class="dialog-actions"><button class="button primary" id="add-set">Add set</button></div>`);
  $('set-type').value = group;
  const update = () => {
    try {
      const count = materialCounts($('set-quantity').value), ids = materialGroups[$('set-type').value];
      $('set-preview').innerHTML = ids.map(((id, i) => `<div class="set-component"><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="${e(byId.get(id).image)}" alt=""><strong>${count[i]}</strong><small>${e(byId.get(id).name)}</small></div>`)).join('');
      $('set-error').textContent = '';
    } catch (error) {
      $('set-error').textContent = error.message;
    }
  };
  update();
  $('set-type').onchange = update;
  $('set-quantity').oninput = update;
  $('set-combined').onclick = () => {
    combined = true;
    $('set-combined').classList.add('active');
    $('set-individual').classList.remove('active');
  };
  $('set-individual').onclick = () => {
    combined = false;
    $('set-individual').classList.add('active');
    $('set-combined').classList.remove('active');
  };
  $('add-set').onclick = () => {
    try {
      const quantity = parseQuantity($('set-quantity').value), counts = materialCounts(quantity), group = $('set-type').value;
      if (combined) add(group.toLowerCase() + '-set', quantity); else {
        const ids = materialGroups[group], next = ids.map(((id, i) => {
          const item = byId.get(id), old = draft.items.find((row => row.id === id)), value = (old?.quantity || 0) + counts[i];
          quantityFor(item, value);
          const price = defaultPrice(item);
          return {
            id: id,
            quantity: value,
            ...old || price,
            ...{
              quantity: value
            }
          };
        }));
        change((() => {
          for (const row of next) {
            const index = draft.items.findIndex((x => x.id === row.id));
            if (index >= 0) draft.items[index] = row; else draft.items.push(row);
          }
        }));
      }
      closeModal();
    } catch (error) {
      $('set-error').textContent = error.message;
    }
  };
}

function editListName() {
  modal('List name', `<label class="field-label"><input id="edit-list-name" maxlength="50" value="${e(draft.name)}" aria-label="List name"></label><div class="dialog-actions"><button class="button quiet" id="name-save-list">Save list</button><button class="button primary" id="name-done">Done</button></div>`);
  $('name-done').onclick = () => {
    const name = $('edit-list-name').value.trim() || 'My trade';
    change((() => draft.name = name));
    closeModal();
  };
  $('name-save-list').onclick = saveNamed;
}

$('list-name-button').onclick = editListName;

function saveNamed() {
  modal('Save list', `<label class="field-label">Name<input id="save-list-name" maxlength="50" value="${e(draft.name)}"></label><div class="dialog-actions"><button class="button primary" id="save-list-confirm">Save</button></div>`);
  $('save-list-confirm').onclick = () => {
    const name = $('save-list-name').value.trim();
    if (!name) return toast('Enter a name');
    const lists = storage.get('lists', []), old = lists.find((list => list.name === name));
    draft.name = name;
    const list = {
      id: old?.id || crypto.randomUUID(),
      name: name,
      date: (new Date).toISOString(),
      draft: structuredClone(draft)
    };
    if (!storage.set('lists', [ list, ...lists.filter((x => x.name !== name)) ].slice(0, 50))) return toast('Storage full · download a backup');
    save();
    render(false);
    closeModal();
    toast('List saved');
  };
}

function savedLists() {
  const lists = storage.get('lists', []);
  modal('Your lists', `<div class="settings-top-actions"><button class="button secondary" id="save-current-list">Save current</button><button class="button quiet" id="new-list">New list</button></div>${lists.map((list => `<div class="saved-row"><div><strong>${e(list.name)}</strong><p>${list.draft.items.length} items · ${e(new Date(list.date).toLocaleDateString())}</p></div><button class="button secondary" data-load="${e(list.id)}">Open</button><button class="icon-button danger-text" data-delete="${e(list.id)}" aria-label="Delete ${e(list.name)}">${icon('trash')}</button></div>`)).join('') || '<p class="empty-note">Your saved lists appear here.</p>'}`);
  $('save-current-list').onclick = saveNamed;
  $('new-list').onclick = () => {
    change((() => {
      draft = {
        ...draft,
        name: 'My trade',
        items: [],
        notes: ''
      };
      selection.clear();
      selecting = false;
    }));
    closeModal();
  };
  $('modal-content').onclick = event => {
    const load = event.target.closest('[data-load]'), removeButton = event.target.closest('[data-delete]');
    if (load) {
      try {
        const next = checkedDraft(lists.find((list => list.id === load.dataset.load)).draft);
        change((() => {
          draft = next;
          selection.clear();
          selecting = false;
        }));
        closeModal();
      } catch (error) {
        toast(error.message);
      }
    }
    if (removeButton) {
      storage.set('lists', lists.filter((list => list.id !== removeButton.dataset.delete)));
      savedLists();
    }
  };
}

$('open-saved').onclick = () => {
  if (scannerActive) closeScanner();
  savedLists();
};

function clearAll() {
  if (!draft.items.length) return;
  change((() => {
    draft.items = [];
    selection.clear();
    selecting = false;
  }));
  closeModal();
  toast('List cleared', true);
}

function separator() {
  return settings.textSeparator === 'comma' ? ', ' : settings.textSeparator === 'custom' ? settings.customSeparator : '\n';
}

function plainText(rows = scope()) {
  return listText(rows, byId, settings.textFormat, separator());
}

function textExport() {
  const rows = scope();
  if (!rows.length) return toast('Add items first');
  modal('Share text', `<div class="tabs"><button class="active" id="plain-text-tab">List</button><button id="discord-text-tab">Discord</button><button id="import-text-tab">Item code</button></div><textarea id="text-output" class="export-text" aria-label="Text to share"></textarea><div class="dialog-actions"><span class="helper">${selection.size ? selection.size + ' selected' : 'All items'} · edit before copying</span><button class="button quiet" id="text-download">Download</button><button class="button primary" id="text-copy">Copy text</button></div>`);
  const show = (id, text) => {
    document.querySelectorAll('.tabs button').forEach((button => button.classList.toggle('active', button.id === id)));
    $('text-output').value = text;
    $('text-output').readOnly = id === 'import-text-tab';
  };
  show('plain-text-tab', plainText(rows));
  $('plain-text-tab').onclick = () => show('plain-text-tab', plainText(rows));
  $('discord-text-tab').onclick = () => {
    const total = totals(rows, byId);
    show('discord-text-tab', [ `**${draft.mode === 'buy' ? 'BUYING' : 'SELLING'}${settings.farm ? ' · ' + settings.farm : ''}**`, plainText(rows), `**${number(total.coins)} coins · ${number(total.units)} items**`, draft.image.captionText || (draft.partials ? 'Partials accepted' : 'No partials'), settings.tag, settings.discord, draft.notes ].filter(Boolean).join('\n'));
  };
  $('import-text-tab').onclick = () => show('import-text-tab', serializeItems(rows));
  $('text-copy').onclick = async () => {
    try {
      await copyText($('text-output').value);
      toast('Text copied');
    } catch (error) {
      toast(error.message);
    }
  };
  $('text-download').onclick = () => downloadFile('haydex-trade.txt', $('text-output').value, 'text/plain');
}

$('copy-text').onclick = () => {
  if (scannerActive) scannerMessage('copy'); else textExport();
};

async function preview() {
  if (!draft.items.length) return toast('Add items first');
  const selected = structuredClone(scope()), all = structuredClone(displayRows()), hasSelection = selection.size > 0;
  modal('Share image', `<div class="preview-controls"><select id="export-scope" aria-label="Items to export">${hasSelection ? `<option value="selected">${selection.size} selected ${selection.size === 1 ? 'item' : 'items'}</option>` : ''}<option value="all">All items</option></select><select id="export-page" aria-label="Image page"></select><button class="text-button" id="export-options">Appearance</button></div><div id="export-preview"><p class="helper">Creating image…</p></div><p id="export-info" class="preview-info"></p><p class="editor-error" id="export-error"></p><div class="dialog-actions preview-actions"><button class="button quiet" id="image-copy" disabled>Copy image</button><button class="button secondary" id="images-zip" hidden>All pages</button><button class="button primary" id="image-download" disabled>Download PNG</button></div>`);
  const host = $('export-preview');
  let output = null, generation = 0;
  const rows = () => $('export-scope').value === 'selected' ? selected : all;
  const columnCount = () => stageColumns(rows().length);
  const update = async (reset = true) => {
    const current = ++generation;
    output = null;
    $('image-copy').disabled = true;
    $('image-download').disabled = true;
    $('images-zip').disabled = true;
    try {
      const currentRows = rows(), col = columnCount(), plan = exportPlan(currentRows.length, draft.image, col);
      $('export-error').textContent = '';
      if (reset) $('export-page').innerHTML = Array.from({
        length: plan.pages
      }, ((_, i) => `<option value="${i}">Page ${i + 1} / ${plan.pages}</option>`)).join('');
      $('export-page').hidden = plan.pages < 2;
      $('images-zip').hidden = plan.pages < 2;
      const next = await renderTradePage(currentRows, byId, settings, draft.image, col, Number($('export-page').value), details());
      if (current !== generation || !host.isConnected || !$('modal').open) return;
      output = next;
      next.canvas.className = 'preview-canvas';
      next.canvas.setAttribute('role', 'img');
      next.canvas.setAttribute('aria-label', 'Trade image');
      host.replaceChildren(next.canvas);
      $('export-info').textContent = `${next.canvas.width} × ${next.canvas.height} · ${currentRows.length} ${currentRows.length === 1 ? 'item' : 'items'}`;
      if (next.scale < next.requested - .01) $('export-info').textContent += ' · device-safe resolution';
      $('image-copy').disabled = false;
      $('image-download').disabled = false;
      $('images-zip').disabled = false;
    } catch (error) {
      if (current === generation && $('export-error')) $('export-error').textContent = error.message;
    }
  };
  $('export-scope').onchange = () => update();
  $('export-page').onchange = () => update(false);
  $('export-options').onclick = () => settingsPanel('Image');
  $('image-copy').onclick = async () => {
    if (!output) return;
    try {
      if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error('Clipboard unavailable');
      await navigator.clipboard.write([ new ClipboardItem({
        'image/png': pngBlob(output.canvas)
      }) ]);
      toast('Image copied');
    } catch {
      if (output) {
        downloadFile('haydex-trade.png', await pngBlob(output.canvas), 'image/png');
        toast('PNG downloaded');
      }
    }
  };
  $('image-download').onclick = async () => {
    if (output) downloadFile(`haydex-trade-${Number($('export-page').value) + 1}.png`, await pngBlob(output.canvas), 'image/png');
  };
  $('images-zip').onclick = async () => {
    const button = $('images-zip');
    button.disabled = true;
    try {
      const files = [], currentRows = rows(), col = columnCount(), plan = exportPlan(currentRows.length, draft.image, col);
      for (let page = 0; page < plan.pages; page++) {
        button.textContent = `${page + 1} / ${plan.pages}`;
        const result = await renderTradePage(currentRows, byId, settings, draft.image, col, page, details());
        files.push({
          name: `trade-${page + 1}.png`,
          data: await pngBlob(result.canvas)
        });
        result.canvas.width = 1;
        result.canvas.height = 1;
      }
      downloadFile('haydex-trades.zip', await makeZip(files), 'application/zip');
    } catch (error) {
      toast(error.message);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = 'All pages';
      }
    }
  };
  await update();
}

$('preview-card').onclick = () => {
  if (scannerActive) closeScanner();
  preview();
};

for (const button of document.querySelectorAll('[data-mode]')) button.onclick = () => change((() => draft.mode = button.dataset.mode));

$('open-guide').onclick = () => modal('Quick guide', `<ol class="help-steps"><li><strong>1. Add or scan</strong><p>Find items with Add items, or read photos of your barn in Scanner.</p></li><li><strong>2. Set your trade</strong><p>Tap any quantity or price to edit. Drag the grip to move or delete. Select items to edit price or quantity temporarily. Deselect to restore the originals. Save keeps selected price changes.</p></li><li><strong>3. Share</strong><p>Image creates your ad. Text copies your list. Tap the caption on the image to edit it.</p></li></ol><details class="advanced"><summary>Price formats</summary><p class="helper">3k = 3,000 coins each. 5x = five times shop max. Expressions like 20*4 work. Ratios such as 4:1 are excluded from coin totals.</p></details>`);

function checkedSettings(value = {}) {
  const next = {
    ...defaults,
    ...value
  };
  next.defaultQuantity = parseQuantity(next.defaultQuantity || 1);
  next.defaultPrice = String(next.defaultPrice ?? '').trim();
  if (!value.priceDefaultsVersion && next.defaultPrice === '0') next.defaultPrice = '';
  next.priceDefaultsVersion = 1;
  if (next.defaultPrice) checkedPrice(next.defaultPrice, {
    maxPrice: 1
  });
  next.level = playerLevel(value.level);
  next.sortOrder = [ 'quantity', 'price', 'total', 'name', 'manual' ].includes(next.sortOrder) ? next.sortOrder : 'quantity';
  next.favorites = Array.isArray(next.favorites) ? next.favorites.filter((id => byId.has(id))) : [];
  next.calculationItem = byId.get(next.calculationItem)?.maxPrice > 0 && !byId.get(next.calculationItem).bundle ? next.calculationItem : 'diamond-ring';
  next.prices = {
    ...defaults.prices
  };
  for (const [id, price] of Object.entries(value.prices || {})) {
    if (byId.has(id) && String(price).trim()) {
      checkedPrice(price, byId.get(id));
      next.prices[id] = String(price);
    }
  }
  for (const key of [ 'farm', 'tag', 'discord' ]) next[key] = String(next[key] || '').slice(0, 60);
  next.textFormat = String(next.textFormat || editorDefaults.textFormat).slice(0, 240);
  next.textSeparator = [ 'newline', 'comma', 'custom' ].includes(next.textSeparator) ? next.textSeparator : 'newline';
  next.customSeparator = String(next.customSeparator ?? ', ').slice(0, 20);
  return next;
}

function checkedDraft(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.items)) throw new Error('Invalid saved list');
  const rows = value.items.length ? parseImport(JSON.stringify({
    version: 1,
    items: value.items
  }), catalog) : [];
  return {
    name: String(value.name || 'My trade').slice(0, 50),
    mode: value.mode === 'buy' ? 'buy' : 'sell',
    partials: value.partials !== false,
    notes: String(value.notes || '').slice(0, 200),
    image: restoreImageSettings(value.image || {
      ...imageDefaults,
      columns: value.cardColumns || 4
    }),
    items: rows.map(pricedRow).map((row => {
      const raw = value.items.find((x => x.id === row.id));
      if (raw?.priceInput) {
        try {
          const price = checkedPrice(raw.priceInput, byId.get(row.id));
          if (price.mode === row.mode && price.value === row.price && price.ratio === row.ratio) row.priceInput = String(raw.priceInput);
        } catch {}
      }
      return row;
    }))
  };
}

async function restoreBackup(event) {
  try {
    const file = event.target.files[0];
    if (!file || file.size > 2e6) throw new Error('Choose a backup under 2 MB');
    const text = await file.text(), legacy = readLegacyBackup(text, catalog);
    let restored, nextSettings, lists;
    if (legacy) {
      restored = checkedDraft(legacy.active.draft);
      nextSettings = checkedSettings({
        ...settings,
        ...legacy.active.defaults
      });
      lists = [ ...legacy.lists.map((list => ({
        ...list,
        draft: checkedDraft(list.draft)
      }))), ...storage.get('lists', []) ].slice(0, 50);
    } else {
      const data = JSON.parse(text);
      if (data.version !== 1 || data.type !== 'hayday-editor-backup') throw new Error('Choose a builder backup or an original-site export');
      nextSettings = checkedSettings(data.settings);
      restored = checkedDraft(data.draft);
      lists = Array.isArray(data.lists) ? data.lists.slice(0, 50).map((list => ({
        ...list,
        name: String(list.name || 'Saved list').slice(0, 50),
        draft: checkedDraft(list.draft)
      }))) : [];
    }
    remember();
    draft = restored;
    settings = nextSettings;
    selection.clear();
    selecting = false;
    applySort();
    storage.set('lists', lists);
    save();
    render();
    closeModal();
    toast('Backup restored');
  } catch (error) {
    $('backup-error').textContent = error.message;
  }
}

document.addEventListener('keydown', (event => {
  if ($('modal').open || scannerActive) return;
  const editing = document.activeElement.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !editing) {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  }
  if (event.key === 'Escape') {
    const input = document.activeElement, tile = input.closest?.('.trade-tile');
    if (tile && selection.has(tile.dataset.id) && input.matches('input')) {
      const original = draft.items.find((row => row.id === tile.dataset.id));
      input.value = input.classList.contains('tile-price') ? priceLabel(original, draft.image.simplify) : original.quantity;
      input.blur();
    }
    selecting = false;
    setSelection(new Set);
  }
  if (event.key === 'Delete' && selection.size && !editing) {
    event.preventDefault();
    remove(selection);
  }
  if (event.key === '/' && !editing) {
    event.preventDefault();
    picker();
  }
}));

let resizeTimer;

new ResizeObserver((() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout((() => {
    if (catalog.length) render(false);
  }), 60);
})).observe($('main'));

async function init() {
  try {
    const response = await fetch('data/catalog.json');
    if (!response.ok) throw new Error('Items could not load');
    const base = (await response.json()).items;
    catalog = [ ...base, ...serviceItems, ...materialSetItems(base) ];
    byId = new Map(catalog.map((item => [ item.id, item ])));
    try {
      settings = checkedSettings(readPreferences());
    } catch (error) {
      settings = checkedSettings(defaults);
      toast('Some saved settings need updating');
    }
    draft.items = Array.isArray(draft.items) ? draft.items.filter((row => byId.has(row.id))) : [];
    draft = checkedDraft(draft);
    applySort();
    save();
    render();
    const incoming = sessionStorage.getItem('hayday.scan-transfer');
    if (incoming) {
      sessionStorage.removeItem('hayday.scan-transfer');
      importItems(incoming);
    }
    if (location.hash === '#scanner' && !incoming) openScanner();
    const action = sessionStorage.getItem('hayday.open-action');
    sessionStorage.removeItem('hayday.open-action');
    if (!incoming) {
      if (action === 'prices') priceBook();
      if (action === 'image') preview();
      if (action === 'settings') settingsPanel();
      if (action === 'lists') savedLists();
      if (action === 'farm') settingsPanel('Farm');
    }
  } catch (error) {
    toast(error.message);
    $('load-error').hidden = false;
    $('load-error').textContent = error.message;
  }
}

function updateRoute(scanner) {
  const skip = document.querySelector('.skip-link');
  skip.href = scanner ? '#scanner-view' : '#main';
  skip.textContent = scanner ? 'Skip to scanner' : 'Skip to trade';
  document.title = scanner ? `Scanner · ${SITE_NAME}` : SITE_NAME;
  $('open-add').setAttribute('aria-label', scanner ? 'Back to trade' : 'Add items');
  $('open-add').title = scanner ? 'Back to trade' : 'Add items';
}

function scannerMessage(action) {
  $('scanner-frame').contentWindow?.postMessage({
    type: 'hayday-scanner-action',
    action: action
  }, location.origin);
}

function openScanner() {
  scannerActive = true;
  updateRoute(true);
  $('main').hidden = true;
  $('scanner-view').hidden = false;
  if (!$('scanner-frame').getAttribute('src')) $('scanner-frame').src = 'scanner/?embed=1';
  $('open-scanner').classList.add('active');
  $('open-scanner').setAttribute('aria-current', 'page');
  $('open-add').innerHTML = icon('home') + '<span>Home</span>';
  if (location.hash !== '#scanner') history.pushState(null, '', '#scanner');
  window.scrollTo({
    top: 0
  });
}

function closeScanner() {
  try {
    settings = checkedSettings(storage.get('settings', settings));
  } catch {}
  scannerActive = false;
  updateRoute(false);
  $('scanner-view').hidden = true;
  $('main').hidden = false;
  $('open-scanner').classList.remove('active');
  $('open-scanner').removeAttribute('aria-current');
  $('open-add').innerHTML = icon('plus') + '<span>Add items</span>';
  if (location.hash === '#scanner') history.replaceState(null, '', location.pathname + location.search);
  render(false);
}

$('open-scanner').onclick = event => {
  event.preventDefault();
  scannerActive ? closeScanner() : openScanner();
};

for (const link of document.querySelectorAll('.empty-actions a[href="scanner/"]')) link.onclick = event => {
  event.preventDefault();
  openScanner();
};

window.addEventListener('hashchange', (() => {
  if (location.hash === '#scanner') openScanner(); else if (scannerActive) closeScanner();
}));

window.addEventListener('message', (event => {
  if (event.origin !== location.origin || event.source !== $('scanner-frame').contentWindow) return;
  if (event.data?.type === 'hayday-transfer' && typeof event.data.code === 'string') {
    closeScanner();
    importItems(event.data.code);
  }
  if (event.data?.type === 'hayday-action') {
    closeScanner();
    const action = event.data.action;
    if (action === 'prices') priceBook(); else if (action === 'image') preview(); else if (action === 'lists') savedLists(); else if (action === 'farm') settingsPanel('Farm');
  }
}));

init();
