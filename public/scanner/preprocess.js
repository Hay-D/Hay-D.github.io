import { extractSingle, CREAM } from './inventory.js';

import { cropCanvas, gridCells } from './canvas.js';

import { reviewBounds } from './review.js';

function preparedCell(source, entry, clip = false) {
  const [x, y, w, h] = entry.icon_box;
  const original = cropCanvas(source, {x, y, w, h});
  const left = clip ? Math.max(0, Math.floor(x - w * .14)) : x;
  const top = clip ? Math.max(0, Math.floor(y - h * .08)) : y;
  const item = cropCanvas(source, {x: left, y: top, w: x + w - left, h: y + h - top});
  if (entry.quantity_box) {
    const [qx, qy, qw, qh] = entry.quantity_box;
    const ctx = item.getContext('2d');
    ctx.fillStyle = 'rgb(' + CREAM.join(',') + ')';
    ctx.fillRect(Math.max(0, qx - left - 4), Math.max(0, qy - top - 4), qw + 8, qh + 8);
  }
  const digitPixels = new Uint8Array(entry.digits.length * 32 * 32);
  entry.digits.forEach((glyph, index) => digitPixels.set(glyph.pixels, index * 1024));
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
    quantityBounds: entry.quantity_box,
    rect: {
      x: x,
      y: y,
      w: w,
      h: h
    }
  };
}

// Keep more of the icon when quantity text overlaps it. Apply this crop
// only when the first match is weak or its closest alternatives disagree.
export function retryVideoCrop(source, cell, outline) {
  const {x, y, w, h} = cell.rect;
  const left = Math.max(0, Math.floor(x - w * .30)), top = Math.max(0, Math.floor(y - h * .08));
  const item = cropCanvas(source, {x: left, y: top, w: x + w - left, h: y + h - top});
  const ctx = item.getContext('2d', {willReadFrequently: true});
  const [qx, qy, qw, qh] = cell.quantityBounds;
  const actualX = Math.max(0, qx - left), actualY = Math.max(0, qy - top);
  const right = Math.min(item.width, qx + qw - left), bottom = Math.min(item.height, qy + qh - top);
  const image = ctx.getImageData(0, 0, item.width, item.height);
  const step = Math.max(1, Math.round(qh * outline)), mask = new Uint8Array(item.width * item.height);
  for (let yy = actualY; yy < bottom; yy++) for (let xx = actualX; xx < right; xx++) {
    const pixel = (yy * item.width + xx) * 4;
    if (Math.min(image.data[pixel], image.data[pixel + 1], image.data[pixel + 2]) <= 225) continue;
    for (let dy = Math.max(0, yy - step); dy <= Math.min(item.height - 1, yy + step); dy++) {
      const start = dy * item.width + Math.max(0, xx - step);
      mask.fill(1, start, dy * item.width + Math.min(item.width, xx + step + 1));
    }
  }
  const cream = [...CREAM, 255];
  for (let i = 0; i < mask.length; i++) if (mask[i]) image.data.set(cream, i * 4);
  ctx.putImageData(image, 0, 0);
  return {item, digitPixels: new Uint8Array(0), digitCount: 0};
}

export function scanCanvas(image) {
  const scale = Math.min(1, 1600 / image.width, Math.sqrt(2e6 / (image.width * image.height))), source = document.createElement('canvas');
  source.width = Math.max(1, Math.round(image.width * scale));
  source.height = Math.max(1, Math.round(image.height * scale));
  const ctx = source.getContext('2d', {
    willReadFrequently: true
  });
  ctx.drawImage(image, 0, 0, source.width, source.height);
  return source;
}

export async function scannerCells(image, layout, preset, scanner) {
  const source = preset === 'video' ? image : scanCanvas(image);
  if (preset === 'video' || (preset === 'auto' && layout.kind === 'storage')) {
    const ctx = source.getContext('2d');
    const extracted = await scanner.inventory(ctx.getImageData(0, 0, source.width, source.height).data, source.width, source.height, preset === 'video');
    if (extracted.entries.length || preset === 'video') return {
      cells: extracted.entries.map(entry => preparedCell(source, entry, preset === 'video')),
      skipped: extracted.skipped,
      method: 'inventory'
    };
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

