import {normalizeGlyph} from '../scanner/inventory.js';
import {digitShape, matchDigit} from '../scanner/recognition-core.js';
import {startScanner} from '../scanner/recognition.js';
import {readPostData} from './post-image-data.js';
import {matchPostArtwork, postArtContext, postArtwork} from './post-artwork.js';

function difference(a, offset, color) {
  return Math.max(Math.abs(a[offset] - color[0]), Math.abs(a[offset + 1] - color[1]), Math.abs(a[offset + 2] - color[2]));
}

function rgb(data, offset) {
  return [data[offset], data[offset + 1], data[offset + 2]];
}

// Look for horizontal borders, then check both vertical edges and the bottom.
function boxes(data, width, height, background) {
  const found = [];
  const pixel = (x, y) => (y * width + x) * 4;
  const same = (x, y, color, tolerance) => difference(data, pixel(x, y), color) <= tolerance;
  function onBorder(x, y, color) {
    if (same(x, y, color, 14)) return true;
    const at = pixel(x, y), changes = color.map((value, i) => value - background[i]);
    const major = changes.reduce((best, change, i) => Math.abs(change) > Math.abs(changes[best]) ? i : best, 0);
    const magnitude = changes[major];
    const factor = (data[at + major] - background[major]) / magnitude;
    return factor >= .36 && factor < 2.9 &&
      changes.every((value, i) => Math.abs(data[at + i] - background[i] - factor * value) <= 19);
  }
  function edge(x, y, size, vertical, color) {
    let hits = 0;
    for (let i = 1; i <= 9; i++) {
      const step = Math.round((size - 1) * i / 10);
      const xx = x + (vertical ? 0 : step), yy = y + (vertical ? step : 0);
      if ([-2, -1, 0, 1, 2].some(shift => {
        const sx = xx + (vertical ? shift : 0), sy = yy + (vertical ? 0 : shift);
        return sx >= 0 && sy >= 0 && sx < width && sy < height && onBorder(sx, sy, color);
      })) hits++;
    }
    return hits >= 8;
  }
  function add(left, right, y, color) {
    const size = right - left + 1;
    if (size < 23 || y + size - 4 >= height) return false;
    if (found.some(box => Math.abs(box.y - y) <= 4 && Math.abs(box.x - left) <= 4 && Math.abs(box.size - size) <= 6)) return true;
    if (!edge(left, y, size, true, color) || !edge(right, y, size, true, color)) return false;
    const bottom = [0, -1, 1, -2, 2, -3, 3, -4, 4].find(delta => {
      const row = y + size - 1 + delta;
      return row < height && edge(left, row, size, false, color);
    });
    if (bottom === undefined || color.every((channel, i) => Math.abs(channel - background[i]) < 14)) return false;
    found.push({x: left, y, size});
    return true;
  }

  for (let y = 0; y < height - 22; y++) {
    for (let left = 0; left < width;) {
      const offset = pixel(left, y);
      if (difference(data, offset, background) < 10) {left++; continue;}
      const color = rgb(data, offset);
      let right = left + 1;
      while (right < width && same(right, y, color, 13)) right++;
      if (right - left >= 23 && (y < 3 || !same((left + right) >> 1, y - 3, color, 10))) {
        if (!add(left, right - 1, y, color) && right - left >= 46) {
          // With zero tile spacing, the top of a whole row can be one run.
          let start = left;
          for (let x = left + 20; x < right - 19; x++) {
            if (![7, 13, 20].every(dy => onBorder(x, y + dy, color))) continue;
            let end = x;
            while (end + 1 < right && [7, 13, 20].every(dy => onBorder(end + 1, y + dy, color))) end++;
            if (end - x < 14) {
              const divider = (x + end) >> 1;
              if (add(start, divider, y, color)) start = divider;
            }
            x = end;
          }
          if (start !== left) add(start, right - 1, y, color);
        }
      }
      left = right;
    }
  }

  const sameSize = (a, b) => Math.abs(a.size - b.size) <= Math.max(4, a.size * .045);
  const alignment = new Map(found.map(box => [box, found.filter(other => other !== box && sameSize(other, box) &&
    Math.abs(other.y - box.y) <= Math.max(5, box.size * .035) && Math.abs(other.x - box.x) > box.size * .75).length]));
  const kept = [];
  for (const box of found.sort((a, b) => sameSize(a, b) ? alignment.get(b) - alignment.get(a) || a.y - b.y : b.size - a.size)) {
    const overlaps = kept.some(other => {
      const across = Math.min(box.x + box.size, other.x + other.size) - Math.max(box.x, other.x);
      const down = Math.min(box.y + box.size, other.y + other.size) - Math.max(box.y, other.y);
      return across > 0 && down > 0 && across * down > box.size * box.size * .25;
    });
    if (!overlaps) kept.push(box);
  }
  // Most crops contain one uniform item grid. Prefer a repeated cell size
  // over an isolated square elsewhere in a Discord screenshot.
  const bestSize = kept.reduce((best, box) => {
    const count = kept.filter(other => Math.abs(other.size - box.size) <= Math.max(4, box.size * .045))
      .reduce((area, other) => area + other.size ** 2, 0);
    return count > best.count ? {size: box.size, count} : best;
  }, {size: 0, count: 0}).size;
  const tiles = kept.filter(box => Math.abs(box.size - bestSize) <= Math.max(4, bestSize * .045));
  const close = Math.max(5, bestSize * .045);
  const lines = [];
  for (const tile of tiles.sort((a, b) => a.y - b.y)) {
    if (lines.length && tile.y - lines.at(-1)[0].y <= close) lines.at(-1).push(tile);
    else lines.push([tile]);
  }
  const spacings = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    for (let i = 1; i < line.length; i++) {
      const pitch = line[i].x - line[i - 1].x;
      if (pitch >= bestSize - 2 && pitch <= bestSize * 1.17) spacings.push(pitch);
    }
  }
  spacings.sort((a, b) => a - b);
  const pitch = spacings[Math.floor(spacings.length / 2)];
  const completed = [];
  const touching = Math.abs(pitch - bestSize) <= 5;
  let previous = null;
  for (const line of lines) {
    let y = line.map(box => box.y).sort((a, b) => a - b)[line.length >> 1];
    if (previous && pitch) {
      const cycles = Math.round((y - previous[0].y) / pitch);
      const expected = previous[0].y + cycles * pitch;
      if (Math.abs(y - expected) <= close) {
        if (cycles === 1) y = expected;
        // Closely spaced outlines can share a single stroke. If two full
        // rows confirm its spacing, read any undetected rows between them.
        const sameColumns = line.length > 1 && line.length === previous.length &&
          line.every((box, i) => Math.abs(box.x - previous[i].x) <= close);
        const contiguous = line.every((box, i) => !i || Math.abs(box.x - line[i - 1].x - pitch) <= close);
        if (touching && sameColumns && contiguous && cycles >= 2 && cycles <= 8) {
          for (let step = 1; step < cycles; step++) {
            completed.push(previous.map(box => ({...box, y: box.y + step * pitch})));
          }
          y = expected;
        }
      }
    }
    for (const box of line) {
      if (touching) box.size = Math.min(pitch, width - box.x);
      box.y = Math.min(height - box.size, y);
    }
    completed.push(line);
    previous = line;
  }
  return completed.flat().slice(0, 440);
}

