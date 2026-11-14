import { number } from './core.js';

import { priceLabel, paymentSummary, imageGrid, imageCaption } from './editor-core.js';

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

function wrapCaption(ctx, text, width) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/[ \t]+/)) {
      if (!word) continue;
      const candidate = line ? line + ' ' + word : word;
      if (ctx.measureText(candidate).width <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const character of word) {
        if (line && ctx.measureText(line + character).width > width) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
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
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  const sectionGap = 12, footerInset = 6, base = options.padding;
  const captionFont = Math.min(36, Math.max(22, plan.cell * .2)), captionLineHeight = captionFont * 1.3;
  ctx.font = `700 ${captionFont}px sans-serif`;
  const captionLines = options.caption ? wrapCaption(ctx, imageCaption(options, details.partials), plan.width - base * 2) : [];
  const captionBounds = captionLines.map((line, i) => {
    const metrics = ctx.measureText(line);
    return {top: i * captionLineHeight - metrics.actualBoundingBoxAscent, bottom: i * captionLineHeight + metrics.actualBoundingBoxDescent};
  });
  const captionTop = captionLines.length ? Math.min(...captionBounds.map(line => line.top)) : 0;
  const captionHeight = captionLines.length ? Math.max(...captionBounds.map(line => line.bottom)) - captionTop : 0;
  ctx.font = '500 17px sans-serif';
  const contacts = fit(ctx, [ details.farm, details.tag, details.discord ].filter(Boolean).join(' · '), plan.width - base * 2);
  const contactMetrics = ctx.measureText(contacts);
  ctx.font = '15px sans-serif';
  const notes = fit(ctx, details.notes || '', plan.width - base * 2), noteMetrics = ctx.measureText(notes);
  const summary = paymentSummary(rows, byId, settings.calculationItem);
  const totalFont = `600 ${Math.max(12, Math.min(20, plan.width * .019))}px sans-serif`;
  ctx.font = totalFont;
  const totalMetrics = ctx.measureText(`${number(summary.coins)} ${number(summary.equivalent ?? 0)} (${number(summary.units)} items)`);
  ctx.font = '500 15px sans-serif';
  const watermarkMetrics = ctx.measureText(PERMANENT_WATERMARK);
  const footerAscent = Math.max(watermarkMetrics.actualBoundingBoxAscent, options.totals ? Math.max(18, totalMetrics.actualBoundingBoxAscent) : 0);
  const footerDescent = Math.max(watermarkMetrics.actualBoundingBoxDescent, options.totals ? Math.max(3, totalMetrics.actualBoundingBoxDescent) : 0);
  let cursor = base, contactY, captionY, noteY;
  if (contacts) {
    contactY = cursor + contactMetrics.actualBoundingBoxAscent;
    cursor += contactMetrics.actualBoundingBoxAscent + contactMetrics.actualBoundingBoxDescent + sectionGap;
  }
  if (options.caption && options.captionPosition === 'top') {
    captionY = cursor;
    cursor += captionHeight + sectionGap;
  }
  const top = cursor, rowsHeight = Math.max(0, Math.ceil(subset.length / plan.columns) * (plan.cell + options.gap) - options.gap);
  cursor += rowsHeight;
  if (options.caption && options.captionPosition === 'bottom') {
    captionY = cursor + sectionGap;
    cursor = captionY + captionHeight;
  }
  if (notes) {
    noteY = cursor + sectionGap + noteMetrics.actualBoundingBoxAscent;
    cursor = noteY + noteMetrics.actualBoundingBoxDescent;
  }
  const footerY = cursor + sectionGap + footerAscent;
  const height = Math.max(1, footerY + footerDescent + footerInset);
  const requested = options.quality;
  const scale = Math.min(requested, Math.sqrt(16e6 / (plan.width * height)), 16384 / Math.max(plan.width, height));
  canvas.width = Math.max(1, Math.floor(plan.width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  ctx.scale(scale, scale);
  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, plan.width, height);
  ctx.fillStyle = options.text;
  if (contacts) {
    ctx.font = '500 17px sans-serif';
    ctx.fillText(contacts, base, contactY);
  }
  function drawCaption(y) {
    ctx.fillStyle = options.text;
    ctx.font = `700 ${captionFont}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000b';
    ctx.shadowBlur = 5;
    captionLines.forEach((line, i) => ctx.fillText(line, plan.width / 2, y - captionTop + i * captionLineHeight));
    ctx.textAlign = 'left';
    ctx.shadowBlur = 0;
  }
  if (options.caption) drawCaption(captionY);
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
    let quantityWidth = 0;
    if (options.quantities) {
      const quantity = number(row.quantity);
      ctx.font = `700 ${Math.min(60, Math.max(20, plan.cell * .25))}px sans-serif`;
      quantityWidth = Math.min(ctx.measureText(quantity).width, plan.cell * .8);
      ctx.textAlign = 'right';
      ctx.fillText(quantity, x + plan.cell * .95, y + plan.cell * .955, plan.cell * .8);
      ctx.textAlign = 'left';
    }
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    if (showName) {
      ctx.font = `${item.bundle ? 650 : 500} ${Math.max(11, Math.min(18, plan.cell * .065))}px sans-serif`;
      const nameWidth = options.quantities ? plan.cell * .87 - quantityWidth : plan.cell * .91;
      if (nameWidth >= ctx.measureText('…').width) ctx.fillText(fit(ctx, item.name, nameWidth), x + plan.cell * .045, y + plan.cell * .955);
    }
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = options.text;
  if (notes) {
    ctx.font = '15px sans-serif';
    ctx.fillText(notes, base, noteY);
  }
  ctx.font = totalFont;
  if (options.totals) {
    let x = base;
    const total = number(summary.coins);
    ctx.fillText(total, x, footerY);
    x += ctx.measureText(total).width + 5;
    if (coin) {
      ctx.drawImage(coin, x, footerY - 17, 19, 19);
      x += 25;
    }
    if (options.payment && summary.equivalent !== null) {
      const label = number(summary.equivalent), itemImage = await asset(summary.item.image);
      ctx.fillText(label, x, footerY);
      x += ctx.measureText(label).width + 4;
      if (itemImage) {
        ctx.drawImage(itemImage, x, footerY - 18, 21, 21);
        x += 26;
      }
    }
    ctx.fillText(`(${number(summary.units)} items)`, x, footerY);
  }
  ctx.textAlign = 'right';
  ctx.font = '500 15px sans-serif';
  ctx.fillText(PERMANENT_WATERMARK, plan.width - footerInset, footerY);
  ctx.textAlign = 'left';
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
