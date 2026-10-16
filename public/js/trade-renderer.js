import { number } from './core.js';

import { priceLabel, paymentSummary, imageGrid } from './editor-core.js';

import { PERMANENT_WATERMARK } from './branding.js';

const cache = new Map;

function asset(path) {
  if (!cache.has(path)) cache.set(path, new Promise(((resolve, reject) => {
    const image = new Image;
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => {
      cache.delete(path);
      reject(new Error('Artwork could not load. Check your connection and try again.'));
    };
    image.src = path;
  })));
  return cache.get(path);
}

function fit(ctx, text, width) {
  let result = String(text);
  while (ctx.measureText(result).width > width && result.length > 1) result = result.slice(0, -2) + '…';
  return result;
}

export function exportPlan(count, options, screenColumns) {
  const width = options.width, grid = imageGrid(count, options, width, options.layout === 'fixed' ? options.columns : screenColumns);
  const {columns: columns, cell: cell} = grid;
  const perPage = Math.max(columns, Math.floor((12e3 - 180) / (cell + options.gap)) * columns);
  return {
    ...grid,
    width: width,
    perPage: perPage,
    pages: Math.max(1, Math.ceil(count / perPage))
  };
}

export async function renderTradePage(rows, byId, settings, options, columns, page = 0, details = {}) {
  const plan = exportPlan(rows.length, options, columns), subset = rows.slice(page * plan.perPage, (page + 1) * plan.perPage);
  const caption = options.captionText || (details.partials === false ? 'No Partials' : 'Partials Accepted');
  const captionHeight = options.caption ? Math.max(32, plan.cell * .22) : 0;
  const contacts = [ details.farm, details.tag, details.discord ].filter(Boolean).join(' · ');
  const contactHeight = contacts ? 34 : 0, notesHeight = details.notes ? 30 : 0;
  const rowsHeight = Math.ceil(subset.length / plan.columns) * (plan.cell + options.gap) - options.gap;
  const footerHeight = 48;
  const height = Math.max(100, options.padding * 2 + Math.max(0, rowsHeight) + captionHeight + contactHeight + footerHeight + notesHeight);
  const requested = options.quality;
  const scale = Math.min(requested, Math.sqrt(16e6 / (plan.width * height)), 16384 / Math.max(plan.width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(plan.width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, plan.width, height);
  const base = options.padding;
  let top = base;
  ctx.fillStyle = options.text;
  if (contacts) {
    ctx.font = '500 17px sans-serif';
    ctx.fillText(fit(ctx, contacts, plan.width - base * 2), base, top + 21);
    top += contactHeight;
  }
  function drawCaption(y) {
    ctx.fillStyle = options.text;
    ctx.font = `700 ${Math.min(36, Math.max(22, plan.cell * .2))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000b';
    ctx.shadowBlur = 5;
    ctx.fillText(fit(ctx, caption, plan.width - base * 2), plan.width / 2, y + captionHeight * .72);
    ctx.textAlign = 'left';
    ctx.shadowBlur = 0;
  }
  if (options.caption && options.captionPosition === 'top') {
    drawCaption(top);
    top += captionHeight;
  }
  const images = await Promise.all(subset.map((row => asset(byId.get(row.id).image))));
  const coin = await asset('assets/services/coin.png');
  for (let i = 0; i < subset.length; i++) {
    const row = subset[i], item = byId.get(row.id), x = plan.left + i % plan.columns * (plan.cell + options.gap), y = top + Math.floor(i / plan.columns) * (plan.cell + options.gap);
    ctx.strokeStyle = options.border;
    ctx.lineWidth = Math.max(1, plan.cell * .008);
    ctx.strokeRect(x + .6, y + .6, plan.cell - 1.2, plan.cell - 1.2);
    const showName = options.names;
    if (images[i]) {
      const inset = plan.cell * .035, bottom = showName ? plan.cell * .13 : 0, s = Math.min((plan.cell - inset * 2) / images[i].width, (plan.cell - inset * 2 - bottom) / images[i].height);
      ctx.drawImage(images[i], x + (plan.cell - images[i].width * s) / 2, y + (plan.cell - bottom - images[i].height * s) / 2, images[i].width * s, images[i].height * s);
    }
    ctx.fillStyle = options.text;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = Math.max(3, plan.cell * .035);
    ctx.shadowOffsetY = 1;
    if (options.prices && row.price !== undefined && !row.unpriced) {
      const text = priceLabel(row, options.simplify), font = Math.min(54, Math.max(18, plan.cell * .23));
      ctx.font = `700 ${font}px sans-serif`;
      ctx.fillText(text, x + plan.cell * .035, y + font * 1.12, plan.cell * .8);
      if (row.mode === 'coins' && coin) {
        const textWidth = Math.min(ctx.measureText(text).width, plan.cell * .76), size = font * .9;
        ctx.drawImage(coin, x + plan.cell * .045 + textWidth, y + font * .24, size, size);
      }
    }
    if (options.quantities) {
      ctx.font = `700 ${Math.min(60, Math.max(20, plan.cell * .25))}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(number(row.quantity), x + plan.cell * .95, y + plan.cell * (showName ? .81 : .93), plan.cell * .8);
      ctx.textAlign = 'left';
    }
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    if (showName) {
      ctx.font = `${item.bundle ? 650 : 500} ${Math.max(11, Math.min(18, plan.cell * .065))}px sans-serif`;
      ctx.fillText(fit(ctx, item.name, plan.cell * .91), x + plan.cell * .045, y + plan.cell * .955);
    }
  }
  let bottom = top + Math.max(0, rowsHeight) + options.gap;
  if (options.caption && options.captionPosition === 'bottom') {
    drawCaption(bottom);
    bottom += captionHeight;
  }
  const summary = paymentSummary(rows, byId, settings.calculationItem);
  ctx.shadowBlur = 0;
  ctx.fillStyle = options.text;
  ctx.font = `600 ${Math.max(12, Math.min(20, plan.width * .019))}px sans-serif`;
  if (options.totals) {
    let x = base;
    const total = number(summary.coins);
    ctx.fillText(total, x, bottom + 29);
    x += ctx.measureText(total).width + 5;
    if (coin) {
      ctx.drawImage(coin, x, bottom + 12, 19, 19);
      x += 25;
    }
    if (options.payment && summary.equivalent !== null) {
      const label = number(summary.equivalent), itemImage = await asset(summary.item.image);
      ctx.fillText(label, x, bottom + 29);
      x += ctx.measureText(label).width + 4;
      if (itemImage) {
        ctx.drawImage(itemImage, x, bottom + 11, 21, 21);
        x += 26;
      }
    }
    ctx.fillText(`(${number(summary.units)} items)`, x, bottom + 29);
  }
  ctx.textAlign = 'right';
  ctx.font = '500 15px sans-serif';
  ctx.fillText(PERMANENT_WATERMARK, plan.width - base, bottom + 29);
  ctx.textAlign = 'left';
  if (details.notes) {
    ctx.font = '15px sans-serif';
    ctx.fillText(fit(ctx, details.notes, plan.width - base * 2), base, bottom + footerHeight + 22);
  }
  return {
    canvas: canvas,
    plan: plan,
    scale: scale,
    requested: requested
  };
}

export function pngBlob(canvas) {
  return new Promise(((resolve, reject) => canvas.toBlob((blob => blob ? resolve(blob) : reject(new Error('Could not generate PNG. Lower image width or quality.'))), 'image/png')));
}
