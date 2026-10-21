//! The ship's hull, drawn from its upright dots: as braille in a few styles, or
//! as Kitty image tiles, one per flight tilt. Shared by Bun and the browser.
import * as moonlander from "./moonlander";
import * as faces from "./moonlander_faces";

/** `image` turns the upright dots smoothly as Kitty graphics. Without them the
 * hull is braille: `turned-gray` turns the upright dots as pixel art with gray
 * edges, `turned` without them, and `fixed` redraws the outline at each tilt. */
export type Style = "image" | "turned-gray" | "turned" | "fixed";
export const styles: Style[] = ["image", "turned-gray", "turned", "fixed"];
export type Braille = Exclude<Style, "image">;
/** The braille hull where the image can't be shown. */
export const fallback: Braille = "turned-gray";
export function parseStyle(name: string): Style | null {
  return (styles as string[]).includes(name) ? (name as Style) : null;
}

/** Flight tilts are k × step for k in −turns…turns; each has its own tile. */
export const step = 0.12,
  turns = 13,
  tiles = 2 * turns + 1;
/** The tile that shows a tilt: the nearest flight tilt. */
export function tile(a: number): number {
  return moonlander.clamp(Math.round(a / step), -turns, turns) + turns;
}
export function angle(index: number): number {
  return moonlander.clamp((index - turns) * step, -moonlander.MAX_TILT, moonlander.MAX_TILT);
}
/** The angle `style` draws a tilt at: the nearest tile's, or for `fixed`
 * the nearest degree. The face turns with it. */
export function drawn(style: Style, a: number): number {
  return style === "fixed" ? (Math.round((a * 180) / Math.PI) * Math.PI) / 180 : angle(tile(a));
}

/** A dot of the hull from the ship's origin, lit at `level`, 1 being solid. */
export type Dot = { x: number; y: number; level: number };
const cache = new Map<string, Dot[]>();
const upright = (engine: moonlander.Engine) => engine.shipDots(0);
/** How far the upright dots reach from the origin, in dots either way. */
function reach(engine: moonlander.Engine) {
  const K = engine.world.K;
  return (
    Math.ceil(Math.max(...upright(engine).map(([x, y]) => Math.hypot(Math.abs(x) + 1, (Math.abs(y) + 1) * K)))) + 1
  );
}
export function dots(engine: moonlander.Engine, style: Braille, a: number): Dot[] {
  if (style === "fixed") return engine.shipDots(a).map(([x, y]) => ({ x, y, level: 1 }));
  const index = tile(a),
    key = `${style}/${engine.world.K}/${index}`;
  let out = cache.get(key);
  if (!out) cache.set(key, (out = style === "turned" ? turned(engine, index) : turnedGray(engine, index)));
  return out;
}
// Each dot of a turned tilt, by what the upright dots show at `sample` points
// within it, in physical units turned back upright.
function turn(engine: moonlander.Engine, index: number, sample: (u: number, v: number) => number, samples: number) {
  const K = engine.world.K,
    a = angle(index),
    cos = Math.cos(a),
    sin = Math.sin(a),
    r = reach(engine),
    rows = Math.ceil(r / K),
    out: Dot[] = [];
  for (let y = -rows; y <= rows; y++)
    for (let x = -r; x <= r; x++) {
      let lit = 0;
      for (let j = 0; j < samples; j++)
        for (let i = 0; i < samples; i++) {
          const px = x + (i + 0.5) / samples,
            py = (y + (j + 0.5) / samples) * K;
          lit += sample(px * cos + py * sin, (py * cos - px * sin) / K);
        }
      if (lit > 0) out.push({ x, y, level: lit / samples ** 2 });
    }
  return out;
}
// RotSprite: the upright dots scaled 8× with Scale2x three times, which rounds
// their steps the way pixel art scales, then sampled at each turned dot's center.
function turned(engine: moonlander.Engine, index: number): Dot[] {
  const dots = upright(engine),
    x0 = Math.min(...dots.map(([x]) => x)) - 1,
    y0 = Math.min(...dots.map(([, y]) => y)) - 1;
  let w = Math.max(...dots.map(([x]) => x)) - x0 + 2,
    h = Math.max(...dots.map(([, y]) => y)) - y0 + 2,
    grid: Uint8Array = new Uint8Array(w * h);
  for (const [x, y] of dots) grid[(y - y0) * w + x - x0] = 1;
  for (let i = 0; i < 3; i++) ((grid = scale2x(grid, w, h)), (w *= 2), (h *= 2));
  return turn(
    engine,
    index,
    (u, v) => {
      const gx = Math.floor((u - x0) * 8),
        gy = Math.floor((v - y0) * 8);
      return gx >= 0 && gy >= 0 && gx < w && gy < h ? grid[gy * w + gx] : 0;
    },
    1,
  );
}
function scale2x(grid: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4),
    at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : grid[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = at(x, y),
        a = at(x, y - 1),
        b = at(x + 1, y),
        c = at(x - 1, y),
        d = at(x, y + 1),
        o = 4 * y * w + 2 * x;
      out[o] = c === a && c !== d && a !== b ? a : p;
      out[o + 1] = a === b && a !== c && b !== d ? b : p;
      out[o + 2 * w] = d === c && d !== b && c !== a ? c : p;
      out[o + 2 * w + 1] = b === d && b !== a && d !== c ? d : p;
    }
  return out;
}
// The upright dots as plain squares turned, each dot lit by how much of it
// they cover, so upright stays exact; dots under a third covered stay dark.
function turnedGray(engine: moonlander.Engine, index: number): Dot[] {
  const lit = new Set(upright(engine).map(([x, y]) => x + "," + y));
  return turn(engine, index, (u, v) => (lit.has(Math.floor(u) + "," + Math.floor(v)) ? 1 : 0), 8).filter(
    dot => dot.level >= 0.3,
  );
}

