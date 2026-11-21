const SIDE = 24;
const TOP = 6;
const ROWS = 13;
const SCALES = [.49, .56, .63, .7, .77, .84, .91, .97];
const CENTERS = [.4, .445, .49, .535];
const extras = {
  'bem-set': 'assets/sets/bem-set.png',
  'sem-set': 'assets/sets/sem-set.png',
  'lem-set': 'assets/sets/lem-set.png',
  help: 'assets/services/help.png'
};
let loading;

async function picture(path) {
  const image = new Image();
  image.src = new URL('../' + path, import.meta.url);
  await image.decode();
  return image;
}

function variants(image, x, y, width, height, ctx) {
  ctx.canvas.width = width;
  ctx.canvas.height = height;
  ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
  const art = ctx.getImageData(0, 0, width, height).data;
  let left = width, right = 0, top = height, bottom = 0;
  for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) {
    if (art[(yy * width + xx) * 4 + 3] < 115) continue;
    left = Math.min(left, xx); right = Math.max(right, xx + 1);
    top = Math.min(top, yy); bottom = Math.max(bottom, yy + 1);
  }
  const w = right - left, h = bottom - top;
  const values = [];
  for (const scale of SCALES) for (const center of CENTERS) {
    const pixels = new Uint8Array(SIDE * ROWS * 4);
    const factor = Math.max(w, h) / (scale * SIDE), halfW = w / 2, halfH = h / 2;
    for (let row = 0; row < ROWS; row++) {
      const sy = Math.floor((row + TOP + .5 - SIDE * center) * factor + halfH);
      if (sy < 0 || sy >= h) continue;
      for (let col = 0; col < SIDE; col++) {
        const sx = Math.floor((col + .5 - SIDE * .5) * factor + halfW);
        if (sx < 0 || sx >= w) continue;
        const from = ((sy + top) * width + sx + left) * 4, to = (row * SIDE + col) * 4;
        const alpha = art[from + 3] / 255;
        pixels[to] = Math.round(art[from] * alpha);
        pixels[to + 1] = Math.round(art[from + 1] * alpha);
        pixels[to + 2] = Math.round(art[from + 2] * alpha);
        pixels[to + 3] = art[from + 3];
      }
    }
    values.push(pixels);
  }
  return values;
}

export function postArtwork() {
  if (!loading) loading = (async () => {
    const indexURL = new URL('../scanner/references/index.json', import.meta.url);
    const [index, atlas, supplemental] = await Promise.all([
      fetch(indexURL).then(response => {
        if (!response.ok) throw new Error('Post artwork could not load.');
        return response.json();
      }),
      picture('scanner/references/items.webp'),
      Promise.all(Object.entries(extras).map(async ([id, path]) => [id, await picture(path)]))
    ]);
    const ctx = document.createElement('canvas').getContext('2d', {willReadFrequently: true});
    const {tile, columns, items} = index;
    return [
      ...items.map((id, i) => ({id, poses: variants(atlas, i % columns * tile, Math.floor(i / columns) * tile, tile, tile, ctx)})),
      ...supplemental.map(([id, image]) => ({id, poses: variants(image, 0, 0, image.width, image.height, ctx)}))
    ];
  })().catch(error => {loading = null; throw error;});
  return loading;
}

function compare(values, pixels, focus, red, green, blue) {
  let distance = 0, mass = 0, overlap = 0;
  for (let i = 0; i < focus.length; i++) {
    const p = i * 4, weight = focus[i], alpha = pixels[p + 3];
    if (!weight || (!alpha && !values[p + 3])) continue;
    const a = 1 - alpha / 255;
    const diff = Math.abs(pixels[p] + red * a - values[p]) +
      Math.abs(pixels[p + 1] + green * a - values[p + 1]) +
      Math.abs(pixels[p + 2] + blue * a - values[p + 2]);
    distance += Math.min(300, diff) * weight;
    mass += weight;
    if (alpha > 90 && values[p + 3]) overlap += weight;
  }
  return mass && overlap > 8 ? 1 - distance / (mass * 255) - (1 - overlap / mass) * .11 : 0;
}

// The creator centers the stock artwork in a square. Compare the middle
// of the tile, where the price, quantity and caption do not obscure it.
export function matchPostArtwork(canvas, box, background, number, bank, ctx) {
  const {x, y, size} = box;
  ctx.clearRect(0, 0, SIDE, SIDE);
  ctx.drawImage(canvas, x, y, size, size, 0, 0, SIDE, SIDE);
  const data = ctx.getImageData(0, TOP, SIDE, ROWS).data;
  const weights = new Uint8Array(SIDE * ROWS);
  const [red, green, blue] = background;
  for (let i = 0; i < weights.length; i++) {
    const p = i * 4, xx = (i % SIDE + .5) / SIDE, yy = (Math.floor(i / SIDE) + TOP + .5) / SIDE;
    const coversQuantity = number && xx > number.rect.x - .03 && xx < number.rect.right + .03 &&
      yy > number.rect.y - .038 && yy < number.rect.bottom + .03;
    const coversPrice = yy < .29 && number && Math.max(...number.color.map((channel, c) => Math.abs(channel - data[p + c]))) < 31;
    if (coversQuantity || coversPrice) continue;
    weights[i] = yy >= .32 && yy <= .72 ? 2 : 1;
    data[p + 3] = Math.abs(data[p] - red) + Math.abs(data[p + 1] - green) + Math.abs(data[p + 2] - blue) > 36 ? 255 : 0;
  }
  const rank = [];
  for (const item of bank) {
    let score = 0;
    for (const pose of item.poses) score = Math.max(score, compare(data, pose, weights, red, green, blue));
    rank.push({id: item.id, score});
  }
  return rank.sort((a, b) => b.score - a.score);
}

export function postArtContext() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIDE;
  return canvas.getContext('2d', {willReadFrequently: true});
}
