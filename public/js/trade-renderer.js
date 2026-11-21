import { number } from './core.js';

import { priceLabel, paymentSummary, imageGrid, imageCaption } from './editor-core.js';

import { PERMANENT_WATERMARK } from './branding.js';
import {imagePost, withPostData} from './post-image-data.js';

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

function drawTile(ctx, row, item, image, coin, options, x, y, cell) {
  ctx.strokeStyle = options.border;
  ctx.lineWidth = Math.max(1, cell * .008);
  ctx.strokeRect(x + .6, y + .6, cell - 1.2, cell - 1.2);
  const showName = options.names;
  if (image) {
    const inset = cell * .035, bottom = showName ? cell * .13 : 0, s = Math.min((cell - inset * 2) / image.width, (cell - inset * 2 - bottom) / image.height);
    ctx.drawImage(image, x + (cell - image.width * s) / 2, y + (cell - bottom - image.height * s) / 2, image.width * s, image.height * s);
  }
  ctx.fillStyle = options.text;
  ctx.shadowColor = '#000';
  ctx.shadowBlur = Math.max(3, cell * .035);
  ctx.shadowOffsetY = 1;
  if (options.prices && row.price !== undefined && !row.unpriced) {
    const text = priceLabel(row, options.simplify), font = Math.min(54, Math.max(18, cell * .23));
    ctx.font = `700 ${font}px sans-serif`;
    ctx.fillText(text, x + cell * .035, y + font * 1.12, cell * .8);
    if (row.mode === 'coins' && coin) {
      const textWidth = Math.min(ctx.measureText(text).width, cell * .76), size = font * .9;
      ctx.drawImage(coin, x + cell * .045 + textWidth, y + font * .24, size, size);
    }
  }
  let quantityWidth = 0;
  if (options.quantities) {
    const quantity = number(row.quantity);
    ctx.font = `700 ${Math.min(60, Math.max(20, cell * .25))}px sans-serif`;
    quantityWidth = Math.min(ctx.measureText(quantity).width, cell * .8);
    ctx.textAlign = 'right';
    ctx.fillText(quantity, x + cell * .95, y + cell * .955, cell * .8);
    ctx.textAlign = 'left';
  }
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  if (showName) {
    ctx.font = `${item.bundle ? 650 : 500} ${Math.max(11, Math.min(18, cell * .065))}px sans-serif`;
    const nameWidth = options.quantities ? cell * .87 - quantityWidth : cell * .91;
    if (nameWidth >= ctx.measureText('…').width) ctx.fillText(fit(ctx, item.name, nameWidth), x + cell * .045, y + cell * .955);
  }
}

