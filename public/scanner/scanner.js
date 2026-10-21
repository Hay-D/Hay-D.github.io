import { imageURL } from '../js/images.js';

import { storage, number, escapeHTML as e, resolveItem, serializeItems, copyText, downloadFile } from '../js/core.js';

import { icon } from '../js/icons.js';

import { aboutContent } from '../js/about.js';

import { readPreferences, writePreferences, setGlobalLevel, onPreferencesChange } from '../js/preferences.js';

import { checkedPrice, priceLabel, playerLevel, itemsAtLevel } from '../js/editor-core.js';

import { detectLayout } from './layout.js';

import { scannerCells } from './preprocess.js';

import { startScanner, scannerArtwork } from './recognition.js';

import { makeZip } from './zip.js';

import { excludedItemIds, canListScan, scanTradeRows, scannerPrice, exclusionItems } from './review.js';

const $ = id => document.getElementById(id), MAX_IMAGES = 30;

const embedded = new URLSearchParams(location.search).get('embed') === '1' && parent !== window;

if (embedded) document.body.classList.add('embedded');

let excluded = new Set, refreshLevelView = null;

let catalog = [], byId = new Map, uploads = [], results = [], scanner = null;

let scanning = false, loadingPhotos = false, startingScanner = false, cancelled = false, toastTimer, reviewing = false;

let options = {
  skipZero: true,
  showPrices: true,
  useDefaultPrice: false,
  rememberPrices: false,
  ...storage.get('scanner-options', {})
};

function farmSettings() {
  return readPreferences();
}

function farmLevel() {
  try {
    return playerLevel(farmSettings().level);
  } catch {
    return null;
  }
}

function toast(message) {
  $('toast-message').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout((() => $('toast').classList.remove('show')), 4e3);
}

function modal(title, html) {
  refreshLevelView = null;
  $('modal-title').textContent = title;
  $('modal-content').innerHTML = html;
  $('modal-content').onclick = null;
  if (!$('modal').open) $('modal').showModal();
  $('modal').scrollTop = 0;
}

$('close-modal').onclick = () => $('modal').close();

$('modal').addEventListener('click', (event => {
  if (event.target !== $('modal')) return;
  const r = $('modal').getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('modal').close();
}));

function viewReview(value) {
  reviewing = value && results.length > 0;
  $('photos-panel').hidden = reviewing;
  $('results-panel').hidden = !reviewing;
  $('photos-step').classList.toggle('active', !reviewing);
  $('review-step').classList.toggle('active', reviewing);
}

$('photos-step').onclick = () => viewReview(false);

$('review-step').onclick = () => viewReview(true);

$('scanner-tab').onclick = () => viewReview(results.length > 0);

function updateButtons() {
  const ready = !!scanner;
  $('scan-button').disabled = !uploads.length || scanning || loadingPhotos || startingScanner || !ready || !catalog.length;
  $('scanner-retry').disabled = startingScanner;
  $('add-photos').disabled = scanning || loadingPhotos;
  $('scan-button-label').textContent = uploads.length ? `Scan ${uploads.length} ${uploads.length === 1 ? 'photo' : 'photos'}` : 'Scan photos';
  $('scan-hint').textContent = startingScanner ? 'Starting scanner…' : 'Photos stay on your device';
}

function progress(value, message) {
  $('progress').value = value;
  $('progress-text').textContent = message;
}

function selectedUpload() {
  return uploads[Number($('calibration-image').value) || 0];
}

function renderUploads(selected = 0) {
  $('image-count').textContent = uploads.length;
  $('calibration').hidden = !uploads.length;
  $('upload-label').textContent = uploads.length ? 'Add more photos' : 'Add barn photos';
  $('upload-list').innerHTML = uploads.map(((upload, index) => `<div class="upload-thumb ${index === selected ? 'active' : ''}" data-upload="${index}" tabindex="0" role="button" aria-label="Align photo ${index + 1}"><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="${upload.url}" alt="Photo ${index + 1}"><span class="upload-name">Photo ${index + 1}</span><button data-remove="${index}" aria-label="Remove photo ${index + 1}">${icon('close')}</button></div>`)).join('');
  $('calibration-image').innerHTML = uploads.map(((upload, index) => `<option value="${index}">Photo ${index + 1}</option>`)).join('');
  if (uploads.length) {
    $('calibration-image').value = Math.min(selected, uploads.length - 1);
    showLayout();
  }
  updateButtons();
}

