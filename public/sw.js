const imageCache = 'haydex-images-v1';
const appCache = 'haydex-app-1.1.0';
const appFiles = [
  './', 'index.html', 'app.css', 'editor.css', 'workspace.css',
  'js/core.js', 'js/trade.js', 'js/icons.js', 'js/editor-core.js', 'js/trade-renderer.js', 'js/preferences.js', 'js/selection-draft.js', 'js/branding.js', 'js/about.js', 'js/analytics.js', 'js/images.js', 'js/picker-usage.js', 'js/market-prices.js',
  'scanner/', 'scanner/index.html', 'scanner/scanner.js', 'scanner/scanner.css', 'scanner/review.css', 'scanner/embed.js', 'scanner/review.js', 'scanner/layout.js', 'scanner/inventory.js', 'scanner/canvas.js', 'scanner/zip.js', 'scanner/preprocess.js', 'scanner/recognition.js', 'scanner/recognition-core.js', 'scanner/recognition-worker.js', 'scanner/references/index.json', 'scanner/references/items.webp', 'scanner/references/digits.png',
  'data/catalog.json', 'data/market-prices.json', 'assets/haydaylogo.svg', 'assets/favicon.svg', 'assets/icons.svg', 'assets/services/coin.png', 'assets/services/help.png', 'assets/fonts/dm-sans.woff2', 'assets/fonts/dm-serif-display.woff2',
  ...['bem', 'sem', 'lem'].map(group => `assets/sets/${group}-set.png`),
  ...['chicken-feed', 'cow-feed', 'pig-feed', 'sheep-feed', 'lamb-feed', 'goat-feed', 'wheat-bundle', 'meat-bucket'].map(id => `assets/feeds/${id}.png`)
].map(path => new URL(path, self.location.href).href);
const appURLs = new Set(appFiles);

async function appResponse(request) {
  const key = new URL(request.url); key.search = ''; key.hash = '';
  let cache, saved;
  try {cache = await caches.open(appCache); saved = await cache.match(key.href);} catch {}
  const controller = new AbortController, timer = setTimeout(() => controller.abort(), saved ? 3000 : 20000);
  try {
    const response = await fetch(request, {signal: controller.signal});
    if (response.ok) {
      if (cache) await cache.put(key.href, response.clone()).catch(() => {});
      return response;
    }
    return saved || response;
  } catch (error) {if (saved) return saved; throw error;}
  finally {clearTimeout(timer);}
}

async function requestImage(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(request, {signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

async function imageResponse(request) {
  let cache;
  try {
    cache = await caches.open(imageCache);
    const saved = await cache.match(request);
    if (saved) return {response: saved};
  } catch {}

  let response, failure;
  try {
    response = await requestImage(request);
  } catch (error) {
    failure = error;
  }
  const original = request.url.replace(/\/revision\/.*$/, '');
  if ((!response?.ok || !response.headers.get('Content-Type')?.startsWith('image/')) && original !== request.url) {
    response = await requestImage(new Request(original, {mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'force-cache'}));
  }
  if (!response) throw failure;

  const save = cache && response.ok && response.type !== 'opaque' && response.headers.get('Content-Type')?.startsWith('image/')
    ? cache.put(request, response.clone()).catch(() => {})
    : Promise.resolve();
  return {response, save};
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(appCache);
    await cache.addAll(appFiles);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('haydex-app-') && name !== appCache) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && appURLs.has(url.origin + url.pathname)) {event.respondWith(appResponse(event.request)); return;}
  if (event.request.method !== 'GET' || url.origin !== 'https://static.wikia.nocookie.net' || !url.pathname.startsWith('/hayday/images/')) return;
  const result = imageResponse(event.request);
  event.respondWith(result.then(value => value.response));
  event.waitUntil(result.then(value => value.save).catch(() => {}));
});
