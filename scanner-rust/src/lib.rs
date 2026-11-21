//! HayDex's local image matcher. The worker copies inputs into a reusable
//! buffer and reads the returned data before making another call.
mod inventory;

use std::{cell::RefCell, cmp::Ordering};

const SIDE: usize = 32;
const MAX_PIXELS: usize = 4_000_000;
const ROTATIONS: [f64; 6] = [-45., -30., -15., 15., 30., 45.];

struct Feature {
    rgb: Box<[[u8; 3]; SIDE * SIDE]>,
    mask: [u32; SIDE],
    histogram: [f32; 64],
    count: usize,
    aspect: f32,
}

impl Feature {
    fn empty() -> Self {
        Self {
            rgb: Box::new([[0; 3]; SIDE * SIDE]),
            mask: [0; SIDE],
            histogram: [0.; 64],
            count: 0,
            aspect: 1.,
        }
    }
}

struct Template {
    feature: Feature,
    rotations: Option<Box<[Feature; 6]>>,
}

#[derive(Clone, Copy, Default)]
struct Digit {
    mask: [u32; SIDE],
    count: u32,
}

#[derive(Clone, Copy)]
struct Bounds {
    left: usize,
    top: usize,
    right: usize,
    bottom: usize,
}

impl Bounds {
    fn width(self) -> usize {
        self.right - self.left
    }
    fn height(self) -> usize {
        self.bottom - self.top
    }
}

struct Component {
    id: u32,
    area: usize,
    bounds: Bounds,
}

fn components(mask: &[u8], width: usize, height: usize) -> (Vec<u32>, Vec<Component>) {
    let mut labels = vec![0; mask.len()];
    let mut queue = Vec::new();
    let mut parts = Vec::new();
    for i in 0..mask.len() {
        if mask[i] == 0 || labels[i] != 0 {
            continue;
        }
        let id = parts.len() as u32 + 1;
        let mut bounds = Bounds {
            left: width,
            top: height,
            right: 0,
            bottom: 0,
        };
        queue.clear();
        queue.push(i);
        labels[i] = id;
        let mut head = 0;
        while head < queue.len() {
            let p = queue[head];
            head += 1;
            let (x, y) = (p % width, p / width);
            bounds.left = bounds.left.min(x);
            bounds.right = bounds.right.max(x + 1);
            bounds.top = bounds.top.min(y);
            bounds.bottom = bounds.bottom.max(y + 1);
            let mut visit = |next: usize| {
                if mask[next] != 0 && labels[next] == 0 {
                    labels[next] = id;
                    queue.push(next);
                }
            };
            if x > 0 {
                visit(p - 1);
            }
            if x + 1 < width {
                visit(p + 1);
            }
            if y > 0 {
                visit(p - width);
            }
            if y + 1 < height {
                visit(p + width);
            }
        }
        parts.push(Component {
            id,
            area: queue.len(),
            bounds,
        });
    }
    (labels, parts)
}

fn background(rgba: &[u8], width: usize, height: usize) -> [f64; 3] {
    // Only the light cream tones of the inventory can vote.
    let mut votes = [[0u32; 4]; 4 * 5 * 12];
    let mut order = Vec::new();
    for y in (0..height).step_by(2) {
        for x in (0..width).step_by(2) {
            let p = (y * width + x) * 4;
            let [r, g, b, a] = [rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3]];
            if a < 200
                || r < 230
                || g < 218
                || b < 160
                || r < b.saturating_add(8)
                || g < b.saturating_add(5)
                || b > 247
            {
                continue;
            }
            let key =
                ((r as usize / 8 - 28) * 5 + (g as usize / 8 - 27)) * 12 + (b as usize / 8 - 20);
            let values = &mut votes[key];
            if values[0] == 0 {
                order.push(key);
            }
            values[0] += 1;
            values[1] += r as u32;
            values[2] += g as u32;
            values[3] += b as u32;
        }
    }
    let winner = order.into_iter().rev().max_by_key(|&key| votes[key][0]);
    winner.map_or([255., 249., 221.], |key| {
        let [count, r, g, b] = votes[key];
        [
            r as f64 / count as f64,
            g as f64 / count as f64,
            b as f64 / count as f64,
        ]
    })
}