function commonColors(data, width, height, include, stride = 1) {
  const bins = new Map();
  for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) {
    const p = (y * width + x) * 4;
    if (!include(p, x, y)) continue;
    const key = (data[p] >> 3) * 1024 + (data[p + 1] >> 3) * 32 + (data[p + 2] >> 3);
    const bin = bins.get(key) || {n: 0, r: 0, g: 0, b: 0};
    bin.n++; bin.r += data[p]; bin.g += data[p + 1]; bin.b += data[p + 2];
    bins.set(key, bin);
  }
  return [...bins.values()].sort((a, b) => b.n - a.n).map(({n, r, g, b}) => [r / n, g / n, b / n]);
}

function tileBackground(ctx, box) {
  const inset = Math.max(3, Math.round(box.size * .015));
  const size = box.size - 2 * inset;
  const data = ctx.getImageData(box.x + inset, box.y + inset, size, size).data;
  return commonColors(data, size, size, (_p, x, y) =>
    x < size * .07 || x > size * .93 || y < size * .055 || y > size * .975)[0];
}

function collectGlyphs(pixels, width, height, color) {
  const labels = new Uint32Array(width * height), glyphs = [];
  let id = 0;
  const ink = i => color ? difference(pixels, i * 4, color) <= 28 : Math.min(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]) > 193;
  for (let index = 0; index < labels.length; index++) {
    if (labels[index] || !ink(index)) continue;
    id++;
    let left = width, top = height, right = 0, bottom = 0;
    const queue = [index];
    labels[index] = id;
    for (let head = 0; head < queue.length; head++) {
      const value = queue[head], x = value % width, y = Math.floor(value / width);
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
          const next = yy * width + xx;
          if (!labels[next] && ink(next)) {
            labels[next] = id;
            queue.push(next);
          }
        }
      }
    }
    glyphs.push({id, x: left, y: top, w: right - left + 1, h: bottom - top + 1, area: queue.length});
  }
  return {labels, glyphs};
}

