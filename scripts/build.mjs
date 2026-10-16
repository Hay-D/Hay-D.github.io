import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { createHash } from 'node:crypto';

import { fileURLToPath } from 'node:url';

import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const source = resolve(root, 'public');

const dist = resolve(root, 'dist');

const catalog = JSON.parse(await readFile(resolve(source, 'data/catalog.json'), 'utf8'));

if (catalog.items.length < 400) throw new Error('Item catalog is incomplete');

for (const item of catalog.items) {
  const url = new URL(item.image);
  if (url.origin !== 'https://static.wikia.nocookie.net' || !url.pathname.startsWith('/hayday/images/')) throw new Error('Invalid item artwork: ' + item.name);
}

for (const group of [ 'bem', 'sem', 'lem' ]) await readFile(resolve(source, 'assets/sets', group + '-set.png'));

for (const name of [ 'haydaylogo.svg', 'favicon.svg', 'fonts/dm-sans.woff2', 'fonts/dm-serif-display.woff2', 'services/help.png', 'services/coin.png' ]) await readFile(resolve(source, 'assets', name));

const manifest = JSON.parse(await readFile(resolve(source, 'models/v3/manifest.json'), 'utf8'));

for (const [name, entry] of Object.entries(manifest.files)) {
  if (![ 'items.onnx', 'digits.onnx' ].includes(name)) throw new Error('Unexpected model file');
  const data = await readFile(resolve(source, 'models/v3', name));
  if (data.byteLength !== entry.bytes || createHash('sha256').update(data).digest('hex') !== entry.sha256) throw new Error('Model checksum mismatch: ' + name);
  if (data.byteLength >= 100 * 1024 * 1024) throw new Error('Model exceeds GitHub’s file size limit');
}

for (const name of [ 'ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm', 'LICENSE' ]) await readFile(resolve(source, 'runtime', name));

await rm(dist, {
  recursive: true,
  force: true
});

await mkdir(dist, {
  recursive: true
});

const excluded = new Set([ resolve(source, 'assets/items'), resolve(source, 'ATTRIBUTION.md') ]);

await cp(source, dist, {
  recursive: true,
  filter: path => !excluded.has(path)
});

const repository = process.env.GITHUB_REPOSITORY || '';

const revision = process.env.GITHUB_SHA || '';

if (repository || revision) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid repository metadata');
  const file = resolve(dist, 'scanner/model-source.js');
  const code = (await readFile(file, 'utf8')).replace('const repository = \'\';', 'const repository = ' + JSON.stringify(repository) + ';').replace('const revision = \'\';', 'const revision = ' + JSON.stringify(revision) + ';');
  await writeFile(file, code);
}

await cp(resolve(root, 'LICENSE'), resolve(dist, 'LICENSE'));

await writeFile(resolve(dist, '.nojekyll'), '');

console.log(`Built HayDex 1.0.0: ${catalog.items.length} items, 3 sets, ${manifest.classes.length} scanner classes.`);