fn describe(rgba: &[u8], width: usize, height: usize) -> Feature {
    let area = width * height;
    let transparent = rgba.iter().skip(3).step_by(4).filter(|&&a| a < 128).count() * 25 > area;
    let bg = if transparent {
        [0.; 3]
    } else {
        background(rgba, width, height)
    };
    let edge_x = if transparent {
        0
    } else {
        (width * 15 / 1000).max(1)
    };
    let edge_y = if transparent {
        0
    } else {
        (height * 15 / 1000).max(1)
    };
    let mut mask = vec![0; area];
    for y in edge_y..height.saturating_sub(edge_y) {
        for x in edge_x..width.saturating_sub(edge_x) {
            let i = y * width + x;
            let p = i * 4;
            if rgba[p + 3] < 100 {
                continue;
            }
            let distance = |c: usize| {
                let delta = rgba[p + c] as f64 - bg[c];
                delta * delta
            };
            if transparent || distance(0) + distance(1) + distance(2) > 225. {
                mask[i] = 1;
            }
        }
    }
    let (labels, parts) = components(&mask, width, height);
    let mut result = Feature::empty();
    let Some(largest) = parts
        .iter()
        .rev()
        .filter(|part| {
            part.area >= 4
                && (transparent
                    || (part.bounds.width() * 100 > width * 8
                        && part.bounds.height() * 100 > height * 6))
        })
        .max_by_key(|part| part.area)
    else {
        return result;
    };

    let mut bounds = largest.bounds;
    let anchor = largest.bounds;
    let mut keep = vec![false; parts.len() + 1];
    keep[largest.id as usize] = true;
    for part in &parts {
        let b = part.bounds;
        if part.id == largest.id
            || part.area * 40 < largest.area
            || b.right * 100 + width * 12 < anchor.left * 100
            || b.left * 100 > anchor.right * 100 + width * 12
            || b.bottom * 100 + height * 12 < anchor.top * 100
            || b.top * 100 > anchor.bottom * 100 + height * 12
            || (!transparent && (b.width() * 1000 < width * 35 || b.height() * 1000 < height * 25))
        {
            continue;
        }
        keep[part.id as usize] = true;
        bounds.left = bounds.left.min(b.left);
        bounds.right = bounds.right.max(b.right);
        bounds.top = bounds.top.min(b.top);
        bounds.bottom = bounds.bottom.max(b.bottom);
    }

    let (w, h) = (bounds.width(), bounds.height());
    let scale = 28. / w.max(h) as f64;
    let (dw, dh) = (
        (w as f64 * scale).round().max(1.) as usize,
        (h as f64 * scale).round().max(1.) as usize,
    );
    let (dx, dy) = ((SIDE - dw) / 2, (SIDE - dh) / 2);
    for y in 0..dh {
        for x in 0..dw {
            let sx = bounds.left + ((2 * x + 1) * w / (2 * dw)).min(w - 1);
            let sy = bounds.top + ((2 * y + 1) * h / (2 * dh)).min(h - 1);
            let src = sy * width + sx;
            if !keep[labels[src] as usize] {
                continue;
            }
            let rgb = [rgba[src * 4], rgba[src * 4 + 1], rgba[src * 4 + 2]];
            result.rgb[(y + dy) * SIDE + x + dx] = rgb;
            result.mask[y + dy] |= 1 << (x + dx);
            result.count += 1;
            let bin =
                (rgb[0] as usize / 64) * 16 + (rgb[1] as usize / 64) * 4 + rgb[2] as usize / 64;
            result.histogram[bin] += 1.;
        }
    }
    if result.count > 0 {
        // Store the roots once instead of taking a square root for every comparison.
        for bin in &mut result.histogram {
            *bin = (*bin / result.count as f32).sqrt();
        }
    }
    result.aspect = w as f32 / h as f32;
    result
}

fn affinity(a: &Feature, b: &Feature) -> f32 {
    a.histogram
        .iter()
        .zip(b.histogram)
        .map(|(x, y)| x * y)
        .sum()
}

fn shift(bits: u32, delta: i32) -> u32 {
    match delta {
        -1 => bits << 1,
        1 => bits >> 1,
        _ => bits,
    }
}

fn compare(a: &Feature, b: &Feature, stride: usize) -> f32 {
    let color = affinity(a, b) * 0.25;
    let aspect = (-1.5 * (a.aspect / b.aspect).ln().abs()).exp() * 0.05;
    let sampling = if stride == 1 {
        0x7fff_fffe
    } else {
        0x2aaa_aaaa
    };
    let mut best: f32 = 0.;
    for dy in -1i32..=1 {
        for dx in -1i32..=1 {
            let mut overlap = 0;
            let mut error = 0u32;
            for y in (1..SIDE - 1).step_by(stride) {
                let other_y = (y as i32 + dy) as usize;
                let mut bits = a.mask[y] & shift(b.mask[other_y], dx) & sampling;
                overlap += bits.count_ones();
                while bits != 0 {
                    let x = bits.trailing_zeros() as usize;
                    bits &= bits - 1;
                    let aa = a.rgb[y * SIDE + x];
                    let bb = b.rgb[other_y * SIDE + (x as i32 + dx) as usize];
                    error += aa[0].abs_diff(bb[0]) as u32
                        + aa[1].abs_diff(bb[1]) as u32
                        + aa[2].abs_diff(bb[2]) as u32;
                }
            }
            let shape = (2. * overlap as f32 * (stride * stride) as f32
                / (a.count + b.count).max(1) as f32)
                .min(1.);
            let pixels = if overlap == 0 {
                0.
            } else {
                (-5. * error as f32 / (overlap * 765) as f32).exp()
            };
            best = best.max(
                0.4 * pixels + 0.3 * shape + color + aspect - 0.002 * (dx.abs() + dy.abs()) as f32,
            );
        }
    }
    best.min(1.)
}