function startCanvas(canvas, ctx, width, height, options) {
  const scale = Math.min(options.quality, Math.sqrt(16e6 / (width * height)), 16384 / Math.max(width, height));
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  ctx.scale(scale, scale);
  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = options.text;
  return scale;
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
  const summary = paymentSummary(rows, byId, settings.calculationItem, details.discount);
  const discount = options.totals ? summary.discount : null;
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
  const rebateTop = cursor + sectionGap, rebateHeight = 59, rebateInset = 11, rebateGap = 8;
  const subtotal = number(summary.subtotal), saving = '−' + number(summary.saved);
  const rebateLabel = discount ? discount.name + ' · ' + number(discount.percent) + '% off' : '';
  ctx.font = '500 15px sans-serif';
  const subtotalWidth = ctx.measureText('Subtotal').width + rebateGap + ctx.measureText(subtotal).width;
  ctx.font = '700 16px sans-serif';
  const savingWidth = ctx.measureText(saving).width;
  const rebateWidth = Math.min(plan.width - base * 2, 2 * rebateInset +
    Math.max(subtotalWidth, ctx.measureText(rebateLabel).width + rebateGap + savingWidth));
  if (discount) cursor = rebateTop + rebateHeight;
  const footerY = cursor + sectionGap + footerAscent;
  const height = Math.max(1, footerY + footerDescent + footerInset);
  const requested = options.quality;
  const scale = startCanvas(canvas, ctx, plan.width, height, options);
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
    drawTile(ctx, row, item, images[i], coin, options, x, y, plan.cell);
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = options.text;
  if (notes) {
    ctx.font = '15px sans-serif';
    ctx.fillText(notes, base, noteY);
  }
  if (discount) {
    const left = base + rebateInset, right = base + rebateWidth - rebateInset;
    ctx.globalAlpha = .07;
    ctx.fillRect(base, rebateTop, rebateWidth, rebateHeight);
    ctx.globalAlpha = 1;
    ctx.fillStyle = options.border;
    ctx.fillRect(left, rebateTop + 29, right - left, 1);
    ctx.fillStyle = options.text;
    ctx.font = '500 15px sans-serif';
    ctx.fillText('Subtotal', left, rebateTop + 20);
    ctx.fillText(subtotal, left + ctx.measureText('Subtotal').width + rebateGap, rebateTop + 20);
    ctx.font = '700 16px sans-serif';
    const label = fit(ctx, rebateLabel, right - left - savingWidth - rebateGap);
    ctx.fillText(label, left, rebateTop + 49);
    ctx.fillText(saving, left + ctx.measureText(label).width + rebateGap, rebateTop + 49);
  }
  ctx.font = totalFont;
  if (options.totals) {
    let x = base;
    const total = (discount ? 'Total ' : '') + number(summary.coins);
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
    requested: requested,
    post: imagePost(subset, null, options, details)
  };
}

// Keep each Have/Want pair together when the image is split into pages.
export function exchangePlan(exchanges, options) {
  const width = options.width, pad = Math.max(8, options.padding);
  const middle = Math.min(84, Math.max(exchanges.some(exchange => exchange.ratio) ? 50 : 26, width * .055));
  const side = (width - 2 * pad - middle) / 2;
  const requested = options.layout === 'fixed' ? Math.min(options.columns, 6) : Math.max(2, Math.min(5, Math.round(side / 135)));
  const columns = Math.min(requested, Math.max(1, Math.floor((side + options.gap) / (62 + options.gap))));
  const cell = Math.min(190, (side - (columns - 1) * options.gap) / columns);
  const lineHeight = Math.max(23, Math.min(34, cell * .18));
  const rows = exchanges.map(exchange => {
    const depth = Math.ceil(Math.max(exchange.have.length, exchange.want.length) / columns);
    const terms = exchange.terms ? 27 : 0;
    return {exchange, terms, height: lineHeight + 10 + depth * (cell + options.gap) - options.gap + terms};
  });
  const groups = [[]];
  let pageHeight = 0;
  for (const row of rows) {
    if (pageHeight && pageHeight + row.height > 10500) {
      groups.push([]);
      pageHeight = 0;
    }
    groups.at(-1).push(row);
    pageHeight += row.height + 18;
  }
  return {width, pad, middle, side, columns, cell, lineHeight, groups, pages: groups.length};
}

