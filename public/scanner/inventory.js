export const CREAM = [ 255, 249, 221 ];

function components(mask, width, height) {
  const labels = new Int32Array(mask.length), queue = new Int32Array(mask.length), stats = [];
  let id = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    id++;
    let head = 0, tail = 1, left = width, top = height, right = 0, bottom = 0;
    queue[0] = i;
    labels[i] = id;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      const visit = n => {
        if (mask[n] && !labels[n]) {
          labels[n] = id;
          queue[tail++] = n;
        }
      };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (y > 0) visit(p - width);
      if (y < height - 1) visit(p + width);
    }
    stats.push({
      id: id,
      x: left,
      y: top,
      w: right - left + 1,
      h: bottom - top + 1,
      area: tail
    });
  }
  return {
    labels: labels,
    stats: stats
  };
}

function roundEven(value) {
  const low = Math.floor(value), remainder = value - low;
  return remainder === .5 ? low % 2 ? low + 1 : low : Math.round(value);
}

export function normalizeGlyph(labels, width, glyph) {
  const scale = 26 / Math.max(glyph.w, glyph.h);
  const w = Math.max(1, roundEven(glyph.w * scale)), h = Math.max(1, roundEven(glyph.h * scale));
  const out = new Uint8Array(32 * 32), dx = Math.floor((32 - w) / 2), dy = Math.floor((32 - h) / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = glyph.x + Math.floor(x * glyph.w / w), sy = glyph.y + Math.floor(y * glyph.h / h);
    out[(dy + y) * 32 + dx + x] = labels[sy * width + sx] === glyph.id ? 255 : 0;
  }
  return out;
}

export function extractInventory(data, width, height) {
  const creamMask = new Uint8Array(width * height);
  for (let i = 0; i < creamMask.length; i++) {
    const p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2];
    creamMask[i] = r > 235 && g > 225 && b > 170 && b < 245 && g - b > 8 ? 1 : 0;
  }
  const cream = components(creamMask, width, height);
  const panel = cream.stats.reduce(((best, s) => !best || s.area > best.area ? s : best), null);
  if (!panel || panel.area < width * height * .04 || panel.w < width * .15) {
    throw new Error('No inventory panel found. Use a clear barn or silo screenshot.');
  }
  const white = new Uint8Array(panel.w * panel.h);
  for (let y = 0; y < panel.h; y++) for (let x = 0; x < panel.w; x++) {
    const p = ((y + panel.y) * width + x + panel.x) * 4;
    white[y * panel.w + x] = Math.min(data[p], data[p + 1], data[p + 2]) > 225 ? 1 : 0;
  }
  const letters = components(white, panel.w, panel.h), glyphs = [];
  for (const s of letters.stats) {
    if (!(s.h > height * .038 && s.h < height * .072 && s.w > s.h * .1 && s.w < s.h * 1.05 && s.area > .12 * s.w * s.h)) continue;
    const isNear = (x, y, radius) => {
      for (let yy = Math.max(0, y - radius); yy <= Math.min(panel.h - 1, y + radius); yy++) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(panel.w - 1, x + radius); xx++) {
          if (letters.labels[yy * panel.w + xx] === s.id) return true;
        }
      }
      return false;
    };
    let ring = 0, black = 0;
    const thin = s.h < 18;
    for (let y = Math.max(0, s.y - 2); y < Math.min(panel.h, s.y + s.h + 2); y++) {
      for (let x = Math.max(0, s.x - 2); x < Math.min(panel.w, s.x + s.w + 2); x++) {
        if (isNear(x, y, thin ? 0 : 1) || !isNear(x, y, thin ? 1 : 2)) continue;
        ring++;
        const p = ((y + panel.y) * width + x + panel.x) * 4;
        const maximum = Math.max(data[p], data[p + 1], data[p + 2]);
        if (maximum < (thin ? 220 : 160) && (!thin || maximum - Math.min(data[p], data[p + 1], data[p + 2]) < 50)) black++;
      }
    }
    if (!ring || black / ring < (thin ? .6 : .72)) continue;
    glyphs.push({
      box: [ s.x + panel.x, s.y + panel.y, s.w, s.h ],
      pixels: normalizeGlyph(letters.labels, panel.w, s)
    });
  }
  const rows = [];
  for (const glyph of glyphs.sort(((a, b) => a.box[1] - b.box[1]))) {
    const row = rows.find((r => Math.abs(r[0].box[1] - glyph.box[1]) < glyph.box[3] * .25));
    if (row) row.push(glyph); else rows.push([ glyph ]);
  }
  const groups = [];
  for (const row of rows) {
    let group = [];
    for (const glyph of row.sort(((a, b) => a.box[0] - b.box[0]))) {
      if (group.length) {
        const last = group[group.length - 1].box;
        if (glyph.box[0] - last[0] - last[2] > last[3] * .4) {
          groups.push(group);
          group = [];
        }
      }
      group.push(glyph);
    }
    if (group.length) groups.push(group);
  }
  const entries = [], skipped = [];
  for (const digits of groups) {
    const x = Math.min(...digits.map((g => g.box[0]))), y = Math.min(...digits.map((g => g.box[1])));
    const right = Math.max(...digits.map((g => g.box[0] + g.box[2]))), bottom = Math.max(...digits.map((g => g.box[1] + g.box[3])));
    const h = bottom - y, side = roundEven(h * 2.75), ix = roundEven(right - h * 2.75), iy = roundEven(y - h * 1.18);
    const quantityBox = [ x, y, right - x, h ];
    if (ix < panel.x || iy < panel.y || ix + side > panel.x + panel.w || iy + side > panel.y + panel.h) {
      skipped.push({
        quantity_box: quantityBox,
        reason: 'Partially visible item; use an overlapping screenshot.'
      });
      continue;
    }
    entries.push({
      quantity_box: quantityBox,
      icon_box: [ ix, iy, side, side ],
      digits: digits
    });
  }
  entries.sort(((a, b) => roundEven(a.quantity_box[1] / 10) - roundEven(b.quantity_box[1] / 10) || a.quantity_box[0] - b.quantity_box[0]));
  return {
    panel: [ panel.x, panel.y, panel.w, panel.h ],
    entries: entries,
    skipped: skipped
  };
}

