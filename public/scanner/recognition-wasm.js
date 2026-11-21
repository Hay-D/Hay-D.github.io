const GLYPH_SIZE = 1024;

export async function rustScanner(index, art, artWidth, numbers, numberWidth) {
  const response = await fetch(new URL('./recognizer.wasm', import.meta.url));
  if (!response.ok) throw new Error('Scanner engine could not load.');
  const {instance} = await WebAssembly.instantiate(await response.arrayBuffer());
  const engine = instance.exports;

  function input(first, second = new Uint8Array(0)) {
    const length = first.length + second.length;
    const pointer = engine.input_ptr(length);
    if (!pointer) throw new Error('Scan crop is too large.');
    const buffer = new Uint8Array(engine.memory.buffer, pointer, length);
    buffer.set(first);
    buffer.set(second, first.length);
  }

  const glyphs = new Uint8Array(index.digits.length * (GLYPH_SIZE + 1));
  index.digits.forEach((digit, i) => {
    const offset = i * (GLYPH_SIZE + 1);
    glyphs[offset] = digit;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      glyphs[offset + 1 + y * 32 + x] = numbers[((y * numberWidth) + i * 32 + x) * 4];
    }
  });
  input(art, glyphs);
  if (!engine.load_references(artWidth, art.length / (artWidth * 4), index.items.length, index.digits.length)) {
    throw new Error('Scanner references could not be loaded.');
  }
  return {
    predict(cell, skipZero = false) {
      input(cell.pixels, cell.digits);
      const pointer = engine.recognize(cell.width, cell.height, cell.digitCount, skipZero);
      if (!pointer) throw new Error('Invalid item crop.');
      const result = new DataView(engine.memory.buffer, pointer);
      const number = result.getInt32(0, true);
      const quantity = number < 0 ? null : number;
      const quantityConfidence = result.getFloat32(4, true);
      const ranked = Array.from({length: result.getUint32(8, true)}, (_, i) => ({
        id: index.items[result.getUint32(12 + i * 8, true)],
        score: result.getFloat32(16 + i * 8, true)
      }));
      return {ranked, quantity, quantityConfidence, isZero: quantity === 0 && quantityConfidence >= .85};
    },

    extract({pixels, width, height, video = false}) {
      input(pixels);
      const pointer = engine.extract_inventory(width, height, video);
      if (!pointer) throw new Error('Invalid inventory frame.');
      const result = new DataView(engine.memory.buffer, pointer);
      const entries = [], count = result.getUint32(0, true), skipped = result.getUint32(4, true);
      let offset = 8;
      const readBox = () => Array.from({length: 4}, () => {
        const value = result.getUint32(offset, true);
        offset += 4;
        return value;
      });
      for (let i = 0; i < count; i++) {
        const quantity_box = readBox(), icon_box = readBox(), digitCount = result.getUint32(offset, true);
        offset += 4;
        const digits = [];
        for (let digit = 0; digit < digitCount; digit++) {
          const pixels = new Uint8Array(engine.memory.buffer, pointer + offset, GLYPH_SIZE).slice();
          digits.push({pixels});
          offset += GLYPH_SIZE;
        }
        entries.push({icon_box, quantity_box, digits});
      }
      return {entries, skipped};
    }
  };
}
