const websiteId = 'f5a1c340-c2af-4fca-b28c-8791ddec1171';
const domain = 'hay-d.github.io';

if (typeof window !== 'undefined' && window.parent === window && location.protocol === 'https:' && location.hostname === domain && !document.querySelector(`script[data-website-id="${websiteId}"]`)) {
  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://cloud.umami.is/script.js';
  script.dataset.websiteId = websiteId;
  script.dataset.domains = domain;
  script.dataset.excludeSearch = 'true';
  script.dataset.doNotTrack = 'true';
  document.head.append(script);
}
