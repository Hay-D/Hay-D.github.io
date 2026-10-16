export function cropCanvas(image, rect, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width || Math.max(1, Math.round(rect.w));
  canvas.height = height || Math.max(1, Math.round(rect.h));
  canvas.getContext('2d').drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function gridCells(image, layout) {
  const {x: x, y: y, w: w, h: h, cols: cols, rows: rows} = layout, cellW = w / cols * image.width, cellH = h / rows * image.height, cells = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    if (layout.skipEdge && (row === 0 || row === rows - 1)) continue;
    const rect = {
      x: (x + col * w / cols) * image.width,
      y: (y + row * h / rows) * image.height,
      w: cellW,
      h: cellH
    }, tile = cropCanvas(image, rect, 96, 96), offset = layout.quantityOffsets?.[row] ?? .46;
    const numberCrop = cropCanvas(image, {
      x: rect.x + rect.w * .43,
      y: rect.y + rect.h * offset,
      w: rect.w * .56,
      h: rect.h * .52
    }, 160, 48);
    cells.push({
      tile: tile,
      numberCrop: numberCrop,
      rect: rect,
      row: row,
      col: col
    });
  }
  return cells;
}