async function addFiles(files) {
  if (scanning || loadingPhotos) return;
  loadingPhotos = true;
  updateButtons();
  viewReview(false);
  try {
    for (const file of files) {
      if (uploads.length >= MAX_IMAGES) {
        toast(`Use up to ${MAX_IMAGES} photos per scan`);
        break;
      }
      if (![ 'image/png', 'image/jpeg', 'image/webp' ].includes(file.type) || file.size > 12 * 1024 * 1024) {
        toast('Choose PNG, JPG or WebP photos under 12 MB');
        continue;
      }
      const url = URL.createObjectURL(file), image = new Image;
      try {
        await new Promise(((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = url;
        }));
        if (image.width * image.height > 2e7 || uploads.reduce(((sum, x) => sum + x.image.width * x.image.height), 0) + image.width * image.height > 8e7) throw new Error('Scan fewer or smaller photos');
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), groupId = Array.from(digest, (x => x.toString(16).padStart(2, '0'))).join('');
        if (uploads.some((upload => upload.groupId === groupId))) {
          URL.revokeObjectURL(url);
          continue;
        }
        uploads.push({
          file: file,
          url: url,
          image: image,
          layout: detectLayout(image),
          groupId: groupId,
          preset: 'auto'
        });
      } catch (error) {
        URL.revokeObjectURL(url);
        toast(error.message || 'This photo could not be opened');
      }
    }
  } finally {
    loadingPhotos = false;
    renderUploads();
  }
}

$('screenshots').onchange = event => {
  addFiles(Array.from(event.target.files));
  event.target.value = '';
};

$('add-photos').onclick = () => {
  viewReview(false);
  $('screenshots').click();
};

for (const event of [ 'dragenter', 'dragover' ]) $('drop-zone').addEventListener(event, (ev => {
  ev.preventDefault();
  $('drop-zone').classList.add('dragover');
}));

for (const event of [ 'dragleave', 'drop' ]) $('drop-zone').addEventListener(event, (ev => {
  ev.preventDefault();
  $('drop-zone').classList.remove('dragover');
  if (event === 'drop') addFiles(Array.from(ev.dataTransfer.files));
}));

function clickUpload(event) {
  if (scanning || loadingPhotos) return;
  const remove = event.target.closest('[data-remove]');
  if (remove) {
    const index = Number(remove.dataset.remove), [upload] = uploads.splice(index, 1);
    URL.revokeObjectURL(upload.url);
    renderUploads(Math.max(0, index - 1));
    return;
  }
  const thumb = event.target.closest('[data-upload]');
  if (thumb) {
    $('calibration-image').value = thumb.dataset.upload;
    $('calibration').open = true;
    showLayout();
  }
}

$('upload-list').onclick = clickUpload;

$('upload-list').onkeydown = event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    clickUpload(event);
  }
};

function showLayout() {
  const upload = selectedUpload();
  if (!upload) return;
  const layout = upload.layout;
  for (const key of [ 'x', 'y', 'w', 'h' ]) $('crop-' + key).value = +(layout[key] * 100).toFixed(1);
  $('grid-cols').value = layout.cols;
  $('grid-rows').value = layout.rows;
  $('skip-edge').checked = layout.skipEdge;
  $('layout-preset').value = upload.preset;
  $('layout-status').textContent = `${layout.cols} columns · ${layout.rows} rows`;
  document.querySelectorAll('[data-upload]').forEach((thumb => thumb.classList.toggle('active', Number(thumb.dataset.upload) === Number($('calibration-image').value))));
  drawPreview();
}

