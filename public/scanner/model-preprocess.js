import { extractInventory, extractSingle, CREAM } from './inventory.js';

import { cropCanvas, gridCells } from './canvas.js';

import { reviewBounds } from './review.js';

export function validateModelManifest(manifest) {
  if (manifest.schema_version !== 3 || manifest.item_size !== 224 || manifest.digit_size !== 32 || !Array.isArray(manifest.classes) || !manifest.classes.length || manifest.classes.length > 2e3 || new Set(manifest.classes).size !== manifest.classes.length || manifest.classes.some((id => typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(id)))) throw new Error('Unsupported scanner model');
  if (!Array.isArray(manifest.mean) || manifest.mean.length !== 3 || !manifest.mean.every(Number.isFinite) || !Array.isArray(manifest.std) || manifest.std.length !== 3 || !manifest.std.every((value => Number.isFinite(value) && value > 0))) throw new Error('Invalid model normalization');
  for (const name of [ 'items.onnx', 'digits.onnx' ]) {
    const entry = manifest.files?.[name];
    if (!entry || !Number.isSafeInteger(entry.bytes) || entry.bytes < 100 || entry.bytes > 150 * 1024 * 1024 || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('Model checksums are missing');
  }
  if (!/^[a-z0-9-]{1,80}$/.test(manifest.version || '')) throw new Error('Invalid model version');
  return manifest;
}

export function normalizedItem(canvas, metadata) {
  const size = metadata.item_size, source = canvas.getContext('2d', {
    willReadFrequently: true
  }).getImageData(0, 0, canvas.width, canvas.height);
  let left = 0, top = 0, right = canvas.width, bottom = canvas.height, transparent = false;
  for (let i = 3; i < source.data.length; i += 4) if (source.data[i] < 255) {
    transparent = true;
    break;
  }
  if (transparent) {
    left = canvas.width;
    top = canvas.height;
    right = bottom = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (source.data[(y * canvas.width + x) * 4 + 3] > 0) {
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
    if (right <= left || bottom <= top) {
      left = top = 0;
      right = canvas.width;
      bottom = canvas.height;
    }
  }
  const result = document.createElement('canvas');
  result.width = result.height = size;
  const ctx = result.getContext('2d', {
    willReadFrequently: true
  });
  ctx.fillStyle = `rgb(${CREAM.join(',')})`;
  ctx.fillRect(0, 0, size, size);
  const w = right - left, h = bottom - top, scale = .9 * size / Math.max(w, h), ww = Math.max(1, Math.round(w * scale)), hh = Math.max(1, Math.round(h * scale));
  ctx.drawImage(canvas, left, top, w, h, Math.floor((size - ww) / 2), Math.floor((size - hh) / 2), ww, hh);
  const pixels = ctx.getImageData(0, 0, size, size).data, values = new Float32Array(3 * size * size);
  for (let c = 0; c < 3; c++) for (let i = 0; i < size * size; i++) values[c * size * size + i] = (pixels[i * 4 + c] / 255 - metadata.mean[c]) / metadata.std[c];
  return values;
}

function preparedCell(source, entry) {
  const [x, y, w, h] = entry.icon_box, original = cropCanvas(source, {
    x: x,
    y: y,
    w: w,
    h: h
  }, Math.round(w), Math.round(h));
  const item = cropCanvas(original, {
    x: 0,
    y: 0,
    w: original.width,
    h: original.height
  }, original.width, original.height);
  if (entry.quantity_box) {
    const [qx, qy, qw, qh] = entry.quantity_box;
    const ctx = item.getContext('2d');
    ctx.fillStyle = `rgb(${CREAM.join(',')})`;
    ctx.fillRect(Math.max(0, qx - x - 4), Math.max(0, qy - y - 4), qw + 8, qh + 8);
  }
  const digitValues = new Float32Array(entry.digits.length * 32 * 32);
  entry.digits.forEach(((glyph, index) => glyph.pixels.forEach(((value, i) => digitValues[index * 1024 + i] = value / 255))));
  const numberCrop = entry.quantity_box ? cropCanvas(source, {
    x: entry.quantity_box[0],
    y: entry.quantity_box[1],
    w: entry.quantity_box[2],
    h: entry.quantity_box[3]
  }, 160, 48) : null;
  const preview = cropCanvas(source, reviewBounds(entry.icon_box, entry.quantity_box, source.width, source.height));
  const quantityPreview = entry.quantity_box ? cropCanvas(source, reviewBounds(entry.quantity_box, null, source.width, source.height)) : null;
  return {
    tile: original,
    preview: preview,
    quantityPreview: quantityPreview,
    item: item,
    numberCrop: numberCrop,
    digitValues: digitValues,
    digitCount: entry.digits.length,
    rect: {
      x: x,
      y: y,
      w: w,
      h: h
    }
  };
}

export function modelCells(image, layout, preset = 'auto') {
  const scale = Math.min(1, 1600 / image.width, Math.sqrt(2e6 / (image.width * image.height))), source = document.createElement('canvas');
  source.width = Math.max(1, Math.round(image.width * scale));
  source.height = Math.max(1, Math.round(image.height * scale));
  const ctx = source.getContext('2d', {
    willReadFrequently: true
  });
  ctx.drawImage(image, 0, 0, source.width, source.height);
  if (preset === 'auto' && layout.kind === 'storage') {
    try {
      const extracted = extractInventory(ctx.getImageData(0, 0, source.width, source.height).data, source.width, source.height);
      if (extracted.entries.length) return {
        cells: extracted.entries.map((entry => preparedCell(source, entry))),
        skipped: extracted.skipped.length,
        method: 'v3'
      };
    } catch {}
  }
  const cells = gridCells(source, {
    ...layout
  }).map((cell => {
    const rect = cell.rect, tile = cropCanvas(source, rect, Math.round(rect.w), Math.round(rect.h));
    const extracted = extractSingle(tile.getContext('2d', {
      willReadFrequently: true
    }).getImageData(0, 0, tile.width, tile.height).data, tile.width, tile.height);
    return {
      ...preparedCell(tile, extracted.entries[0]),
      rect: rect
    };
  }));
  return {
    cells: cells,
    skipped: 0,
    method: 'grid'
  };
}

export function probabilities(logits) {
  const max = Math.max(...logits), values = Array.from(logits, (x => Math.exp(x - max))), sum = values.reduce(((a, b) => a + b), 0);
  return values.map((x => x / sum));
}

export function decodedPrediction(itemLogits, digitLogits, classes, digitCount) {
  const ranked = probabilities(itemLogits).map(((score, index) => ({
    id: classes[index],
    score: score
  }))).sort(((a, b) => b.score - a.score)).slice(0, 3);
  let text = '', quantityConfidence = 1;
  for (let index = 0; index < digitCount; index++) {
    const p = probabilities(digitLogits.slice(index * 10, (index + 1) * 10)), score = Math.max(...p);
    text += p.indexOf(score);
    quantityConfidence = Math.min(quantityConfidence, score);
  }
  return {
    ranked: ranked,
    quantity: digitCount ? Number(text) : null,
    quantityConfidence: digitCount ? quantityConfidence : 0,
    isZero: digitCount > 0 && Number(text) === 0
  };
}