function typeReferences() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 94;
  const ctx = canvas.getContext('2d', {willReadFrequently: true}), templates = [];
  for (const font of ['sans-serif', 'Arial', 'system-ui', 'DM Sans']) {
    ctx.font = '700 66px ' + font;
    for (let digit = 0; digit <= 9; digit++) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(digit), 12, 76);
      const {labels, glyphs} = collectGlyphs(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      const glyph = glyphs.sort((a, b) => b.area - a.area)[0];
      if (glyph) templates.push({digit, shape: digitShape(normalizeGlyph(labels, canvas.width, glyph))});
    }
  }
  // Many Android sans-serif faces use a straight 1 without a bottom bar.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(26, 32);
  ctx.lineTo(48, 23);
  ctx.lineTo(59, 23);
  ctx.lineTo(59, 82);
  ctx.lineTo(46, 82);
  ctx.lineTo(46, 38);
  ctx.lineTo(26, 44);
  ctx.fill();
  const straight = collectGlyphs(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  templates.push({digit: 1, shape: digitShape(normalizeGlyph(straight.labels, canvas.width, straight.glyphs[0]))});
  return templates;
}

function quantity(ctx, box, background, references) {
  const {x, y, size} = box, inset = Math.max(2, Math.round(size * .012));
  const offset = Math.floor(size * .56), height = Math.floor(size * .99) - offset;
  const width = size - 2 * inset;
  const data = ctx.getImageData(x + inset, y + offset, width, height).data;
  const colors = commonColors(data, width, height, (p, col) =>
    col >= width * .42 && difference(data, p, background) >= 42).slice(0, 6);
  const readings = [];
  for (const color of colors) {
    const {labels, glyphs} = collectGlyphs(data, width, height, color);
    const candidates = glyphs.filter(glyph => glyph.h >= Math.max(5, size * .048) &&
      glyph.h <= size * .33 && glyph.w >= glyph.h * .12 && glyph.w <= glyph.h * .99 &&
      glyph.y > 0 && glyph.y + glyph.h + offset >= size * .73 && glyph.y + glyph.h < height);
    for (const last of candidates.filter(glyph => {
      const right = (glyph.x + glyph.w + inset) / size;
      return right >= .84 && right <= .982;
    })) {
      const bottom = last.y + last.h, group = [last];
      for (const glyph of candidates.slice().sort((a, b) => b.x - a.x)) {
        if (Math.abs(glyph.h - last.h) > last.h * .22 + 1 ||
            Math.abs(glyph.y + glyph.h - bottom) > last.h * .14 + 1 ||
            glyph.x + glyph.w > group.at(-1).x + 1) continue;
        if (group.at(-1).x - glyph.x - glyph.w > last.h * .65) break;
        group.push(glyph);
      }
      if (group.length > 6) continue;
      group.reverse();
      const numbers = group.map(glyph => matchDigit(normalizeGlyph(labels, width, glyph), references));
      if (numbers.some(result => result.digit === null || result.score < .71 || result.margin < .024)) continue;
      const value = Number(numbers.map(({digit}) => digit).join(''));
      if (!value || value > 999999) continue;
      const match = numbers.reduce((sum, row) => sum + row.score, 0) / numbers.length;
      const rightEdge = (last.x + last.w + inset) / size;
      const baseline = (bottom + offset) / size;
      const position = Math.abs(rightEdge - .945) + .38 * Math.min(Math.abs(baseline - .954), .09);
      const score = match - position * 1.35 + .034 * group.length + Math.min(.08, last.h / size * .55);
      readings.push({
        value, color, score,
        rect: {x: (group[0].x + inset) / size, y: (last.y + offset) / size, right: rightEdge, bottom: baseline}
      });
    }
  }
  return readings.sort((a, b) => b.score - a.score)[0] || null;
}