function drawPreview() {
  const upload = selectedUpload();
  if (!upload) return;
  const canvas = $('image-preview'), image = upload.image, layout = upload.layout;
  canvas.width = Math.min(1100, image.width);
  canvas.height = Math.round(image.height / image.width * canvas.width);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#fafafa';
  ctx.fillStyle = '#fafafa14';
  ctx.lineWidth = 1.5;
  for (let row = 0; row < layout.rows; row++) for (let col = 0; col < layout.cols; col++) {
    const x = (layout.x + col * layout.w / layout.cols) * canvas.width, y = (layout.y + row * layout.h / layout.rows) * canvas.height, w = layout.w / layout.cols * canvas.width, h = layout.h / layout.rows * canvas.height;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
}

function updateLayout() {
  const upload = selectedUpload();
  if (!upload) return;
  const next = {
    ...upload.layout
  };
  for (const key of [ 'x', 'y', 'w', 'h' ]) next[key] = Number($('crop-' + key).value) / 100;
  next.cols = Number($('grid-cols').value);
  next.rows = Number($('grid-rows').value);
  next.skipEdge = $('skip-edge').checked;
  if (![ next.x, next.y, next.w, next.h ].every(Number.isFinite) || next.x < 0 || next.y < 0 || next.w < .05 || next.h < .05 || next.x + next.w > 1.001 || next.y + next.h > 1.001 || !Number.isInteger(next.cols) || next.cols < 1 || next.cols > 8 || !Number.isInteger(next.rows) || next.rows < 1 || next.rows > 12) {
    toast('Keep the grid inside the photo');
    showLayout();
    return;
  }
  delete next.quantityOffsets;
  next.detected = false;
  upload.layout = next;
  upload.preset = 'manual';
  showLayout();
}

$('calibration-image').onchange = showLayout;

for (const id of [ 'crop-x', 'crop-y', 'crop-w', 'crop-h', 'grid-cols', 'grid-rows', 'skip-edge' ]) $(id).onchange = updateLayout;

function resetLayout() {
  const upload = selectedUpload();
  if (!upload) return;
  const preset = $('layout-preset').value;
  upload.preset = [ 'storage', 'shop' ].includes(preset) ? preset : 'auto';
  upload.layout = detectLayout(upload.image, upload.preset);
  showLayout();
}

$('layout-preset').onchange = resetLayout;

$('detect-layout').onclick = () => {
  const upload = selectedUpload();
  if (upload) {
    upload.preset = 'auto';
    $('layout-preset').value = 'auto';
    resetLayout();
  }
};

$('apply-layout').onclick = () => {
  const upload = selectedUpload();
  if (upload) {
    uploads.forEach((other => {
      other.layout = structuredClone(upload.layout);
      other.preset = 'manual';
    }));
    toast('Grid applied to all photos');
  }
};

$('cancel-scan').onclick = () => {
  cancelled = true;
  progress($('progress').value, 'Stopping…');
};

$('scan-button').onclick = async () => {
  if (scanning || loadingPhotos || startingScanner || !uploads.length || !scanner) return;
  scanning = true;
  cancelled = false;
  results = [];
  document.body.classList.add('scan-busy');
  $('scan-progress').hidden = false;
  viewReview(false);
  updateButtons();
  progress(0, 'Reading photos…');
  let skipped = 0;
  try {
    for (let imageIndex = 0; imageIndex < uploads.length; imageIndex++) {
      if (cancelled) break;
      const upload = uploads[imageIndex], prepared = scannerCells(upload.image, upload.layout, upload.preset);
      skipped += prepared.skipped;
      for (let index = 0; index < prepared.cells.length; index++) {
        if (cancelled) break;
        const cell = prepared.cells[index];
        progress((imageIndex + index / prepared.cells.length) / uploads.length * 100, `Photo ${imageIndex + 1} / ${uploads.length} · item ${index + 1} / ${prepared.cells.length}`);
        const prediction = await scanner.predict(cell);
        if (prediction.isZero && options.skipZero) {
          skipped++;
          continue;
        }
        const id = prediction.recognized ? prediction.ranked[0]?.id || '' : '', known = byId.has(id), confidence = prediction.ranked[0]?.score || 0;
        results.push({
          key: crypto.randomUUID(),
          id: id,
          quantity: prediction.quantity,
          ranked: prediction.ranked,
          confidence: confidence,
          quantityConfidence: prediction.quantityConfidence,
          tile: cell.tile,
          numberCrop: cell.numberCrop,
          preview: (cell.preview || cell.tile).toDataURL(),
          source: upload.file.name,
          groupId: upload.groupId,
          confirmed: false,
          enabled: prediction.quantity !== 0,
          note: !known ? 'Choose a tradeable item' : prediction.quantity === null ? 'Check quantity' : prediction.uncertain || prediction.quantityConfidence < .85 ? 'Check reading' : '',
          rect: cell.rect
        });
        await new Promise((resolve => setTimeout(resolve, 0)));
      }
    }
    progress(100, `${cancelled ? 'Stopped · ' : ''}${results.length} items found${skipped ? ' · ' + skipped + ' clipped or empty' : ''}`);
    if (results.length) {
      renderResults();
      viewReview(true);
      $('main').scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    } else toast('No items found · check crop & alignment');
  } catch (error) {
    toast(error.message || 'Scan interrupted');
    if (results.length) {
      renderResults();
      viewReview(true);
    }
  } finally {
    scanning = false;
    document.body.classList.remove('scan-busy');
    updateButtons();
  }
};

function valid(row) {
  return canListScan(row, byId, excluded);
}

function validRows() {
  return results.filter((row => row.confirmed && valid(row)));
}

function output() {
  return scanTradeRows(results, byId, excluded, farmSettings(), options);
}

function updateOutput() {
  const rows = output(), included = results.filter((row => !excluded.has(row.id))), pending = included.filter((row => !row.confirmed && row.enabled)).length;
  $('review-count').textContent = included.length;
  $('review-step').disabled = !results.length;
  $('export-count').textContent = rows.length + ' ready';
  $('output-code').value = serializeItems(rows);
  $('review-banner').textContent = pending ? `${pending} to check` : rows.length ? 'Ready to share' : 'No items to list';
  $('copy-code').disabled = !rows.length;
  $('send-trade').disabled = !rows.length;
  filterResults();
}

function filterResults() {
  const filter = $('review-filter').value;
  for (const element of $('results-body').children) {
    const row = results.find((row => row.key === element.dataset.key));
    if (!row) continue;
    element.hidden = excluded.has(row.id) || (filter === 'pending' ? row.confirmed : filter === 'confirmed' ? !row.confirmed : false);
  }
}

$('review-filter').onchange = filterResults;

function renderResults() {
  const settings = farmSettings();
  $('results-body').classList.toggle('prices-hidden', !options.showPrices);
  $('review-columns').classList.toggle('prices-hidden', !options.showPrices);
  $('review-columns').hidden = !results.some((row => !excluded.has(row.id)));
  $('results-body').innerHTML = results.filter((row => !excluded.has(row.id))).map((row => {
    const item = byId.get(row.id), name = item?.name || row.id.replace(/-/g, ' ') || 'Choose item', price = scannerPrice(row, item, settings, options);
    return `<article class="review-card ${row.confirmed ? 'confirmed' : row.note ? 'needs-check' : ''}" data-key="${row.key}"><input class="confirm-check" type="checkbox" data-confirm ${row.confirmed ? 'checked' : ''} aria-label="Confirm ${e(name)}"><button class="scan-preview" data-preview aria-label="View ${e(name)} crop" title="View crop"><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" class="scan-crop" src="${e(row.preview || imageURL(item?.image || 'assets/favicon.svg'))}" alt="${e(name)} crop"></button><button class="review-item" data-choice title="${e(name)}"><strong>${e(name)}</strong>${row.note && !row.confirmed ? `<small>${e(row.note)}</small>` : ''}</button><button class="remove-row" data-delete aria-label="Remove ${e(name)} from this scan" title="Remove from this scan">${icon('close')}</button><div class="review-controls"><label class="review-quantity"><span>Qty</span><input class="row-quantity" value="${row.quantity ?? ''}" inputmode="numeric" placeholder="?" aria-label="${e(name)} quantity"></label>${options.showPrices && item ? `<label class="scan-price-field"><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="../assets/services/coin.png" alt="coins"><input class="row-price" value="${e(price ? priceLabel(price) : '')}" placeholder="" maxlength="64" aria-label="${e(name)} price each"></label>` : ''}</div></article>`;
  })).join('') || '<p class="empty-note">No items to list.</p>';
  updateOutput();
}

$('results-body').addEventListener('focusin', (event => {
  if (event.target.matches('.row-price')) event.target.select();
}));

$('results-body').onchange = event => {
  const element = event.target.closest('[data-key]');
  if (!element) return;
  const row = results.find((row => row.key === element.dataset.key));
  if (event.target.matches('[data-confirm]')) {
    if (!valid(row)) {
      event.target.checked = false;
      return toast('Choose an item and a positive quantity');
    }
    row.confirmed = event.target.checked;
  }
  if (event.target.classList.contains('row-price')) {
    try {
      const text = event.target.value.trim();
      if (text) checkedPrice(text, byId.get(row.id));
      if (options.rememberPrices) {
        const settings = farmSettings(), prices = {
          ...settings.prices
        };
        if (text) prices[row.id] = text; else delete prices[row.id];
        if (!writePreferences({
          prices: prices
        })) throw new Error('Could not save price');
      }
      results.filter((other => other.id === row.id)).forEach((other => other.priceInput = text));
    } catch (error) {
      toast(error.message);
    }
  }
  if (event.target.classList.contains('row-quantity')) {
    const quantity = Number(event.target.value);
    row.quantity = event.target.value !== '' && Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= 999999 ? quantity : null;
    row.confirmed = false;
    row.enabled = row.quantity !== 0;
    row.note = row.quantity === null ? 'Check quantity' : row.quantity === 0 ? 'Zero stock' : '';
  }
  renderResults();
};

$('results-body').onclick = event => {
  const element = event.target.closest('[data-key]');
  if (!element) return;
  const row = results.find((row => row.key === element.dataset.key));
  if (event.target.closest('[data-preview]')) {
    const item = byId.get(row.id), name = item?.name || 'Item';
    modal(name, `<img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" class="reading-preview" src="${e(row.preview || imageURL(item?.image || 'assets/favicon.svg'))}" alt="${e(name)} screenshot crop">`);
    return;
  }
  if (event.target.closest('[data-delete]')) {
    results = results.filter((x => x.key !== row.key));
    renderResults();
  }
  if (event.target.closest('[data-choice]')) chooseItem(row);
};

$('confirm-all').onclick = () => {
  const rows = results.filter(valid);
  if (!rows.length) return toast('Choose items and quantities first');
  rows.forEach((row => row.confirmed = true));
  renderResults();
  toast(rows.length + ' items checked');
};

function chooseItem(row) {
  const item = byId.get(row.id);
  modal('Choose item', `${row.preview ? `<div class="reading-detail"><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="${e(row.preview)}" alt="Item and full quantity to review"><div><strong>${e(item?.name || 'Check reading')}</strong><small>Match ${Math.round(row.confidence * 100)}% · quantity ${Math.round(row.quantityConfidence * 100)}%</small></div></div>` : ''}<div class="search-wrap">${icon('search')}<input id="review-item-search" type="search" placeholder="Find an item" aria-label="Find an item"></div><div class="choose-item-grid" id="choose-item-grid"></div>`);
  const render = () => {
    const query = $('review-item-search').value.toLowerCase();
    let items = itemsAtLevel(catalog, farmLevel()).filter((item => `${item.name} ${item.id}`.toLowerCase().includes(query)));
    if (!query) items.sort(((a, b) => Number(row.ranked.some((x => x.id === b.id))) - Number(row.ranked.some((x => x.id === a.id))) || a.name.localeCompare(b.name)));
    $('choose-item-grid').innerHTML = items.slice(0, 90).map((item => `<button data-item-id="${item.id}"><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="${e(imageURL(item.image))}" alt="" loading="lazy"><strong>${e(item.name)}</strong></button>`)).join('');
  };
  render();
  $('review-item-search').oninput = render;
  $('choose-item-grid').onclick = event => {
    const button = event.target.closest('[data-item-id]');
    if (button) {
      row.id = button.dataset.itemId;
      delete row.priceInput;
      row.confirmed = false;
      row.note = row.quantity === null ? 'Check quantity' : '';
      renderResults();
      $('modal').close();
    }
  };
  setTimeout((() => $('review-item-search')?.focus()), 40);
}

$('add-manual').onclick = () => {
  const row = {
    key: crypto.randomUUID(),
    id: '',
    quantity: 1,
    ranked: [],
    confidence: 0,
    quantityConfidence: 0,
    tile: null,
    numberCrop: null,
    preview: null,
    source: 'Manual',
    groupId: crypto.randomUUID(),
    confirmed: false,
    enabled: true,
    note: 'Choose item'
  };
  results.push(row);
  $('review-filter').value = 'all';
  renderResults();
  viewReview(true);
  chooseItem(row);
};

async function copyCode() {
  const rows = output();
  if (!rows.length) return toast('Confirm an item first');
  try {
    await copyText(serializeItems(rows));
    toast('List copied');
  } catch (error) {
    toast(error.message);
  }
}

$('copy-code').onclick = copyCode;

$('copy-text').onclick = copyCode;

$('download-code').onclick = () => {
  const rows = output();
  if (!rows.length) return toast('Confirm an item first');
  downloadFile('haydex-stock.json', JSON.stringify({
    version: 1,
    items: rows
  }, null, 2));
};

function goTrade(action) {
  if (embedded) {
    parent.postMessage({
      type: 'hayday-action',
      action: action
    }, location.origin);
    return;
  }
  if (scanning || startingScanner) return toast('Wait for the current task');
  try {
    if (action) sessionStorage.setItem('hayday.open-action', action);
    location.href = '../';
  } catch {
    toast('Device storage is unavailable');
  }
}

$('scanner-home').onclick = () => goTrade();

$('send-trade').onclick = () => {
  const rows = output();
  if (!rows.length) return toast('Confirm an item first');
  try {
    if (embedded) parent.postMessage({
      type: 'hayday-transfer',
      code: serializeItems(rows)
    }, location.origin); else {
      sessionStorage.setItem('hayday.scan-transfer', serializeItems(rows));
      location.href = '../';
    }
  } catch {
    toast('Copy your list to continue');
  }
};

$('open-saved').onclick = () => goTrade('lists');

$('open-farm').onclick = () => goTrade('farm');

$('open-prices').onclick = () => goTrade('prices');

$('preview-card').onclick = () => goTrade('image');

$('export-training').onclick = async () => {
  const rows = validRows().filter((row => row.tile && row.numberCrop));
  if (!rows.length) return toast('Check photo readings first');
  const files = [], labels = [], stamp = Date.now().toString(36);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], tile = `crops/${stamp}-${i}.png`, digit = `digits/${stamp}-${i}.png`;
    files.push({
      name: tile,
      data: await new Promise((resolve => row.tile.toBlob(resolve, 'image/png')))
    }, {
      name: digit,
      data: await new Promise((resolve => row.numberCrop.toBlob(resolve, 'image/png')))
    });
    labels.push({
      image: tile,
      number_image: digit,
      id: row.id,
      quantity: row.quantity,
      group: row.groupId,
      split: 'train',
      source: row.source
    });
  }
  files.push({
    name: 'labels.json',
    data: JSON.stringify({
      version: 1,
      labels: labels
    }, null, 2)
  });
  downloadFile('haydex-corrections.zip', await makeZip(files), 'application/zip');
};

