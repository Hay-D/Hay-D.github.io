import { extractInventory, extractSingle, CREAM } from './inventory.js';

import { cropCanvas, gridCells } from './canvas.js';

import { reviewBounds } from './review.js';

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
  const digitPixels = new Uint8Array(entry.digits.length * 32 * 32);
  entry.digits.forEach(((glyph, index) => glyph.pixels.forEach(((value, i) => digitPixels[index * 1024 + i] = value))));
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
    digitPixels: digitPixels,
    digitCount: entry.digits.length,
    rect: {
      x: x,
      y: y,
      w: w,
      h: h
    }
  };
}

export function scannerCells(image, layout, preset = 'auto') {
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
        method: 'inventory'
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

