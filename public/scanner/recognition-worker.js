import {rustScanner} from './recognition-wasm.js';
import {extractInventory} from './inventory.js';

let engine;

function crop(atlas, width, x, y, size) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) {
    const offset = ((y + row) * width + x) * 4;
    pixels.set(atlas.subarray(offset, offset + size * 4), row * size * 4);
  }
  return pixels;
}

async function compatibilityScanner(index, {art, artWidth, numbers, numberWidth}) {
  const {describeItem, matchItem, digitShape, readDigits} = await import('./recognition-core.js');
  const {tile, columns} = index;
  const items = index.items.map((id, i) => ({
    id, feature: describeItem(crop(art, artWidth, i % columns * tile, Math.floor(i / columns) * tile, tile), tile, tile)
  }));
  const digits = index.digits.map((digit, i) => {
    const rgba = crop(numbers, numberWidth, i * 32, 0, 32);
    return {digit, shape: digitShape(Uint8Array.from({length: 1024}, (_, p) => rgba[p * 4]))};
  });
  return {
    predict(cell, skipZero) {
      const reading = readDigits(cell.digits, cell.digitCount, digits);
      const ranked = skipZero && reading.isZero ? [] : matchItem(describeItem(cell.pixels, cell.width, cell.height), items);
      return {ranked, ...reading};
    },
    extract({pixels, width, height, video}) {
      try {
        const found = extractInventory(pixels, width, height, video);
        return {entries: found.entries, skipped: found.skipped.length};
      } catch {
        return {entries: [], skipped: 0};
      }
    }
  };
}

function predict(cell, skipZero) {
  const result = engine.predict(cell, skipZero), best = result.ranked[0];
  return {
    ...result,
    recognized: !!best && best.score >= .48,
    uncertain: !best || best.score < .78 || best.score - (result.ranked[1]?.score || 0) < .035
  };
}

self.onmessage = async event => {
  const {id, kind, ...data} = event.data;
  try {
    let result;
    if (kind === 'load') {
      const {index, art, artWidth, numbers, numberWidth} = data;
      if (index.version !== 1 || index.tile !== 64 || index.columns !== 16 ||
          !Array.isArray(index.items) || index.items.length < 400 || index.items.length > 2000 ||
          new Set(index.items).size !== index.items.length ||
          index.items.some(value => !/^[a-z0-9-]{1,80}$/.test(value)) ||
          !Array.isArray(index.digits) || new Set(index.digits).size !== 10 ||
          index.digits.some(digit => !Number.isInteger(digit) || digit < 0 || digit > 9)) {
        throw new Error('Scanner references are unavailable.');
      }
      try {
        engine = await rustScanner(index, art, artWidth, numbers, numberWidth);
        result = 'rust';
      } catch {
        engine = await compatibilityScanner(index, data);
        result = 'javascript';
      }
    } else if (!engine) {
      throw new Error('The scanner could not load.');
    } else if (kind === 'predict') {
      result = data.cells.map(cell => predict(cell, data.skipZero));
    } else if (kind === 'inventory') {
      result = engine.extract(data);
    } else {
      throw new Error('Unknown scanner request.');
    }
    self.postMessage({id, result});
  } catch (error) {
    self.postMessage({id, error: error.message || 'Could not read this file.'});
  }
};