function ready() {
  $('scanner-status').textContent = 'Ready on device';
  $('scanner-dot').classList.add('ready');
  $('scanner-error').hidden = true;
  $('scanner-retry').hidden = true;
  updateButtons();
}

async function prepareScanner() {
  if (startingScanner || scanning) return;
  startingScanner = true;
  $('scanner-status').textContent = 'Starting…';
  $('scanner-error').hidden = true;
  updateButtons();
  try {
    scanner = await startScanner();
    for (const item of catalog) {
      const fallback = item.image;
      Object.defineProperty(item, 'image', {configurable: true, get: () => scannerArtwork(item.id) || fallback});
    }
    ready();
  } catch (error) {
    scanner = null;
    $('scanner-status').textContent = 'Unavailable';
    $('scanner-error').textContent = error.message || 'Scanner could not start. Please try again.';
    $('scanner-error').hidden = false;
    $('scanner-retry').hidden = false;
  } finally {startingScanner = false; updateButtons();}
}

$('scanner-retry').onclick = () => catalog.length ? prepareScanner() : init();

function saveExclusions(next) {
  if (!storage.set('scanner-excluded-items', [ ...next ])) {
    toast('Could not save exclusions · device storage is full');
    return false;
  }
  excluded = next;
  results.forEach((row => {
    if (excluded.has(row.id)) row.confirmed = false;
  }));
  $('excluded-count').textContent = excluded.size;
  renderResults();
  return true;
}

