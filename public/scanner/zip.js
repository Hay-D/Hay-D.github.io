const encoder = new TextEncoder;

const table = Array.from({
  length: 256
}, ((_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 3988292384 ^ n >>> 1 : n >>> 1;
  return n >>> 0;
}));

function crc32(data) {
  let crc = 4294967295;
  for (const byte of data) crc = table[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}

function header(size, signature) {
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, signature, true);
  return bytes;
}

export async function makeZip(files) {
  const local = [], central = [];
  let offset = 0, centralSize = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), data = file.data instanceof Blob ? new Uint8Array(await file.data.arrayBuffer()) : encoder.encode(file.data), crc = crc32(data), lh = header(30, 67324752), lv = new DataView(lh.buffer);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 2048, true);
    lv.setUint16(12, 33, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.push(lh, name, data);
    const ch = header(46, 33639248), cv = new DataView(ch.buffer);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 2048, true);
    cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.push(ch, name);
    centralSize += ch.length + name.length;
    offset += lh.length + name.length + data.length;
  }
  const end = header(22, 101010256), view = new DataView(end.buffer);
  view.setUint16(8, files.length, true);
  view.setUint16(10, files.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, offset, true);
  return new Blob([ ...local, ...central, end ], {
    type: 'application/zip'
  });
}