export async function renderExchangePage(exchanges, byId, options, page = 0, details = {}) {
  const plan = exchangePlan(exchanges, options), rows = plan.groups[page];
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  const gap = 12, font = Math.min(36, Math.max(22, plan.cell * .2)), captionPitch = font * 1.3;
  ctx.font = `700 ${font}px sans-serif`;
  const caption = options.caption ? wrapCaption(ctx, imageCaption(options, details.partials), plan.width - plan.pad * 2) : [];
  const captionHeight = caption.length ? caption.length * captionPitch + gap : 0;
  const contact = [details.farm, details.tag, details.discord].filter(Boolean).join(' · ');
  const contactHeight = contact ? 24 + gap : 0, notesHeight = details.notes ? 22 + gap : 0;
  const rowsHeight = rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * 20;
  const height = plan.pad + contactHeight + rowsHeight + captionHeight + notesHeight + 34;
  const scale = startCanvas(canvas, ctx, plan.width, height, options);
  let y = plan.pad;
  const drawCaption = () => {
    if (!caption.length) return;
    ctx.textAlign = 'center';
    ctx.font = `700 ${font}px sans-serif`;
    caption.forEach((line, index) => ctx.fillText(line, plan.width / 2, y + font + index * captionPitch));
    ctx.textAlign = 'left';
    y += captionHeight;
  };
  if (contact) {
    ctx.font = '500 17px sans-serif';
    ctx.fillText(fit(ctx, contact, plan.width - plan.pad * 2), plan.pad, y + 16);
    y += contactHeight;
  }
  if (options.captionPosition === 'top') drawCaption();

  const goods = new Set(rows.flatMap(({exchange}) => exchange.have.concat(exchange.want).map(row => row.id)));
  const images = new Map(await Promise.all([...goods].map(async id => [id, await asset(byId.get(id).image)])));
  const withoutPrices = {...options, prices: false};
  for (const {exchange, height: rowHeight, terms} of rows) {
    for (const [index, key] of ['have', 'want'].entries()) {
      const left = plan.pad + index * (plan.side + plan.middle), group = exchange[key];
      ctx.font = `600 ${Math.min(25, plan.lineHeight * .75)}px sans-serif`;
      const span = Math.min(plan.columns, group.length) * (plan.cell + options.gap) - options.gap;
      const sideStart = index ? left : left + plan.side - span;
      ctx.textAlign = 'center';
      ctx.fillText(index ? 'Want' : 'Have', sideStart + span / 2, y + plan.lineHeight);
      ctx.textAlign = 'left';
      for (const [itemIndex, row] of group.entries()) {
        const line = Math.floor(itemIndex / plan.columns), column = itemIndex % plan.columns;
        const count = Math.min(plan.columns, group.length - line * plan.columns);
        const align = index ? 0 : plan.side - count * plan.cell - (count - 1) * options.gap;
        const x = left + align + column * (plan.cell + options.gap);
        const itemY = y + plan.lineHeight + 10 + line * (plan.cell + options.gap);
        drawTile(ctx, row, byId.get(row.id), images.get(row.id), null, withoutPrices, x, itemY, plan.cell);
      }
    }
    ctx.font = `500 ${Math.min(28, plan.middle - 5)}px sans-serif`;
    ctx.textAlign = 'center';
    const arrowY = y + plan.lineHeight + 10 + plan.cell * .52;
    ctx.fillText('→', plan.width / 2, arrowY);
    if (exchange.ratio) {
      ctx.font = '700 16px sans-serif';
      ctx.fillText(exchange.ratio, plan.width / 2, arrowY + 20, plan.middle - 8);
    }
    if (terms) {
      ctx.font = '500 15px sans-serif';
      ctx.fillText(fit(ctx, exchange.terms, plan.width - plan.pad * 2), plan.width / 2, y + rowHeight - 5);
    }
    ctx.textAlign = 'left';
    y += rowHeight + 20;
    if (y < plan.pad + contactHeight + (options.captionPosition === 'top' ? captionHeight : 0) + rowsHeight) {
      ctx.fillStyle = options.border;
      ctx.globalAlpha = .5;
      ctx.fillRect(plan.pad, y - 9, plan.width - plan.pad * 2, 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = options.text;
    }
  }
  y -= 20 - gap;
  if (options.captionPosition !== 'top') drawCaption();
  if (details.notes) {
    ctx.font = '15px sans-serif';
    ctx.fillText(fit(ctx, details.notes, plan.width - plan.pad * 2), plan.pad, y + 13);
  }
  ctx.font = '500 15px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(PERMANENT_WATERMARK, plan.width - 6, height - 6);
  return {canvas, plan, scale, requested: options.quality, post: imagePost([], rows.map(row => row.exchange), withoutPrices, details)};
}

export function pngBlob(canvas, post) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(post ? withPostData(blob, post) : blob);
    else reject(new Error('Could not generate PNG. Lower image width or quality.'));
  }, 'image/png'));
}