function exclusionSettings() {
  if (!catalog.length) return toast('Items are still loading');
  modal('Excluded items', `<p class="helper">Checked products stay out of this and future trades. Saved on this device. Uncheck a product to include it again.</p><div class="exclusion-controls"><div class="search-wrap exclusion-search">${icon('search')}<input id="exclusion-search" type="search" placeholder="Find a product" aria-label="Find a product to exclude"></div><label class="exclusion-level">Level<input id="exclusion-level" data-global-level type="number" min="1" max="999" placeholder="All" value="${farmLevel() ?? ''}" aria-label="Filter exclusions by farm level"></label></div><label class="toggle-label"><input id="exclusions-only" type="checkbox">Show excluded only</label><div class="exclusion-list" id="exclusion-list"></div><p class="helper" id="exclusion-summary" role="status"></p><div class="dialog-actions"><button class="button quiet" id="clear-exclusions">Include all again</button><button class="button primary" id="exclusions-done">Done</button></div>`);
  const render = () => {
    const query = $('exclusion-search').value.trim().toLowerCase(), only = $('exclusions-only').checked;
    const items = exclusionItems(catalog, excluded, query, farmLevel(), only);
    $('exclusion-list').innerHTML = items.map((item => `<label class="exclusion-option"><input type="checkbox" data-excluded-id="${e(item.id)}" ${excluded.has(item.id) ? 'checked' : ''}><img crossorigin="anonymous" referrerpolicy="no-referrer" decoding="async" src="${e(imageURL(item.image))}" alt="" loading="lazy"><span>${e(item.name)}</span></label>`)).join('') || '<p class="empty-note">No matching products.</p>';
    $('exclusion-summary').textContent = `${excluded.size} products excluded`;
    $('clear-exclusions').disabled = !excluded.size;
  };
  $('exclusion-search').oninput = render;
  $('exclusions-only').onchange = render;
  refreshLevelView = render;
  bindGlobalLevel($('exclusion-level'));
  $('exclusion-list').onchange = event => {
    const id = event.target.dataset.excludedId;
    if (!byId.has(id)) return;
    const next = new Set(excluded);
    event.target.checked ? next.add(id) : next.delete(id);
    saveExclusions(next);
    render();
  };
  $('clear-exclusions').onclick = () => {
    saveExclusions(new Set);
    render();
  };
  $('exclusions-done').onclick = () => $('modal').close();
  render();
}

