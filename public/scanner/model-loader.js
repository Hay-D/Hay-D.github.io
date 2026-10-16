import { validateModelManifest, normalizedItem, decodedPrediction } from './model-preprocess.js';

import { modelRequestSources } from './model-source.js';

const base = new URL('../models/v3/', import.meta.url);

const DB = 'hayday-scanner-models', KEY = 'active';

let worker = null, sequence = 0, requests = new Map, manifestInfo = null;

function database() {
  return new Promise(((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('models');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Device storage is unavailable'));
  }));
}

async function cached() {
  let db;
  try {
    db = await database();
    return await new Promise(((resolve, reject) => {
      const request = db.transaction('models').objectStore('models').get(KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }));
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

async function store(bundle) {
  let db;
  try {
    db = await database();
    await new Promise(((resolve, reject) => {
      const transaction = db.transaction('models', 'readwrite');
      transaction.objectStore('models').put(bundle, KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    }));
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

export async function forgetModel() {
  await disposeModel();
  const db = await database();
  try {
    await new Promise(((resolve, reject) => {
      const transaction = db.transaction('models', 'readwrite');
      transaction.objectStore('models').delete(KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    }));
  } finally {
    db.close();
  }
}

function rpc(kind, data = {}, transfers = []) {
  if (!worker) {
    worker = new Worker(new URL('./model-worker.js', import.meta.url));
    worker.onmessage = event => {
      const pending = requests.get(event.data.id);
      if (!pending) return;
      requests.delete(event.data.id);
      clearTimeout(pending.timer);
      event.data.error ? pending.reject(new Error(event.data.error)) : pending.resolve(event.data.result);
    };
    worker.onerror = () => {
      for (const pending of requests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Scanner runtime could not start'));
      }
      requests.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return new Promise(((resolve, reject) => {
    const id = ++sequence, timer = setTimeout((() => {
      requests.delete(id);
      reject(new Error('Scanner took too long. Try fewer photos or reload.'));
    }), 12e4);
    requests.set(id, {
      resolve: resolve,
      reject: reject,
      timer: timer
    });
    worker.postMessage({
      id: id,
      kind: kind,
      ...data
    }, transfers);
  }));
}

export async function disposeModel() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const pending of requests.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Scanner stopped'));
  }
  requests.clear();
}

async function verify(buffer, entry) {
  if (buffer.byteLength !== entry.bytes) throw new Error('Incomplete model download');
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), hash = Array.from(bytes, (x => x.toString(16).padStart(2, '0'))).join('');
  if (hash !== entry.sha256) throw new Error('Model verification failed. Try downloading again.');
}

async function activate(bundle, onProgress) {
  validateModelManifest(bundle.manifest);
  await verify(bundle.items, bundle.manifest.files['items.onnx']);
  await verify(bundle.digits, bundle.manifest.files['digits.onnx']);
  onProgress?.({
    stage: 'starting'
  });
  await rpc('load', {
    items: bundle.items,
    digits: bundle.digits,
    classes: bundle.manifest.classes.length
  }, [ bundle.items, bundle.digits ]);
  return {
    manifest: bundle.manifest,
    async predict(cell) {
      const item = normalizedItem(cell.item, bundle.manifest), digit = cell.digitValues.slice(), data = await rpc('predict', {
        item: item,
        digit: digit,
        digitCount: cell.digitCount
      }, [ item.buffer, digit.buffer ]);
      return decodedPrediction(data.itemLogits, data.digitLogits, bundle.manifest.classes, cell.digitCount);
    }
  };
}

export async function restoreCachedModel(onProgress) {
  const bundle = await cached();
  if (!bundle) return null;
  try {
    const response = await fetch(new URL('manifest.json', base), {
      cache: 'no-cache'
    });
    if (response.ok) {
      const current = validateModelManifest(await response.json());
      if (current.version !== bundle.manifest.version) return null;
    }
  } catch {}
  return activate(bundle, onProgress);
}

async function readManifest() {
  const sources = modelRequestSources('manifest.json');
  for (const {url: url, headers: headers} of sources) {
    const controller = new AbortController, timer = setTimeout((() => controller.abort()), 8e3);
    try {
      const response = await fetch(url, {
        headers: headers,
        signal: controller.signal,
        cache: 'no-cache',
        credentials: 'omit'
      });
      if (!response.ok) continue;
      const manifest = validateModelManifest(await response.json());
      return {
        manifest: manifest,
        bytes: Object.values(manifest.files).reduce(((sum, file) => sum + file.bytes), 0)
      };
    } catch {} finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Scanner model information is unavailable. Please try again.');
}

export function modelInfo() {
  if (!manifestInfo) manifestInfo = readManifest().catch((error => {
    manifestInfo = null;
    throw error;
  }));
  return manifestInfo;
}

async function downloadFrom(source, entry, progress, signal) {
  const response = await fetch(source.url, {
    headers: source.headers,
    signal: signal,
    credentials: 'omit'
  });
  if (!response.ok) {
    await (response.body?.cancel().catch((() => {})));
    if (response.status === 429 || response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') throw new Error('GitHub download limit reached. Try again later.');
    throw new Error(`Model download failed (${response.status}). Please try again.`);
  }
  if (!response.body) {
    const data = await response.arrayBuffer();
    await verify(data, entry);
    progress(data.byteLength);
    return data;
  }
  const reader = response.body.getReader(), bytes = new Uint8Array(entry.bytes);
  let offset = 0;
  try {
    while (true) {
      const {done: done, value: value} = await reader.read();
      if (done) break;
      if (offset + value.length > bytes.length) throw new Error('Unexpected model size');
      bytes.set(value, offset);
      offset += value.length;
      progress(offset);
    }
    if (offset !== bytes.length) throw new Error('Incomplete model download');
  } catch (error) {
    await reader.cancel().catch((() => {}));
    throw error;
  }
  await verify(bytes.buffer, entry);
  return bytes.buffer;
}

async function download(name, manifest, progress, signal) {
  let lastError;
  for (const source of modelRequestSources(name)) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    try {
      return await downloadFrom(source, manifest.files[name], progress, signal);
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw error;
      lastError = error;
      progress(0);
    }
  }
  if (lastError instanceof TypeError) throw new Error('Could not download the scanner model. Check your connection and try again.');
  throw lastError;
}

export async function fetchModel(onProgress, signal) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const {manifest: manifest, bytes: bytes} = await modelInfo();
  let done = 0;
  const items = await download('items.onnx', manifest, (current => onProgress?.({
    stage: 'downloading',
    done: current,
    total: bytes
  })), signal);
  done = items.byteLength;
  const digits = await download('digits.onnx', manifest, (current => onProgress?.({
    stage: 'downloading',
    done: done + current,
    total: bytes
  })), signal);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  onProgress?.({
    stage: 'saving'
  });
  const bundle = {
    manifest: manifest,
    items: items,
    digits: digits
  }, saved = await store(bundle);
  if (saved) navigator.storage?.persist?.().catch((() => {}));
  const model = await activate(bundle, onProgress);
  return {
    model: model,
    saved: saved
  };
}
