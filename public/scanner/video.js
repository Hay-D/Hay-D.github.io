const MIB = 1024 * 1024;
export const MAX_VIDEO_SIZE = 250 * MIB;
export const MAX_VIDEO_SECONDS = 180;
const FRAME_INTERVAL = .4;

function waitForVideo(video, event, signal, ready = () => false) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    function finish(error) {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    }
    const done = () => finish();
    const failed = () => finish(new Error('This video could not play. Try an MP4 or WebM screen recording.'));
    const abort = () => finish(signal.reason || new DOMException('Scan stopped.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('The video could not be read. Try a shorter clip.')), 12000);
    video.addEventListener(event, done, {once: true});
    video.addEventListener('error', failed, {once: true});
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    else if (video.error) failed();
  });
}

export async function loadVideo(url) {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  const policyAbort = new AbortController();
  function blocked(event) {
    if (event.effectiveDirective === 'media-src' && (event.blockedURI === 'blob' || event.blockedURI === url)) {
      policyAbort.abort(new Error('This preview blocks video. Restart it with the current HayDex main.py.'));
    }
  }
  document.addEventListener('securitypolicyviolation', blocked);
  video.src = url;
  try {
    await waitForVideo(video, 'loadedmetadata', policyAbort.signal, () => video.readyState >= 1);
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('Choose a complete screen recording.');
    if (video.duration > MAX_VIDEO_SECONDS) throw new Error('Use a video up to 3 minutes long.');
    if (video.videoWidth * video.videoHeight > 9000000) throw new Error('Use a screen recording at 4K or below.');
    await waitForVideo(video, 'loadeddata', policyAbort.signal, () => video.readyState >= 2);
    const thumbnail = document.createElement('canvas');
    thumbnail.width = 160;
    thumbnail.height = Math.round(160 * video.videoHeight / video.videoWidth);
    thumbnail.getContext('2d').drawImage(video, 0, 0, thumbnail.width, thumbnail.height);
    return {video, preview: thumbnail.toDataURL('image/jpeg', .78)};
  } catch (error) {
    releaseVideo(video);
    throw error;
  } finally {
    document.removeEventListener('securitypolicyviolation', blocked);
  }
}