fn rotate(feature: &Feature, angle: f64) -> Feature {
    let size = 48;
    let mut rgba = vec![0; size * size * 4];
    let (sine, cosine) = angle.to_radians().sin_cos();
    for y in 0..size {
        for x in 0..size {
            let (dx, dy) = (x as f64 - 23.5, y as f64 - 23.5);
            let sx = (cosine * dx + sine * dy + 16.).floor() as i32;
            let sy = (-sine * dx + cosine * dy + 16.).floor() as i32;
            if !(0..32).contains(&sx) || !(0..32).contains(&sy) {
                continue;
            }
            let (sx, sy) = (sx as usize, sy as usize);
            if feature.mask[sy] & (1 << sx) == 0 {
                continue;
            }
            let dst = (y * size + x) * 4;
            rgba[dst..dst + 3].copy_from_slice(&feature.rgb[sy * SIDE + sx]);
            rgba[dst + 3] = 255;
        }
    }
    describe(&rgba, size, size)
}

fn score_order(a: &(usize, f32), b: &(usize, f32)) -> Ordering {
    b.1.total_cmp(&a.1)
}

fn match_item(feature: &Feature, bank: &mut [Template]) -> Vec<(usize, f32)> {
    if feature.count < 12 || bank.is_empty() {
        return Vec::new();
    }
    let mut ranked: Vec<_> = bank
        .iter()
        .enumerate()
        .map(|(i, template)| {
            let other = &template.feature;
            let score = 0.85 * affinity(feature, other)
                + 0.15 * (-(feature.aspect / other.aspect).ln().abs()).exp();
            (i, score)
        })
        .collect();
    ranked.sort_by(score_order);
    ranked.truncate(40);
    for (i, score) in &mut ranked {
        *score = compare(feature, &bank[*i].feature, 1);
    }
    ranked.sort_by(score_order);
    if ranked[0].1 < 0.76 || ranked[0].1 - ranked.get(1).map_or(0., |row| row.1) < 0.035 {
        for (i, score) in &mut ranked {
            let template = &mut bank[*i];
            let variants = template.rotations.get_or_insert_with(|| {
                Box::new(ROTATIONS.map(|angle| rotate(&template.feature, angle)))
            });
            let mut best = &variants[0];
            let mut quick = -1.;
            for variant in variants.iter() {
                let value = compare(feature, variant, 2);
                if value > quick {
                    quick = value;
                    best = variant;
                }
            }
            *score = score.max(compare(feature, best, 1) - 0.006);
        }
        ranked.sort_by(score_order);
    }
    ranked.truncate(3);
    ranked
}

fn digit_shape(pixels: &[u8]) -> Digit {
    let mut shape = Digit::default();
    for (y, row) in pixels.chunks_exact(SIDE).enumerate() {
        for (x, &value) in row.iter().enumerate() {
            if value > 127 {
                shape.mask[y] |= 1 << x;
                shape.count += 1;
            }
        }
    }
    shape
}

fn read_digits(pixels: &[u8], count: usize, bank: &[Vec<Digit>; 10]) -> (i32, f32) {
    if !(1..=6).contains(&count) || pixels.len() != count * SIDE * SIDE {
        return (-1, 0.);
    }
    let mut quantity = 0;
    let mut confidence: f32 = 1.;
    for sample in pixels.chunks_exact(SIDE * SIDE).map(digit_shape) {
        if sample.count < 8 {
            return (-1, 0.);
        }
        let mut scores = [(0, 0.); 10];
        for (digit, variants) in bank.iter().enumerate() {
            let mut best: f32 = 0.;
            for reference in variants {
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        let overlap: u32 = sample
                            .mask
                            .iter()
                            .enumerate()
                            .map(|(y, line)| {
                                let other = reference
                                    .mask
                                    .get((y as i32 + dy) as usize)
                                    .copied()
                                    .unwrap_or(0);
                                (line & shift(other, dx)).count_ones()
                            })
                            .sum();
                        best =
                            best.max(2. * overlap as f32 / (sample.count + reference.count) as f32);
                    }
                }
            }
            scores[digit] = (digit, best);
        }
        scores.sort_by(score_order);
        let (digit, score) = scores[0];
        if score < 0.58 {
            return (-1, 0.);
        }
        quantity = quantity * 10 + digit as i32;
        confidence = confidence.min(score);
        if score - scores[1].1 < 0.035 {
            confidence = confidence.min(0.65);
        }
    }
    (quantity, confidence)
}

