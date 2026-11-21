//! Segment the native barn/silo panel, locate outlined quantity digits, and
//! return full icon/quantity boxes with normalized glyphs.
use super::{components, push_u32, Bounds, Component};

struct Glyph {
    bounds: Bounds,
    pixels: [u8; 1024],
}

fn glyph_pixels(labels: &[u32], width: usize, glyph: &Component) -> [u8; 1024] {
    let b = glyph.bounds;
    let scale = 26. / b.width().max(b.height()) as f64;
    let w = (b.width() as f64 * scale).round_ties_even().max(1.) as usize;
    let h = (b.height() as f64 * scale).round_ties_even().max(1.) as usize;
    let mut pixels = [0; 1024];
    for y in 0..h {
        for x in 0..w {
            let sx = b.left + x * b.width() / w;
            let sy = b.top + y * b.height() / h;
            if labels[sy * width + sx] == glyph.id {
                pixels[((32 - h) / 2 + y) * 32 + (32 - w) / 2 + x] = 255;
            }
        }
    }
    pixels
}

// The cream panel is taller along the left and right of the barn banner.
// Find the actual top of the stock viewport across the middle of the panel.
fn viewport_top(cream: &[u8], width: usize, area: Bounds) -> usize {
    let inset = area.width() / 6;
    let left = area.left + inset;
    let right = area.right - inset;
    let mut run = 0;
    for y in area.top..area.top + area.height() / 3 {
        let visible = cream[y * width + left..y * width + right]
            .iter()
            .step_by(4)
            .filter(|&&value| value != 0)
            .count();
        if visible * 8 >= right - left {
            run += 1;
            if run == 3 {
                return y - 2;
            }
        } else {
            run = 0;
        }
    }
    area.top
}

pub(super) fn extract(rgba: &[u8], width: usize, height: usize, video: bool, output: &mut Vec<u8>) {
    let cream: Vec<u8> = rgba
        .chunks_exact(4)
        .map(|p| {
            (p[0] > 235 && p[1] > 225 && p[2] > 170 && p[2] < 245 && p[1] > p[2].saturating_add(8))
                as u8
        })
        .collect();
    let (_, panels) = components(&cream, width, height);
    let panel = panels.iter().rev().max_by_key(|part| part.area);
    let Some(panel) =
        panel.filter(|p| p.area * 25 >= width * height && p.bounds.width() * 100 >= width * 15)
    else {
        output.extend([0; 8]);
        return;
    };

    let area = panel.bounds;
    let visible_top = if video {
        viewport_top(&cream, width, area)
    } else {
        area.top
    };
    let (w, h) = (area.width(), area.height());
    let white: Vec<u8> = (area.top..area.bottom)
        .flat_map(|y| {
            rgba[(y * width + area.left) * 4..(y * width + area.right) * 4]
                .chunks_exact(4)
                .map(|p| (p[0].min(p[1]).min(p[2]) > 225) as u8)
        })
        .collect();
    let (labels, candidates) = components(&white, w, h);
    let mut glyphs = Vec::new();
    for glyph in candidates {
        let b = glyph.bounds;
        let (gw, gh) = (b.width(), b.height());
        if gh * 1000 <= height * 38
            || gh * 1000 >= height * 72
            || gw * 10 <= gh
            || gw * 100 >= gh * 105
            || glyph.area * 100 <= gw * gh * 12
        {
            continue;
        }
        let near = |x: usize, y: usize, radius: usize| {
            (y.saturating_sub(radius)..=(y + radius).min(h - 1)).any(|yy| {
                (x.saturating_sub(radius)..=(x + radius).min(w - 1))
                    .any(|xx| labels[yy * w + xx] == glyph.id)
            })
        };
        let (mut ring, mut black) = (0, 0);
        let thin = gh < 18;
        for y in b.top.saturating_sub(2)..(b.bottom + 2).min(h) {
            for x in b.left.saturating_sub(2)..(b.right + 2).min(w) {
                let radius = if thin { 0 } else { 1 };
                if near(x, y, radius) || !near(x, y, radius + 1) {
                    continue;
                }
                ring += 1;
                let p = ((y + area.top) * width + x + area.left) * 4;
                let max = rgba[p].max(rgba[p + 1]).max(rgba[p + 2]);
                let min = rgba[p].min(rgba[p + 1]).min(rgba[p + 2]);
                if if thin {
                    max < 220 && max - min < 50
                } else {
                    max < 160
                } {
                    black += 1;
                }
            }
        }
        if ring == 0 || black * 100 < ring * if thin { 60 } else { 72 } {
            continue;
        }
        glyphs.push(Glyph {
            bounds: Bounds {
                left: b.left + area.left,
                right: b.right + area.left,
                top: b.top + area.top,
                bottom: b.bottom + area.top,
            },
            pixels: glyph_pixels(&labels, w, &glyph),
        });
    }

    glyphs.sort_by_key(|glyph| glyph.bounds.top);
    let mut rows: Vec<Vec<Glyph>> = Vec::new();
    for glyph in glyphs {
        if let Some(row) = rows
            .iter_mut()
            .find(|r| r[0].bounds.top.abs_diff(glyph.bounds.top) * 4 < glyph.bounds.height())
        {
            row.push(glyph);
        } else {
            rows.push(vec![glyph]);
        }
    }

    let mut groups = Vec::new();
    for mut row in rows {
        row.sort_by_key(|glyph| glyph.bounds.left);
        let mut group: Vec<Glyph> = Vec::new();
        for glyph in row {
            if group.last().is_some_and(|last| {
                glyph.bounds.left.saturating_sub(last.bounds.right) * 5 > last.bounds.height() * 2
            }) {
                groups.push(std::mem::take(&mut group));
            }
            group.push(glyph);
        }
        groups.push(group);
    }

    let (mut entries, mut skipped) = (Vec::new(), 0);
    for digits in groups {
        let x = digits.iter().map(|g| g.bounds.left).min().unwrap();
        let y = digits.iter().map(|g| g.bounds.top).min().unwrap();
        let right = digits.iter().map(|g| g.bounds.right).max().unwrap();
        let bottom = digits.iter().map(|g| g.bounds.bottom).max().unwrap();
        let h = bottom - y;
        let side = (h as f64 * 2.75).round_ties_even() as i32;
        let ix = (right as f64 - h as f64 * 2.75).round_ties_even() as i32;
        let iy = (y as f64 - h as f64 * 1.18).round_ties_even() as i32;
        if ix < area.left as i32
            || iy < (visible_top as i32 - if video { (h / 8) as i32 } else { 0 })
            || iy < area.top as i32
            || ix + side > area.right as i32
            || iy + side > area.bottom as i32
            || digits.len() > 6
        {
            skipped += 1;
            continue;
        }
        entries.push((
            [x, y, right - x, h],
            [ix as usize, iy as usize, side as usize, side as usize],
            digits,
        ));
    }
    entries.sort_by_key(|(b, _, _)| ((b[1] as f64 / 10.).round_ties_even() as usize, b[0]));
    push_u32(output, entries.len() as u32);
    push_u32(output, skipped);
    for (quantity, item, digits) in entries {
        for value in quantity.into_iter().chain(item) {
            push_u32(output, value as u32);
        }
        push_u32(output, digits.len() as u32);
        for digit in digits {
            output.extend(digit.pixels);
        }
    }
}