export function releaseVideo(video) {
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function nearlyIdentical(previous, current) {
  if (!previous) return false;
  let difference = 0, changed = 0;
  for (let i = 0; i < current.length; i += 4) {
    const delta = Math.abs(previous[i] - current[i]) + Math.abs(previous[i + 1] - current[i + 1]) +
      Math.abs(previous[i + 2] - current[i + 2]);
    difference += delta;
    if (delta > 40 && ++changed > current.length / 400) return false;
  }
  return difference / current.length < 1.1;
}

function contentBounds(pixels, width, height) {
  const dark = (x, y) => {
    const offset = (y * width + x) * 4;
    return Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 20;
  };
  const band = (limit, samples, at) => {
    let size = 0;
    while (size < limit * .24 && Array.from({length: 16}, (_, i) =>
      at(size, Math.floor((i + .5) * samples / 16))).every(Boolean)) size++;
    return size > 1 && size < limit * .24 ? size : 0;
  };
  const top = band(height, width, (i, x) => dark(x, i));
  const bottom = band(height, width, (i, x) => dark(x, height - i - 1));
  const left = band(width, height, (i, y) => dark(i, y));
  const right = band(width, height, (i, y) => dark(width - i - 1, y));
  return {left: left / width, top: top / height, width: (width - left - right) / width, height: (height - top - bottom) / height};
}

export async function* videoFrames(video, signal) {
  const frame = document.createElement('canvas');
  const scale = Math.min(1, 1600 / video.videoWidth, Math.sqrt(2e6 / (video.videoWidth * video.videoHeight)));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = frame.getContext('2d', {willReadFrequently: true});
  const sample = document.createElement('canvas');
  sample.width = 112;
  sample.height = Math.max(12, Math.round(sample.width * height / width));
  const probe = sample.getContext('2d', {willReadFrequently: true});
  const lastTime = Math.max(0, video.duration - .08);
  const count = Math.ceil(lastTime / FRAME_INTERVAL) + 1;
  let lastPixels;

  try {
    for (let index = 0; index < count; index++) {
      signal.throwIfAborted();
      const time = Math.min(lastTime, index * FRAME_INTERVAL);
      if (Math.abs(video.currentTime - time) > .001 || video.seeking) {
        video.currentTime = time;
        await waitForVideo(video, 'seeked', signal, () => !video.seeking && video.readyState >= 2);
      }
      probe.drawImage(video, 0, 0, sample.width, sample.height);
      const pixels = probe.getImageData(0, 0, sample.width, sample.height).data;
      const distinct = !nearlyIdentical(lastPixels, pixels);
      if (distinct) {
        lastPixels = pixels;
        const bounds = contentBounds(pixels, sample.width, sample.height);
        const w = Math.max(1, Math.round(width * bounds.width)), h = Math.max(1, Math.round(height * bounds.height));
        if (frame.width !== w || frame.height !== h) {frame.width = w; frame.height = h;}
        ctx.drawImage(video, video.videoWidth * bounds.left, video.videoHeight * bounds.top,
          video.videoWidth * bounds.width, video.videoHeight * bounds.height, 0, 0, w, h);
      }
      yield {frame: distinct ? frame : null, index, count, time};
    }
  } finally {
    frame.width = 1;
    frame.height = 1;
  }
}

export function matchMargin(ranked) {
  return (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
}

function sameTile(a, b) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 14;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const pixels = tile => {
    ctx.drawImage(tile, 0, 0, 14, 14);
    return ctx.getImageData(0, 0, 14, 14).data;
  };
  const first = pixels(a), second = pixels(b);
  let delta = 0, art = 0;
  for (let i = 0; i < first.length; i += 4) {
    if (first[i] > 236 && first[i + 1] > 226 && first[i + 2] > 185 &&
        second[i] > 236 && second[i + 1] > 226 && second[i + 2] > 185) continue;
    delta += Math.abs(first[i] - second[i]) + Math.abs(first[i + 1] - second[i + 1]) + Math.abs(first[i + 2] - second[i + 2]);
    art++;
  }
  return art >= 12 && delta / (art * 3) < 17;
}

function isDuplicate({row, samples}, winners) {
  if (row.videoTime === undefined || row.quantity === null || matchMargin(row.ranked) >= .045) return false;
  const [first, ...alternatives] = row.ranked;
  return alternatives.some(({id, score}) => {
    const other = winners.get(id), next = other?.row;
    if (!next || first.score - score >= .06 || matchMargin(next.ranked) < .045 ||
        next.groupId !== row.groupId || next.quantity !== row.quantity ||
        Math.abs(next.rect.x - row.rect.x) > row.rect.w * .24 ||
        Math.abs(next.videoTime - row.videoTime) > 1.6 ||
        [...samples].some(sample => other.samples.has(sample))) return false;
    return sameTile(row.tile, next.tile);
  });
}

// Keep competing readings briefly so a blurred frame cannot overwrite
// a clear number. Never add the same item's stock twice.
export function scanObservations() {
  const items = new Map();
  return {
    add(reading, capture, groupId) {
      let quantities = items.get(reading.id);
      if (!quantities) items.set(reading.id, quantities = new Map());
      const quality = reading.confidence * .65 + reading.quantityConfidence * .35 + .2 * Math.min(.12, matchMargin(reading.ranked));
      const previous = quantities.get(reading.quantity);
      const samples = previous?.samples ?? new Set();
      samples.add(groupId + ':' + (reading.videoTime ?? 'photo'));
      if (previous && previous.quality >= quality) return;
      quantities.set(reading.quantity, {row: capture(), quality, samples});
      if (quantities.size > 5) {
        const weakest = [...quantities].sort(([, a], [, b]) => support(a) - support(b))[0][0];
        quantities.delete(weakest);
      }
    },
    rows() {
      const winners = new Map();
      for (const [id, quantities] of items) {
        const readings = [...quantities.values()].sort((a, b) => support(b) - support(a));
        winners.set(id, {...readings[0], readings});
      }
      return [...winners.values()].filter(entry => !isDuplicate(entry, winners)).map(({row, samples, readings}) => {
        const values = readings.filter(({row}) => row.quantity !== null && row.quantityConfidence >= .65)
          .map(({row}) => row.quantity).sort((a, b) => a - b);
        if (values.length > 1) return {...row, note: 'Check quantity (saw ' + values.join(', ') + ')'};
        if (samples.size >= 2 && row.quantity !== null && row.quantityConfidence >= .85 && row.confidence >= .68 &&
            matchMargin(row.ranked) >= .05) return {...row, note: ''};
        return row;
      });
    }
  };
}

function support({row, quality, samples}) {
  return quality + Math.min(samples.size - 1, 5) * .035 + (row.quantity !== null ? .25 : 0);
}
