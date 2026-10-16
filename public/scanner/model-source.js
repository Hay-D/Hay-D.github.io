const repository = '';

const revision = '';

const base = new URL('../models/v3/', import.meta.url);

const weightNames = new Set([ 'items.onnx', 'digits.onnx' ]);

export function modelDownloadURL(name) {
  if (!weightNames.has(name)) throw new Error('Unknown scanner model file');
  return repository && revision ? `https://raw.githubusercontent.com/${repository}/${revision}/public/models/v3/${name}` : new URL(name, base).href;
}

export function modelRequestSources(name) {
  if (name !== 'manifest.json' && !weightNames.has(name)) throw new Error('Unknown scanner model file');
  const local = {
    url: new URL(name, base).href
  };
  if (!repository || !revision) return [ local ];
  const remote = {
    url: `https://raw.githubusercontent.com/${repository}/${revision}/public/models/v3/${name}`
  };
  return name === 'manifest.json' ? [ local, remote ] : [ remote, local ];
}