#[derive(Default)]
struct Scanner {
    input: Vec<u8>,
    result: Vec<u8>,
    items: Vec<Template>,
    digits: [Vec<Digit>; 10],
}

thread_local! {
    static SCANNER: RefCell<Scanner> = RefCell::new(Scanner::default());
}

fn dimensions(width: usize, height: usize) -> Option<usize> {
    width
        .checked_mul(height)
        .filter(|&n| width > 0 && height > 0 && n <= MAX_PIXELS)
}

#[no_mangle]
pub extern "C" fn input_ptr(size: usize) -> *mut u8 {
    if size > MAX_PIXELS * 4 + 64 * 1025 {
        return std::ptr::null_mut();
    }
    SCANNER.with_borrow_mut(|state| {
        state.input.resize(size, 0);
        state.input.as_mut_ptr()
    })
}

#[no_mangle]
pub extern "C" fn load_references(
    atlas_width: usize,
    atlas_height: usize,
    items: usize,
    numbers: usize,
) -> u32 {
    SCANNER.with_borrow_mut(|state| {
        let Some(art) = dimensions(atlas_width, atlas_height).map(|size| size * 4) else {
            return 0;
        };
        const TILE: usize = 64;
        let cols = atlas_width / TILE;
        if cols == 0
            || items == 0
            || items > cols * (atlas_height / TILE)
            || numbers > 64
            || state.input.len() != art + numbers * (SIDE * SIDE + 1)
        {
            return 0;
        }
        let mut digits: [Vec<Digit>; 10] = Default::default();
        for pixels in state.input[art..].chunks_exact(SIDE * SIDE + 1) {
            let Some(variants) = digits.get_mut(pixels[0] as usize) else {
                return 0;
            };
            variants.push(digit_shape(&pixels[1..]));
        }
        if digits.iter().any(Vec::is_empty) {
            return 0;
        }
        let mut tile = vec![0; TILE * TILE * 4];
        state.items = (0..items)
            .map(|i| {
                let x = i % cols * TILE;
                let y = i / cols * TILE;
                for (row, dest) in tile.chunks_exact_mut(TILE * 4).enumerate() {
                    let offset = ((y + row) * atlas_width + x) * 4;
                    dest.copy_from_slice(&state.input[offset..offset + TILE * 4]);
                }
                Template {
                    feature: describe(&tile, TILE, TILE),
                    rotations: None,
                }
            })
            .collect();
        state.digits = digits;
        1
    })
}

fn push_u32(bytes: &mut Vec<u8>, number: u32) {
    bytes.extend(number.to_le_bytes());
}

#[no_mangle]
pub extern "C" fn recognize(width: usize, height: usize, digits: usize, skip_zero: bool) -> *const u8 {
    SCANNER.with_borrow_mut(|state| {
        let Some(bytes) = dimensions(width, height).map(|size| size * 4) else {
            return std::ptr::null();
        };
        if state.input.len() < bytes {
            return std::ptr::null();
        }
        let (quantity, confidence) = read_digits(&state.input[bytes..], digits, &state.digits);
        let ranked = if quantity == 0 && confidence >= 0.85 && skip_zero {
            Vec::new()
        } else {
            let feature = describe(&state.input[..bytes], width, height);
            match_item(&feature, &mut state.items)
        };
        state.result.clear();
        push_u32(&mut state.result, quantity as u32);
        push_u32(&mut state.result, confidence.to_bits());
        push_u32(&mut state.result, ranked.len() as u32);
        for (index, score) in ranked {
            push_u32(&mut state.result, index as u32);
            push_u32(&mut state.result, score.to_bits());
        }
        state.result.as_ptr()
    })
}

#[no_mangle]
pub extern "C" fn extract_inventory(width: usize, height: usize, video: bool) -> *const u8 {
    SCANNER.with_borrow_mut(|state| {
        if dimensions(width, height).map(|size| size * 4) != Some(state.input.len()) {
            return std::ptr::null();
        }
        state.result.clear();
        inventory::extract(&state.input, width, height, video, &mut state.result);
        state.result.as_ptr()
    })
}
