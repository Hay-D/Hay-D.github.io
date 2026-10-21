const SIZE = 32;

function histogram(data, mask) {
  const bins = new Float32Array(64);
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    const p = i * 3;
    const r = Math.min(3, data[p] * 4 | 0), g = Math.min(3, data[p + 1] * 4 | 0), b = Math.min(3, data[p + 2] * 4 | 0);
    bins[r * 16 + g * 4 + b]++;
    count++;
  }
  if (count) for (let i = 0; i < bins.length; i++) bins[i] /= count;
  return bins;
}

function background(rgba, width, height) {
  const votes = new Map;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const p = (y * width + x) * 4;
    if (rgba[p + 3] < 200) continue;
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    if (r < 230 || g < 218 || b < 160 || r - b < 8 || g - b < 5) continue;
    const key = (r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3);
    const value = votes.get(key) || [0, 0, 0, 0];
    value[0]++; value[1] += r; value[2] += g; value[3] += b;
    votes.set(key, value);
  }
  const winner = [...votes.values()].sort((a, b) => b[0] - a[0])[0];
  return winner ? winner.slice(1).map(value => value / winner[0]) : [255, 249, 221];
}

export function describeItem(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4 || width * height > 4e6) throw new Error('Invalid item crop');
  const mask = new Uint8Array(width * height), labels = new Int32Array(mask.length), queue = new Int32Array(mask.length);
  let transparentPixels = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 128) transparentPixels++;
  const transparent = transparentPixels > width * height * .04;
  const bg = transparent ? null : background(rgba, width, height);
  const edgeX = transparent ? 0 : Math.max(1, Math.floor(width * .015)), edgeY = transparent ? 0 : Math.max(1, Math.floor(height * .015));
  for (let y = edgeY; y < height - edgeY; y++) for (let x = edgeX; x < width - edgeX; x++) {
    const i = y * width + x, p = i * 4;
    if (rgba[p + 3] < 100) continue;
    if (transparent || (rgba[p] - bg[0]) ** 2 + (rgba[p + 1] - bg[1]) ** 2 + (rgba[p + 2] - bg[2]) ** 2 > 225) mask[i] = 1;
  }
  const parts = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    const id = parts.length + 1;
    let head = 0, tail = 1, left = width, top = height, right = 0, bottom = 0;
    queue[0] = i; labels[i] = id;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      const visit = n => {if (mask[n] && !labels[n]) {labels[n] = id; queue[tail++] = n;}};
      if (x) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (y) visit(p - width);
      if (y < height - 1) visit(p + width);
    }
    parts.push({id, area: tail, left, top, right: right + 1, bottom: bottom + 1});
  }
  const usable = parts.filter(part => part.area >= 4 && (transparent || (part.right - part.left > width * .08 && part.bottom - part.top > height * .06)));
  usable.sort((a, b) => b.area - a.area);
  const largest = usable[0], pixels = new Float32Array(SIZE * SIZE * 3), shape = new Uint8Array(SIZE * SIZE);
  if (!largest) return {pixels, shape, histogram: new Float32Array(64), count: 0, aspect: 1};
  const keep = new Set([largest.id]);
  let left = largest.left, top = largest.top, right = largest.right, bottom = largest.bottom;
  for (const part of parts) {
    if (part.id === largest.id || part.area < largest.area * .025 || part.right < largest.left - width * .12 || part.left > largest.right + width * .12 || part.bottom < largest.top - height * .12 || part.top > largest.bottom + height * .12) continue;
    if (!transparent && (part.right - part.left < width * .035 || part.bottom - part.top < height * .025)) continue;
    keep.add(part.id);
    left = Math.min(left, part.left); top = Math.min(top, part.top);
    right = Math.max(right, part.right); bottom = Math.max(bottom, part.bottom);
  }
  const w = right - left, h = bottom - top, scale = 28 / Math.max(w, h), dw = Math.max(1, Math.round(w * scale)), dh = Math.max(1, Math.round(h * scale));
  const dx = Math.floor((SIZE - dw) / 2), dy = Math.floor((SIZE - dh) / 2);
  let count = 0;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sx = Math.min(right - 1, left + Math.floor((x + .5) * w / dw)), sy = Math.min(bottom - 1, top + Math.floor((y + .5) * h / dh));
    const source = sy * width + sx, dest = (y + dy) * SIZE + x + dx;
    if (!keep.has(labels[source])) continue;
    shape[dest] = 1; count++;
    for (let c = 0; c < 3; c++) pixels[dest * 3 + c] = rgba[source * 4 + c] / 255;
  }
  return {pixels, shape, histogram: histogram(pixels, shape), count, aspect: w / h};
}

function affinity(a, b) {
  let score = 0;
  for (let i = 0; i < a.length; i++) score += Math.sqrt(a[i] * b[i]);
  return score;
}