function itemCrop(source, box, background, reading) {
  const item = document.createElement('canvas');
  item.width = 112;
  item.height = 112;
  const ctx = item.getContext('2d', {willReadFrequently: true});
  const {x, y, size} = box, inset = Math.max(2, size * .024);
  ctx.drawImage(source, x + inset, y + inset, size - 2 * inset, size - 2 * inset, 0, 0, item.width, item.height);
  const image = ctx.getImageData(0, 0, item.width, item.height), rect = reading?.rect;
  for (let i = 0; i < item.width * item.height; i++) {
    const p = i * 4, col = (i % item.width) / item.width, row = Math.floor(i / item.width) / item.height;
    const labelArea = row < .24 && col < .86;
    const isOverlay = labelArea && (
      (reading && difference(image.data, p, reading.color) < 42) ||
      (image.data[p] > 210 && image.data[p + 1] > 168 && image.data[p + 2] < 113)
    );
    const labelInk = reading && row > .88 && difference(image.data, p, reading.color) < 36;
    const numberInk = rect && row >= rect.y - .032 && row <= rect.bottom + .024 && col >= rect.x - .028 && col <= rect.right + .014;
    if (labelInk || numberInk || isOverlay || difference(image.data, p, background) < 19) image.data[p + 3] = 0;
  }
  ctx.putImageData(image, 0, 0);
  return {item, digitPixels: new Uint8Array(0), digitCount: 0};
}

function detectExchanges(tiles, ctx, width, background) {
  const middle = width / 2, cell = tiles[0].size;
  const lines = [];
  for (const tile of tiles) {
    if (Math.abs((lines.at(-1)?.[0].y ?? -width) - tile.y) <= Math.max(4, cell * .04)) lines.at(-1).push(tile);
    else lines.push([tile]);
  }
  function arrow(line, have, want) {
    const left = have.at(-1).x + have.at(-1).size, right = want[0].x;
    if (right - left < Math.max(9, width * .027) || Math.abs((right + left) / 2 - middle) > width * .022) return false;
    const inset = Math.ceil(Math.max(3, (right - left) * .22));
    const top = Math.round(line[0].y + cell * .25), h = Math.round(cell * .5);
    const pixels = ctx.getImageData(left + inset, top, right - left - 2 * inset, h).data;
    let contrast = 0;
    for (let i = 0; i < pixels.length; i += 4) if (difference(pixels, i, background) > 42) contrast++;
    return contrast > Math.max(6, pixels.length / 4 * .012);
  }
  const groups = [];
  for (const line of lines) {
    const have = line.filter(tile => tile.x + tile.size <= middle), want = line.filter(tile => tile.x >= middle);
    if (have.length + want.length !== line.length) return null;
    if (have.length && want.length && arrow(line, have, want)) groups.push({have: [], want: []});
    if (!groups.length) return null;
    groups.at(-1).have.push(...have);
    groups.at(-1).want.push(...want);
  }
  return groups.every(group => group.have.length && group.want.length && group.have.length <= 16 && group.want.length <= 16) && groups.length <= 40 ? groups : null;
}

