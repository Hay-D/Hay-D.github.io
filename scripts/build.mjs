import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {validateMarket} from '../public/js/market-prices.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'public'), dist = resolve(root, 'dist');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const catalog = JSON.parse(await readFile(resolve(source, 'data/catalog.json'), 'utf8'));
if (catalog.items.length < 400 || new Set(catalog.items.map(item => item.id)).size !== catalog.items.length) throw new Error('Item catalog is incomplete');
for (const item of catalog.items) {
  const url = new URL(item.image);
  if (url.origin !== 'https://static.wikia.nocookie.net' || !url.pathname.startsWith('/hayday/images/')) throw new Error('Invalid item artwork: ' + item.name);
  if (item.category === 'Animal feed') await readFile(resolve(source, 'assets/feeds', item.id + '.png'));
}
for (const group of ['bem', 'sem', 'lem']) await readFile(resolve(source, 'assets/sets', group + '-set.png'));
for (const name of ['haydaylogo.svg', 'favicon.svg', 'fonts/dm-sans.woff2', 'fonts/dm-serif-display.woff2', 'services/help.png', 'services/coin.png']) await readFile(resolve(source, 'assets', name));
const references = JSON.parse(await readFile(resolve(source, 'scanner/references/index.json'), 'utf8'));
if (references.version !== 1 || references.tile !== 64 || references.columns !== 16 || references.items.length !== catalog.items.length || new Set(references.items).size !== references.items.length || catalog.items.some(item => !references.items.includes(item.id)) || new Set(references.digits).size !== 10 || references.digits.some(digit => !Number.isInteger(digit) || digit < 0 || digit > 9)) throw new Error('Scanner references do not match the catalog');
const art = await readFile(resolve(source, 'scanner/references/items.webp'));
const digits = await readFile(resolve(source, 'scanner/references/digits.png'));
if (art.byteLength > 2e6 || art.toString('ascii', 8, 12) !== 'WEBP' || digits.byteLength > 1e5 || digits.toString('ascii', 1, 4) !== 'PNG') throw new Error('Scanner reference images are invalid');
validateMarket(JSON.parse(await readFile(resolve(source, 'data/market-prices.json'), 'utf8')));
await rm(dist, {recursive: true, force: true});
await mkdir(dist, {recursive: true});
const excluded = new Set([resolve(source, 'assets/items'), resolve(source, 'ATTRIBUTION.md')]);
await cp(source, dist, {recursive: true, filter: path => !excluded.has(path)});
await cp(resolve(root, 'LICENSE'), resolve(dist, 'LICENSE'));
await writeFile(resolve(dist, '.nojekyll'), '');
console.log(`Built HayDex ${pkg.version}: ${catalog.items.length} items, 3 sets, local image matching.`);
