import {describeItem, matchItem, digitShape, readDigits} from './recognition-core.js';

let items = [], digits = [];
function crop(atlas, width, x, y, size) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) pixels.set(atlas.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + size) * 4), row * size * 4);
  return pixels;
}

self.onmessage = event => {
  const {id, kind, ...data} = event.data;
  try {
    if (kind === 'load') {
      const {index} = data;
      if (index.version !== 1 || index.tile !== 64 || index.columns !== 16 || !Array.isArray(index.items) || index.items.length < 400 || index.items.length > 2000 || new Set(index.items).size !== index.items.length || index.items.some(value => !/^[a-z0-9-]{1,80}$/.test(value))) throw new Error('Item references are unavailable.');
      items = index.items.map((item, i) => ({id: item, feature: describeItem(crop(data.art, data.artWidth, i % index.columns * index.tile, Math.floor(i / index.columns) * index.tile, index.tile), index.tile, index.tile)}));
      digits = index.digits.map((digit, i) => {
        if (!Number.isInteger(digit) || digit < 0 || digit > 9) throw new Error('Invalid number reference.');
        const rgba = crop(data.numbers, data.numberWidth, i * 32, 0, 32), pixels = new Uint8Array(1024);
        for (let p = 0; p < pixels.length; p++) pixels[p] = rgba[p * 4];
        return {digit, shape: digitShape(pixels)};
      });
      if (new Set(digits.map(item => item.digit)).size !== 10) throw new Error('Number references are incomplete.');
      self.postMessage({id, result: true});
    } else if (kind === 'predict') {
      if (!items.length || !digits.length) throw new Error('Scanner is starting. Please try again.');
      const ranked = matchItem(describeItem(data.pixels, data.width, data.height), items), best = ranked[0];
      const uncertain = !best || best.score < .78 || best.score - (ranked[1]?.score || 0) < .035;
      self.postMessage({id, result: {ranked, recognized: !!best && best.score >= .48, uncertain, ...readDigits(data.digits, data.digitCount, digits)}});
    } else throw new Error('Unknown scanner request.');
  } catch (error) {self.postMessage({id, error: error.message || 'Could not read this photo.'});}
};