$('open-exclusions').onclick = exclusionSettings;

function scanSettings() {
  modal('Scanner settings', `<div class="scanner-settings"><label class="settings-row global-level-row"><span>Farm level<small>Applies everywhere</small></span><input id="scanner-global-level" data-global-level type="number" min="1" max="999" value="${farmLevel() ?? ''}" placeholder="All" aria-label="Global farm level"></label><label class="settings-row"><span>Skip zero stock</span><input id="skip-zero" type="checkbox" ${options.skipZero ? 'checked' : ''}></label><label class="settings-row"><span>Show price controls</span><input id="scan-show-prices" type="checkbox" ${options.showPrices ? 'checked' : ''}></label><label class="settings-row"><span>Use default price<small>For products without a saved price</small></span><input id="scan-default-prices" type="checkbox" ${options.useDefaultPrice ? 'checked' : ''}></label><label class="settings-row"><span>Save edited prices<small>Use them in future scans</small></span><input id="scan-remember-prices" type="checkbox" ${options.rememberPrices ? 'checked' : ''}></label><button class="settings-row exclusion-settings-link" id="settings-exclusions"><span>Excluded items</span><span>${excluded.size} products</span></button><p class="settings-note">Photos are read on your device. Check each result before creating a trade.</p><div class="dialog-actions"><button class="button primary" id="scanner-settings-done">Done</button></div></div>`);
  for (const [id, key] of [ [ 'scan-show-prices', 'showPrices' ], [ 'scan-default-prices', 'useDefaultPrice' ], [ 'scan-remember-prices', 'rememberPrices' ] ]) $(id).onchange = event => {
    const next = {
      ...options,
      [key]: event.target.checked
    };
    if (!storage.set('scanner-options', next)) {
      event.target.checked = options[key];
      return toast('Could not save scanner settings');
    }
    options = next;
    renderResults();
  };
  bindGlobalLevel($('scanner-global-level'));
  $('settings-exclusions').onclick = exclusionSettings;
  const aboutLink = document.createElement('button');
  aboutLink.id = 'scanner-about';
  aboutLink.className = 'settings-row exclusion-settings-link';
  aboutLink.innerHTML = '<span>About</span>' + icon('chevron-right');
  $('scanner-settings-done').parentElement.before(aboutLink);
  aboutLink.onclick = () => {
    modal('About', aboutContent() + '<div class="dialog-actions"><button class="button secondary" id="about-back">Back</button><button class="button primary" id="about-done">Done</button></div>');
    $('about-back').onclick = scanSettings;
    $('about-done').onclick = () => $('modal').close();
  };
  $('skip-zero').onchange = event => {
    options.skipZero = event.target.checked;
    storage.set('scanner-options', options);
  };
  $('scanner-settings-done').onclick = () => $('modal').close();

}

