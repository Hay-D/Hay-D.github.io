let worker, sequence = 0, starting, referenceIndex, artwork;
const pending = new Map, previews = new Map;

function stop(error) {
  worker?.terminate(); worker = null; starting = null;
  for (const request of pending.values()) {clearTimeout(request.timer); request.reject(error);}
  pending.clear();
}

function call(kind, data = {}, transfers = []) {
  if (!worker) {
    worker = new Worker(new URL('./recognition-worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = event => {
      const request = pending.get(event.data.id);
      if (!request) return;
      pending.delete(event.data.id); clearTimeout(request.timer);
      event.data.error ? request.reject(new Error(event.data.error)) : request.resolve(event.data.result);
    };
    worker.onerror = () => stop(new Error('Scanner could not start. Reload and try again.'));
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => stop(new Error('Scanner took too long. Try fewer photos.')), 30000);
    pending.set(id, {resolve, reject, timer});
    try {worker.postMessage({id, kind, ...data}, transfers);} catch (error) {stop(error);}
  });
}

async function image(name) {
  const value = new Image;
  value.src = new URL('./references/' + name, import.meta.url).href;
  await value.decode();
  return value;
}
function pixels(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

export function scannerArtwork(id) {
  if (previews.has(id)) return previews.get(id);
  const index = referenceIndex?.items.indexOf(id) ?? -1;
  if (index < 0 || !artwork) return '';
  const size = referenceIndex.tile, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(artwork, index % referenceIndex.columns * size, Math.floor(index / referenceIndex.columns) * size, size, size, 0, 0, size, size);
  const url = canvas.toDataURL('image/png'); previews.set(id, url);
  return url;
}

export function startScanner() {
  if (!starting) starting = (async () => {
    const response = await fetch(new URL('./references/index.json', import.meta.url));
    if (!response.ok) throw new Error('Scanner references could not load.');
    referenceIndex = await response.json();
    const [art, numbers] = await Promise.all([image('items.webp'), image('digits.png')]);
    artwork = art;
    const rgba = pixels(art), glyphs = pixels(numbers);
    await call('load', {index: referenceIndex, art: rgba, artWidth: art.width, numbers: glyphs, numberWidth: numbers.width}, [rgba.buffer, glyphs.buffer]);
    try {indexedDB.deleteDatabase('hayday-scanner-models');} catch {}
    return {
      async predict(cell) {
        await startScanner();
        const rgba = cell.item.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, cell.item.width, cell.item.height).data;
        const digits = cell.digitPixels.slice();
        return call('predict', {pixels: rgba, width: cell.item.width, height: cell.item.height, digits, digitCount: cell.digitCount}, [rgba.buffer, digits.buffer]);
      }
    };
  })().catch(error => {stop(error); throw error;});
  return starting;
}
