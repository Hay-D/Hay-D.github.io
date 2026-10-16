const base = new URL('../', import.meta.url);

export function imageURL(path) {
  return new URL(path, base).href;
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  const register = () => navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), {
    scope: base.pathname
  }).catch((() => {}));
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, {
    once: true
  });
}