function compare(a, b, stride = 1) {
  let best = 0;
  const color = affinity(a.histogram, b.histogram), aspect = Math.exp(-Math.abs(Math.log(a.aspect / b.aspect)) * 1.5);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    let overlap = 0, error = 0;
    for (let y = 1; y < SIZE - 1; y += stride) for (let x = 1; x < SIZE - 1; x += stride) {
      const i = y * SIZE + x, j = (y + dy) * SIZE + x + dx;
      if (!a.shape[i] || !b.shape[j]) continue;
      overlap++;
      for (let c = 0; c < 3; c++) error += Math.abs(a.pixels[i * 3 + c] - b.pixels[j * 3 + c]);
    }
    const shape = Math.min(1, 2 * overlap * stride * stride / (a.count + b.count || 1)), pixels = overlap ? Math.exp(-5 * error / (overlap * 3)) : 0;
    best = Math.max(best, .4 * pixels + .3 * shape + .25 * color + .05 * aspect - .002 * (Math.abs(dx) + Math.abs(dy)));
  }
  return Math.max(0, Math.min(1, best));
}

export function rotateItem(feature, degrees) {
  const size = 48, rgba = new Uint8ClampedArray(size * size * 4), angle = degrees * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - (size - 1) / 2, dy = y - (size - 1) / 2;
    const sx = Math.round(cosine * dx + sine * dy + (SIZE - 1) / 2), sy = Math.round(-sine * dx + cosine * dy + (SIZE - 1) / 2);
    if (sx < 0 || sy < 0 || sx >= SIZE || sy >= SIZE || !feature.shape[sy * SIZE + sx]) continue;
    const source = (sy * SIZE + sx) * 3, dest = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) rgba[dest + c] = Math.round(feature.pixels[source + c] * 255);
    rgba[dest + 3] = 255;
  }
  return describeItem(rgba, size, size);
}

export function matchItem(feature, bank) {
  if (feature.count < 12) return [];
  const candidates = bank.map(template => ({template, quick: affinity(feature.histogram, template.feature.histogram) * .85 + Math.exp(-Math.abs(Math.log(feature.aspect / template.feature.aspect))) * .15})).sort((a, b) => b.quick - a.quick).slice(0, 40);
  const ranked = candidates.map(({template}) => ({id: template.id, score: compare(feature, template.feature), template})).sort((a, b) => b.score - a.score);
  if (ranked[0]?.score < .76 || ranked[0].score - (ranked[1]?.score || 0) < .035) {
    for (const row of ranked) {
      const variants = row.template.variants ||= [-45, -30, -15, 15, 30, 45].map(angle => rotateItem(row.template.feature, angle));
      let bestVariant = variants[0], bestQuick = -1;
      for (const variant of variants) {
        const quick = compare(feature, variant, 2);
        if (quick > bestQuick) {bestQuick = quick; bestVariant = variant;}
      }
      row.score = Math.max(row.score, compare(feature, bestVariant) - .006);
    }
    ranked.sort((a, b) => b.score - a.score);
  }
  return ranked.slice(0, 3).map(({id, score}) => ({id, score}));
}

function popcount(value) {
  value -= value >>> 1 & 0x55555555;
  value = (value & 0x33333333) + (value >>> 2 & 0x33333333);
  return ((value + (value >>> 4) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function digitShape(pixels) {
  const rows = new Uint32Array(32);
  let count = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (pixels[y * 32 + x] > (pixels instanceof Float32Array ? .5 : 127)) {rows[y] |= 1 << x; count++;}
  return {rows, count};
}

export function matchDigit(pixels, bank) {
  const shape = digitShape(pixels), scores = new Float32Array(10);
  if (shape.count < 8) return {digit: null, score: 0, margin: 0};
  for (const ref of bank) {
    let best = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      let overlap = 0;
      for (let y = 0; y < 32; y++) {
        let line = ref.shape.rows[y + dy] || 0;
        if (dx < 0) line >>>= 1;
        if (dx > 0) line <<= 1;
        overlap += popcount(shape.rows[y] & line);
      }
      best = Math.max(best, 2 * overlap / (shape.count + ref.shape.count));
    }
    scores[ref.digit] = Math.max(scores[ref.digit], best);
  }
  const order = [...scores.keys()].sort((a, b) => scores[b] - scores[a]);
  return {digit: order[0], score: scores[order[0]], margin: scores[order[0]] - scores[order[1]]};
}

export function readDigits(pixels, count, bank) {
  if (!Number.isInteger(count) || count < 1 || count > 6 || pixels.length !== count * 1024) return {quantity: null, quantityConfidence: 0, isZero: false};
  let text = '', score = 1;
  for (let i = 0; i < count; i++) {
    const match = matchDigit(pixels.subarray(i * 1024, (i + 1) * 1024), bank);
    if (match.digit === null || match.score < .58) return {quantity: null, quantityConfidence: 0, isZero: false};
    text += match.digit;
    score = Math.min(score, match.score, match.margin < .035 ? .65 : 1);
  }
  const quantity = Number(text);
  return {quantity, quantityConfidence: score, isZero: quantity === 0 && score >= .85};
}
