const median = values => {
  const sorted = [ ...values ].sort(((a, b) => a - b));
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

export const fallbackLayouts = {
  shop: {
    x: .257,
    y: .174,
    w: .285,
    h: .646,
    cols: 3,
    rows: 4,
    skipEdge: false,
    kind: 'shop',
    detected: false
  },
  storage: {
    x: .221,
    y: .308,
    w: .56,
    h: .49,
    cols: 4,
    rows: 3,
    skipEdge: false,
    kind: 'storage',
    detected: false
  }
};

export function detectLayoutPixels(data, width, height, requestedKind = 'auto') {
  const size = width * height, mask = new Uint8Array(size), queue = new Int32Array(size);
  for (let i = 0; i < size; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    mask[i] = r > 235 && g > 224 && b > 185 && b < 245 && r - b > 12 && g - b > 6 ? 1 : 0;
  }
  let largest = null;
  for (let index = 0; index < size; index++) {
    if (!mask[index]) continue;
    let head = 0, tail = 1, area = 0, minX = width, minY = height, maxX = 0, maxY = 0;
    queue[0] = index;
    mask[index] = 0;
    while (head < tail) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      area++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const neighbors = [ x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1 ];
      for (const neighbor of neighbors) if (neighbor >= 0 && mask[neighbor]) {
        mask[neighbor] = 0;
        queue[tail++] = neighbor;
      }
    }
    if (area > size * .035 && (!largest || area > largest.area)) largest = {
      area: area,
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1
    };
  }
  if (!largest) return {
    ...fallbackLayouts[requestedKind === 'storage' ? 'storage' : 'shop']
  };
  const panel = largest;
  let streak = 0, usableY = panel.y;
  for (let y = panel.y; y < panel.y + panel.h; y++) {
    let cream = 0;
    for (let x = panel.x; x < panel.x + panel.w; x++) {
      const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 235 && g > 224 && b > 185 && b < 245 && r - b > 12 && g - b > 6) cream++;
    }
    streak = cream / panel.w > .68 ? streak + 1 : 0;
    if (streak === 3) {
      usableY = y - 2;
      break;
    }
  }
  const kind = requestedKind === 'auto' ? panel.w / panel.h > 1.2 ? 'storage' : 'shop' : requestedKind;
  const cols = kind === 'storage' ? 4 : 3, colW = panel.w / cols, expectedPitch = colW * (kind === 'storage' ? .58 : .78);
  const digits = new Uint8Array(size);
  for (let y = usableY + 2; y < panel.y + panel.h - 2; y++) for (let x = panel.x + 2; x < panel.x + panel.w - 2; x++) {
    const i = y * width + x;
    if (Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 238) continue;
    const inColumn = (x - panel.x) % colW / colW;
    if (inColumn < .35 || inColumn > .985) continue;
    let dark = false;
    for (let dy = -3; dy <= 3 && !dark; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const j = ((y + dy) * width + x + dx) * 4;
      if (Math.max(data[j], data[j + 1], data[j + 2]) < 95) {
        dark = true;
        break;
      }
    }
    if (dark) digits[i] = 1;
  }
  const components = [];
  for (let index = 0; index < size; index++) {
    if (!digits[index]) continue;
    let head = 0, tail = 1, area = 0, minX = width, minY = height, maxX = 0, maxY = 0;
    queue[0] = index;
    digits[index] = 0;
    while (head < tail) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      area++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const n = (y + dy) * width + x + dx;
        if (digits[n]) {
          digits[n] = 0;
          queue[tail++] = n;
        }
      }
    }
    const h = maxY - minY + 1, w = maxX - minX + 1;
    if (area >= 5 && h >= Math.max(5, height * .012) && h < expectedPitch * .48 && w <= h * 1.5) components.push({
      y: (minY + maxY) / 2,
      col: Math.min(cols - 1, Math.floor(((minX + maxX) / 2 - panel.x) / colW))
    });
  }
  const clusters = [];
  for (const component of components.sort(((a, b) => a.y - b.y))) {
    let cluster = clusters.at(-1);
    if (!cluster || component.y - median(cluster.points) > Math.max(4, height * .012)) {
      cluster = {
        points: [],
        cols: new Set
      };
      clusters.push(cluster);
    }
    cluster.points.push(component.y);
    cluster.cols.add(component.col);
  }
  const centers = clusters.filter((cluster => cluster.cols.size >= 2)).map((cluster => median(cluster.points)));
  const gaps = centers.slice(1).map(((center, i) => center - centers[i])).filter((gap => gap > expectedPitch * .65 && gap < expectedPitch * 1.35));
  const pitch = median(gaps) || expectedPitch;
  const complete = centers.filter((center => center - usableY >= pitch * .33 && center + pitch * .25 <= panel.y + panel.h + 2));
  const top = complete.length ? Math.max(usableY + 1, complete[0] - pitch * .65) : usableY + Math.min(8, panel.h * .035);
  const rows = Math.max(1, Math.min(12, Math.floor((panel.y + panel.h - top + 2) / pitch)));
  const left = panel.x + 2, w = panel.w - 4, h = Math.min(pitch * rows, height - top - 1);
  const quantityOffsets = Array.from({
    length: rows
  }, ((_, row) => {
    const center = top + (row + .65) * pitch;
    const nearest = centers.reduce(((best, value) => Math.abs(value - center) < Math.abs(best - center) ? value : best), center);
    return Math.max(.1, Math.min(.5, (nearest - top - row * pitch) / pitch - .22));
  }));
  return {
    x: left / width,
    y: top / height,
    w: w / width,
    h: h / height,
    cols: cols,
    rows: rows,
    skipEdge: false,
    kind: kind,
    detected: true,
    quantityRows: complete.length,
    quantityOffsets: quantityOffsets
  };
}

export function detectLayout(image, requestedKind = 'auto') {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = Math.round(image.height / image.width * 720);
  const ctx = canvas.getContext('2d', {
    willReadFrequently: true
  });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return detectLayoutPixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, requestedKind);
}