/** One tilt's tile: alpha rows of w × h, with the ship's origin at (ox, oy). */
export interface Sprite {
  w: number;
  h: number;
  ox: number;
  oy: number;
  alpha: Uint8Array;
}
/** The upright dots as squares the size of Ghostty's braille dots, a braille
 * dot apart, turned as one piece to a flight tilt and antialiased, for cells
 * of `cw` × `ch` pixels. */
export function sprite(engine: moonlander.Engine, cw: number, ch: number, index: number): Sprite {
  const a = angle(index),
    cos = Math.cos(a),
    sin = Math.sin(a),
    size = Math.max(1, Math.min(Math.floor(cw / 4), Math.floor(ch / 8))),
    half = size / 2;
  // Upright, each square sits on whole pixels, as crisp as braille.
  const snap = (c: number) => (a === 0 ? Math.round(c - half) + half : c);
  const centers = upright(engine).map(([i, j]) => {
    const x = ((i + 0.5) * cw) / 2,
      y = ((j + 0.5) * ch) / 4;
    return [snap(x * cos - y * sin), snap(x * sin + y * cos)];
  });
  const left = Math.floor(Math.min(...centers.map(([x]) => x)) - size),
    top = Math.floor(Math.min(...centers.map(([, y]) => y)) - size),
    w = Math.ceil(Math.max(...centers.map(([x]) => x)) + size) - left,
    h = Math.ceil(Math.max(...centers.map(([, y]) => y)) + size) - top,
    alpha = new Uint8Array(w * h),
    n = 4;
  for (const [cx, cy] of centers)
    for (let y = Math.floor(cy - top - size); y <= cy - top + size; y++)
      for (let x = Math.floor(cx - left - size); x <= cx - left + size; x++) {
        let hit = 0;
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            const dx = x + (i + 0.5) / n - (cx - left),
              dy = y + (j + 0.5) / n - (cy - top);
            if (Math.abs(dx * cos + dy * sin) <= half && Math.abs(dy * cos - dx * sin) <= half) hit++;
          }
        if (hit) alpha[y * w + x] = Math.max(alpha[y * w + x], Math.round((hit / n ** 2) * 255));
      }
  return { w, h, ox: -left, oy: -top, alpha };
}
/** Whole-pixel crops of a tile at the ship's position, clipped to the world
 * and around `occludes` (cells) as the face is. Usually one; more where the
 * ship wraps past an edge or slides under an overlay. */
export function placements(
  engine: moonlander.Engine,
  tile: Sprite,
  cw: number,
  ch: number,
  occludes: faces.Rect[] = [],
): faces.Placement[] {
  const L = engine.lander;
  if (!L) return [];
  const [px, py] = faces.origin(engine, cw, ch, false),
    x = px - tile.ox,
    y = py - tile.oy,
    bounds = { x: 0, y: 0, w: engine.world.cols * cw, h: engine.world.rows * ch },
    hidden = occludes.map(r => ({
      x: Math.floor(r.x * cw),
      y: Math.floor(r.y * ch),
      w: Math.ceil(r.w * cw),
      h: Math.ceil(r.h * ch),
    }));
  const out: faces.Placement[] = [];
  for (const shift of [0, -bounds.w, bounds.w]) {
    const clip = faces.intersect({ x: x + shift, y, w: tile.w, h: tile.h }, bounds);
    if (!clip) continue;
    let pieces = [clip];
    for (const r of hidden) pieces = pieces.flatMap(piece => faces.subtract(piece, r));
    for (const piece of pieces) out.push({ ...piece, sx: piece.x - x - shift, sy: piece.y - y });
  }
  return out;
}
