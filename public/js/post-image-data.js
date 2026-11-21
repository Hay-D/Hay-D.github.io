import {crc32} from '../scanner/zip.js';

const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const encoder = new TextEncoder();
const header = encoder.encode('iTXtHayDexPost\0\0\0\0\0');
const maxBytes = 192 * 1024;
const afterHeader = 33;

export function imagePost(rows, exchanges, options, details) {
  // Only include fields shown in this export. In particular hidden prices and
  // farm profile fields should not travel in a PNG.
  const shownRow = row => ({
    id: row.id,
    ...(options.quantities && {quantity: row.quantity}),
    ...(options.prices && row.price !== undefined && !row.unpriced ? {
      price: row.price, mode: row.mode, ...(row.ratio && {ratio: row.ratio})
    } : {unpriced: true})
  });
  return {
    name: 'Imported image',
    mode: exchanges ? 'trade' : details.mode === 'buy' ? 'buy' : 'sell',
    partials: details.partials,
    items: rows.map(shownRow),
    swaps: exchanges ? exchanges.map(({have, want, ratio, terms}) => ({
      have: have.map(shownRow), want: want.map(shownRow), ratio, terms
    })) : [],
    ...(options.caption && {image: {captionText: options.captionText}}),
    ...(options.totals && details.discount && {discount: details.discount})
  };
}

export function withPostData(png, post) {
  const payload = encoder.encode(JSON.stringify({version: 1, post}));
  if (payload.length > maxBytes) return png;
  const chunk = new Uint8Array(header.length + payload.length + 8);
  chunk.set(header, 4);
  chunk.set(payload, header.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, chunk.length - 12);
  view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)));
  return new Blob([png.slice(0, afterHeader), chunk, png.slice(afterHeader)], {type: 'image/png'});
}

export async function readPostData(file) {
  const bytes = new Uint8Array(await file.slice(0, maxBytes + afterHeader + header.length + 8).arrayBuffer());
  if (!signature.every((byte, index) => byte === bytes[index])) return null;
  const view = new DataView(bytes.buffer);
  for (let at = afterHeader; at + 12 <= bytes.length;) {
    const end = at + 12 + view.getUint32(at);
    if (end > bytes.length) break;
    if (header.every((byte, index) => byte === bytes[at + 4 + index])) {
      if (crc32(bytes.subarray(at + 4, end - 4)) !== view.getUint32(end - 4)) return null;
      try {
        const data = JSON.parse(new TextDecoder().decode(bytes.subarray(at + 4 + header.length, end - 4)));
        if (data?.version === 1 && Array.isArray(data.post?.items) && Array.isArray(data.post.swaps)) return data.post;
      } catch {}
      return null;
    }
    at = end;
  }
  return null;
}