$('scanner-settings').onclick = scanSettings;

$('open-settings').onclick = scanSettings;

function bindGlobalLevel(input) {
  input.onchange = event => {
    try {
      setGlobalLevel(event.target.value);
    } catch (error) {
      toast(error.message);
      event.target.value = farmLevel() ?? '';
    }
  };
}

onPreferencesChange((() => {
  const level = farmLevel();
  $('header-level').textContent = level ? 'Lv. ' + level : 'Level';
  for (const input of document.querySelectorAll('[data-global-level]')) if (document.activeElement !== input) input.value = level ?? '';
  if (catalog.length) renderResults();
  if (refreshLevelView) refreshLevelView();
}));

$('results-body').onkeydown = event => {
  if (event.key === 'Enter' && event.target.matches('input')) {
    event.preventDefault();
    event.target.blur();
  }
};

async function init() {
  try {
    const response = await fetch('../data/catalog.json');
    if (!response.ok) throw new Error('Items could not load');
    catalog = (await response.json()).items;
    byId = new Map(catalog.map((item => [ item.id, item ])));
    excluded = excludedItemIds(storage.get('scanner-excluded-items', []), byId);
    $('excluded-count').textContent = excluded.size;
    const level = farmLevel();
    $('header-level').textContent = level ? 'Lv. ' + level : 'Level';
    renderUploads();
    await prepareScanner();
  } catch (error) {
    toast(error.message);
    $('scanner-status').textContent = 'Unavailable';
    $('scanner-error').hidden = false;
    $('scanner-error').textContent = error.message;
    $('scanner-retry').hidden = false;
  } finally {
    startingScanner = false;
    updateButtons();
  }
}

window.addEventListener('beforeunload', (() => uploads.forEach((upload => URL.revokeObjectURL(upload.url)))));

window.addEventListener('message', (event => {
  if (!embedded || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'hayday-scanner-action') return;
  const action = event.data.action;
  if (action === 'add-photos') $('add-photos').click(); else if (action === 'settings') scanSettings(); else if (action === 'copy') copyCode();
}));

init();
