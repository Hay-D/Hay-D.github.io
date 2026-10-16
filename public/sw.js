const imageCache = 'haydex-images-v1';

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
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== 'https://static.wikia.nocookie.net' || !url.pathname.startsWith('/hayday/images/')) return;
  const result = imageResponse(event.request);
  event.respondWith(result.then(value => value.response));
  event.waitUntil(result.then(value => value.save).catch(() => {}));
});