export async function readPostImage(file) {
  const embedded = await readPostData(file);
  if (embedded) {
    const rows = embedded.items.concat(embedded.swaps.flatMap(exchange => [...exchange.have, ...exchange.want]));
    if (rows.some(row => !Number.isInteger(row.quantity))) {
      throw new Error('Quantities are hidden in this image. Use a post with quantities or paste the post text.');
    }
    return {...embedded, exact: true, warnings: []};
  }
  if (file.size > 20 * 1024 * 1024) throw new Error('Use a JPG, PNG or WebP screenshot under 20 MB.');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url;
    try {await image.decode();} catch {throw new Error('Use a JPG, PNG or WebP post image.');}
    if (!image.width || !image.height || image.width * image.height > 32e6) throw new Error('Use a smaller screenshot.');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2200 / image.width, Math.sqrt(6e6 / (image.width * image.height)));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const {width, height} = canvas, {data} = ctx.getImageData(0, 0, width, height);
    const background = commonColors(data, width, height, () => true, 13)[0];
    const tiles = boxes(data, width, height, background);
    if (!tiles.length) throw new Error('No item grid found. Try the original HayDex PNG or crop the screenshot to the complete post.');
    const groups = detectExchanges(tiles, ctx, width, tileBackground(ctx, tiles[0]));
    await document.fonts?.load('700 66px "DM Sans"').catch(() => {});
    const bank = await postArtwork(), digits = typeReferences(), artCtx = postArtContext(), result = new Map(), warnings = [];
    for (let start = 0; start < tiles.length; start += 6) {
      const batch = tiles.slice(start, start + 6).map(box => {
        const background = tileBackground(ctx, box);
        const reading = quantity(ctx, box, background, digits);
        const ranked = matchPostArtwork(canvas, box, background, reading, bank, artCtx);
        return {box, reading, background, ranked};
      });
      const weak = batch.filter(({ranked: [a, b]}) => a.score < .77 || a.score - b.score < .026);
      if (weak.length) {
        const scanner = await startScanner();
        const predictions = await scanner.predictMany(weak.map(({box, background, reading}) => itemCrop(canvas, box, background, reading)));
        weak.forEach((entry, i) => {entry.fallback = predictions[i];});
      }
      for (const [index, {box, reading, ranked: [best, next], fallback}] of batch.entries()) {
        const alternative = fallback?.ranked[0], position = start + index + 1;
        const margin = best.score - next.score;
        const agree = alternative?.id === best.id && best.score >= .54 &&
          (alternative.score >= .67 || (alternative.score >= .60 && margin >= .09));
        const fallbackStrong = alternative && alternative.score >= .8 && best.score < .66;
        const id = fallbackStrong && !agree ? alternative.id : best.id;
        const supported = best.score >= .72 && margin >= .025 || best.score >= .67 && margin >= .045 || best.score >= .62 && margin >= .1 || agree;
        if (!supported && !fallbackStrong) {
          warnings.push('Tile ' + position + ' could not be identified.');
          continue;
        }
        if (!reading) {
          warnings.push('Tile ' + position + ' (' + id.replaceAll('-', ' ') + ') has an unreadable quantity.');
          continue;
        }
        if (!agree && (fallbackStrong || margin < .07)) {
          warnings.push('Check the item name on tile ' + position + '.');
        }
        result.set(box, {id, quantity: reading.value, unpriced: true});
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!result.size) throw new Error('No whole items and quantities could be read. Use the original PNG or a screenshot with visible quantities.');
    if (groups) {
      const swaps = groups.map(group => ({
        have: group.have.map(tile => result.get(tile)).filter(Boolean),
        want: group.want.map(tile => result.get(tile)).filter(Boolean)
      })).filter(group => group.have.length && group.want.length);
      if (!swaps.length) throw new Error('Neither side of the exchange could be read together. Try the original PNG.');
      if (swaps.length < groups.length) warnings.push('An exchange was skipped because one side could not be read.');
      return {name: 'Imported image', mode: 'trade', items: [], swaps, warnings};
    }
    return {name: 'Imported image', items: [...result.values()], warnings};
  } finally {
    URL.revokeObjectURL(url);
  }
}