function mergePredictions(observations) {
  const grouped = new Map;
  for (const observation of observations) {
    if (observation.quantity !== null && (!Number.isInteger(observation.quantity) || observation.quantity < 0)) throw new Error('Quantity must be a nonnegative integer or null.');
    if (!grouped.has(observation.item)) grouped.set(observation.item, []);
    grouped.get(observation.item).push(observation);
  }
  const items = [], conflicts = [];
  for (const name of [ ...grouped.keys() ].sort()) {
    const values = grouped.get(name);
    const chosen = [ ...values ].sort(((a, b) => (a.quantity === null) - (b.quantity === null) || (b.confidence || 0) - (a.confidence || 0) || (a.image_index || 0) - (b.image_index || 0)))[0];
    items.push({
      item: name,
      quantity: chosen.quantity
    });
    const quantities = [ ...new Set(values.map((v => v.quantity)).filter((v => v !== null))) ].sort(((a, b) => a - b));
    if (quantities.length > 1) conflicts.push({
      item: name,
      quantities: quantities,
      selected: chosen.quantity,
      reason: 'Different readings or inventory changed.'
    });
  }
  return {
    items: items,
    conflicts: conflicts
  };
}

export function extractSingle(data, width, height) {
  const white = new Uint8Array(width * height);
  for (let i = 0; i < white.length; i++) white[i] = Math.min(data[4 * i], data[4 * i + 1], data[4 * i + 2]) > 225 && data[4 * i + 3] > 0 ? 1 : 0;
  const letters = components(white, width, height), glyphs = [];
  for (const s of letters.stats) {
    if (!(s.h >= 8 && s.h <= height * .65 && s.w > s.h * .1 && s.w < s.h * 1.05 && s.area > .12 * s.w * s.h)) continue;
    const near = (x, y, r) => {
      for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(width - 1, x + r); xx++) if (letters.labels[yy * width + xx] === s.id) return true;
      return false;
    };
    let ring = 0, black = 0;
    const thin = s.h < 18;
    for (let y = Math.max(0, s.y - 2); y < Math.min(height, s.y + s.h + 2); y++) for (let x = Math.max(0, s.x - 2); x < Math.min(width, s.x + s.w + 2); x++) {
      if (near(x, y, thin ? 0 : 1) || !near(x, y, thin ? 1 : 2)) continue;
      ring++;
      const p = (y * width + x) * 4, maximum = Math.max(data[p], data[p + 1], data[p + 2]);
      if (maximum < (thin ? 220 : 160) && data[p + 3] > 0 && (!thin || maximum - Math.min(data[p], data[p + 1], data[p + 2]) < 50)) black++;
    }
    if (ring && black / ring >= (thin ? .6 : .72)) glyphs.push({
      box: [ s.x, s.y, s.w, s.h ],
      pixels: normalizeGlyph(letters.labels, width, s)
    });
  }
  const rows = [], groups = [];
  for (const glyph of glyphs.sort(((a, b) => a.box[1] - b.box[1]))) {
    const row = rows.find((r => Math.abs(r[0].box[1] - glyph.box[1]) < glyph.box[3] * .25));
    if (row) row.push(glyph); else rows.push([ glyph ]);
  }
  for (const row of rows) {
    let group = [];
    for (const glyph of row.sort(((a, b) => a.box[0] - b.box[0]))) {
      if (group.length) {
        const last = group[group.length - 1].box;
        if (glyph.box[0] - last[0] - last[2] > last[3] * .4) {
          groups.push(group);
          group = [];
        }
      }
      group.push(glyph);
    }
    if (group.length) groups.push(group);
  }
  groups.sort(((a, b) => {
    const score = g => Math.max(...g.map((v => v.box[0] + v.box[2]))) / width + Math.max(...g.map((v => v.box[1] + v.box[3]))) / height;
    return score(b) - score(a);
  }));
  let digits = groups[0] || [];
  const skipped = groups.length > 1 ? [ {
    reason: 'Several number groups found in a single-item image; review the selected quantity.'
  } ] : [];
  if (digits.some((g => g.box[0] < 2 || g.box[1] < 2 || g.box[0] + g.box[2] > width - 2 || g.box[1] + g.box[3] > height - 2))) {
    skipped.push({
      reason: 'Quantity touches the image edge; use a crop showing the complete number.'
    });
    digits = [];
  }
  let quantityBox = null;
  if (digits.length) {
    digits.sort(((a, b) => a.box[0] - b.box[0]));
    const x = Math.min(...digits.map((g => g.box[0]))), y = Math.min(...digits.map((g => g.box[1]))), r = Math.max(...digits.map((g => g.box[0] + g.box[2]))), b = Math.max(...digits.map((g => g.box[1] + g.box[3])));
    quantityBox = [ x, y, r - x, b - y ];
  }
  return {
    entries: [ {
      icon_box: [ 0, 0, width, height ],
      quantity_box: quantityBox,
      digits: digits
    } ],
    skipped: skipped
  };
}
