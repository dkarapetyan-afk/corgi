//! Moonlander cell rendering, shared by the terminal and website.
import * as moonlander from "./moonlander";
import * as hull from "./moonlander_hull";
import type { Token } from "./palette";

const displayWidth = (text: string) => [...text].length;

/** `alpha` is how much of `fg` shows over `bg`: less on a gray hull's edges. */
export type Cell = { glyph: string; fg: Token; bg: Token; dots: number; bold: boolean; alpha: number };
const BRAILLE = [1, 8, 2, 16, 4, 32, 64, 128];
const hash = (x: number, y: number, seed: number) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const heat = (age: number): Token =>
  age < 0.12 ? "strong" : age < 0.5 ? "warm" : age < 1.1 ? "hot" : age < 2.2 ? "muted" : "faint";
const judge = (v: number, soft: number, safe: number): Token => (v <= soft ? "accent" : v <= safe ? "warm" : "hot");

function fuelBar(s: Screen, col: number, row: number, lander: moonlander.Lander, time: number) {
  const width = 12,
    fuel = Math.ceil(lander.fuel),
    color = fuel > 240 ? "accent" : fuel > 96 ? "warm" : "hot",
    fill = moonlander.clamp(Math.ceil((lander.fuel / lander.fuelMax) * width * 2), 0, width * 2);
  col = s.text(col, row, "fuel ", "faint");
  s.text(col, row, " ".repeat(width + 2));
  s.text(col, row, " ".repeat(width), color, "selected");
  s.text(col, row, "█".repeat(Math.floor(fill / 2)) + (fill % 2 ? "▌" : ""), color, "selected");
  if (lander.flame > 0.02) {
    const edge = col + Math.ceil(fill / 2),
      tip = edge * 2,
      frame = Math.floor(time * 10),
      reach = lander.flame * (3.3 + hash(frame, 0, 17) * 0.7);
    if (fill > 0) s.put(edge - 1, row, "█", "warm", "selected");
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 4; y++)
        if (
          x + 0.25 < reach &&
          Math.abs(y - 1.5 - Math.sin(frame * 1.7) * x * 0.12) <= 2 * (1 - x / Math.max(1, reach))
        )
          s.dot(tip + x, row * 4 + y, x < 2 ? "warm" : "hot");
  }
  return s.text(col + width + 2, row, ` ${String(fuel).padStart(3)} `, color);
}

/** A cell grid shared by the terrain, ship, exhaust and wreck. */
export class Screen {
  /** Vertical world offset in braille dots. */
  cameraY = 0;
  occludes: { x: number; y: number; w: number; h: number }[] = [];
  cells: Cell[];
  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.cells = Array.from({ length: cols * rows }, () => ({
      glyph: " ",
      fg: "text",
      bg: "bg",
      dots: 0,
      bold: false,
      alpha: 1,
    }));
  }
  put(col: number, row: number, glyph: string, fg: Token = "text", bg: Token = "bg", bold = false) {
    this.set(col, Math.floor(row - this.cameraY / 4), glyph, fg, bg, bold);
  }
  /** A glyph in a cell on screen, whatever the camera. */
  set(col: number, row: number, glyph: string, fg: Token = "text", bg: Token = "bg", bold = false, alpha = 1) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    this.cells[row * this.cols + col] = { glyph, fg, bg, dots: 0, bold, alpha };
  }
  text(col: number, row: number, value: string, fg: Token = "text", bg: Token = "bg", bold = false) {
    for (const glyph of value) {
      this.put(col, row, glyph, fg, bg, bold);
      col += displayWidth(glyph);
    }
    return col;
  }
  dot(x: number, y: number, color: Token) {
    x = Math.floor(x);
    y = Math.floor(y - this.cameraY);
    const col = Math.floor(x / 2),
      row = Math.floor(y / 4);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    const cell = this.cells[row * this.cols + col];
    cell.dots |= BRAILLE[(y % 4) * 2 + (x % 2)];
    cell.glyph = String.fromCodePoint(0x2800 + cell.dots);
    cell.fg = color;
    cell.alpha = 1;
  }
}

type Terrain = Pick<moonlander.World, "W" | "rows" | "K" | "ground" | "pads" | "seed">;
/** A thin line at each eighth of a cell, top to bottom. */
const lines = ["▔", ...Array.from({ length: 6 }, (_, i) => String.fromCodePoint(0x1fb76 + i)), "▁"];
/** Where a pad's line sits on screen, in eighths of a cell from the top:
 * an eighth into the cell its surface dot starts in, level with the ground
 * beside it, with the camera `camera` dots down the world. */
const padEighth = (p: moonlander.Pad, K: number, camera: number) => 2 * Math.floor(Math.round(p.y / K) - camera) + 1;
/** `slide` draws pads as thin lines that move an eighth of a cell at a time
 * with the ground's dots as the camera pans, rather than jump a cell, and
 * blurs each multiplier across the rows it passes while the camera has been
 * still under `still` seconds. */
function terrain(
  s: Screen,
  w: Terrain,
  padColor: Token = "accent",
  multipliers = true,
  slide = true,
  still = Infinity,
) {
  const R = 4 * w.K;
  const surface = Array.from({ length: w.W }, (_, x) => Math.floor(w.ground(x + 0.5) / w.K));
  for (let x = 0; x < w.W; x++) {
    const top = Math.min(surface[x], surface[moonlander.mod(x - 1, w.W)] + 1, surface[moonlander.mod(x + 1, w.W)] + 1);
    if (!w.pads.some(p => x >= p.x0 && x < p.x1)) for (let y = top; y <= surface[x]; y++) s.dot(x, y, "muted");
    for (let y = surface[x] + 1; y < w.rows * 4; y++)
      if (hash(x, y, w.seed) < 0.06 + 0.3 * Math.exp(-(y - surface[x]) / 5)) s.dot(x, y, "line");
  }
  for (const p of w.pads) {
    const from = Math.ceil(p.x0 / 2),
      to = Math.floor(p.x1 / 2);
    if (!slide) {
      s.text(from, Math.round(p.y / R), "━".repeat(to - from), padColor);
      continue;
    }
    const eighth = padEighth(p, w.K, s.cameraY);
    for (let col = from; col < to; col++)
      s.set(col, Math.floor(eighth / 8), lines[moonlander.mod(eighth, 8)], padColor);
    if (!multipliers) continue;
    // A cell under the line at rest, so never in the line's row. While the
    // camera pans, a label between rows shows in both, each as bright as it
    // is near, lifted so the split doesn't read as dim; once the camera has
    // held still a moment it settles into the nearer row.
    const at = (eighth - 1) / 8 + 1,
      row = Math.floor(at),
      past = at - row,
      settled = Math.min(1, still / 0.2),
      lower = past < 0.5 ? 0 : 1;
    for (const [offset, share] of [
      [0, (1 - settled) * (1 - past) + settled * (1 - lower)],
      [1, (1 - settled) * past + settled * lower],
    ])
      if (share > 0)
        [...`×${p.mult}`].forEach((glyph, i) =>
          s.set(Math.round((p.x0 + p.x1) / 4 - 1) + i, row + offset, glyph, padColor, "bg", true, share ** 0.6),
        );
  }
}

// The hull's dots on screen at the ship's whole-dot origin, each cell as
// bright as its dots are on average, lifted so a gray edge split across two
// rows doesn't read as dim.
function brailleHull(
  s: Screen,
  engine: moonlander.Engine,
  L: moonlander.Lander,
  style: hull.Braille,
  ox: number,
  oy: number,
) {
  const W = engine.world.W,
    light = new Map<number, { sum: number; n: number }>();
  for (const dot of hull.dots(engine, style, L.a)) {
    const x = moonlander.mod(ox + dot.x, W),
      y = oy + dot.y;
    s.dot(x, y, "text");
    const col = Math.floor(x / 2),
      row = Math.floor(y / 4);
    if (row < 0 || row >= s.rows) continue;
    const at = row * s.cols + col,
      cell = light.get(at) ?? { sum: 0, n: 0 };
    light.set(at, { sum: cell.sum + dot.level, n: cell.n + 1 });
  }
  for (const [at, { sum, n }] of light) s.cells[at].alpha = Math.round((sum / n) ** 0.6 * 16) / 16;
}

let landingShip: moonlander.Engine | null = null;
/** A parked ship, using the game's geometry and terrain without its HUD. */
export function landing(cols: number, rows: number): Screen {
  if (!landingShip) {
    landingShip = moonlander.create({ size: () => ({ cols: 72, rows: 24 }), aspect: 2.2, random: () => 0.5 });
    landingShip.title();
  }
  const s = new Screen(cols, rows),
    K = landingShip.world.K,
    W = cols * 2,
    center = Math.floor(cols / 2) * 2 + 1,
    face = moonlander.FACE.calm,
    pad = { x0: center - 18, x1: center + 18, y: (rows - 2) * 4 * K, mult: 2 },
    ground = (x: number) => {
      const distance = Math.max(0, Math.abs(x - center) - 18),
        slope = Math.min(1, distance / Math.max(1, cols - 18));
      return (
        pad.y - (rows - 2) * 4 * K * Math.pow(slope, 0.55) + (Math.sin(x * 0.43) + Math.sin(x * 0.91) * 0.4) * slope * 2
      );
    };
  terrain(s, { W, rows, K, ground, pads: [pad], seed: 7302 }, "text", false, false);
  const L = { ...landingShip.lander!, x: center, y: pad.y - 10 * K };
  for (const e of landingShip.shipCells(L).cells.values())
    for (let b = 0; b < 8; b++)
      if (e.bits & (1 << b)) s.dot(e.col * 2 + (b % 2), e.row * 4 + Math.floor(b / 2), "text");
  s.text(
    Math.round((L.x - displayWidth(face)) / 2),
    Math.floor((L.y + moonlander.SHIP.face) / (4 * K)),
    face,
    "strong",
  );
  return s;
}

/** `style` draws the hull as braille, or leaves it to the image. */
export function render(engine: moonlander.Engine, smoothFace = false, style: hull.Style = hull.fallback): Screen {
  const { world: w, game, lander: L, wreck, corgi } = engine,
    s = new Screen(w.cols, w.rows);
  const R = 4 * w.K,
    skyY = (engine.cameraY / w.K) * 0.12;
  const dot = (x: number, y: number, color: Token) => s.dot(moonlander.mod(x, w.W), y / w.K, color);
  for (const star of w.stars) s.dot(star.dx, moonlander.mod(star.dy - skyY, w.rows * 4), star.color);
  for (const tw of w.twinkles) {
    const b = Math.sin(game.t * tw.speed + tw.phase);
    if (b > -0.3)
      s.put(tw.col, moonlander.mod(tw.row - skyY / 4, w.rows), b > 0.7 ? "+" : "·", b > 0.7 ? "muted" : "faint");
  }
  const earth = w.earth;
  for (let x = Math.floor(earth.x - earth.r); x <= earth.x + earth.r; x++)
    for (let y = Math.floor((earth.y - earth.r) / w.K); y <= (earth.y + earth.r) / w.K; y++) {
      const dx = x + 0.5 - earth.x,
        dy = (y + 0.5) * w.K - earth.y;
      if (
        dx * dx + dy * dy < earth.r ** 2 &&
        (dx - earth.r * 0.55) ** 2 + (dy + earth.r * 0.25) ** 2 > (earth.r * 0.92) ** 2
      )
        s.dot(x, moonlander.mod(y - skyY, w.rows * 4), hash(x >> 1, y >> 1, w.seed) < 0.45 ? "text" : "faint");
    }
  s.cameraY = engine.cameraY / w.K;
  terrain(s, w, "accent", true, true, game.paused ? Infinity : engine.cameraStill);
  for (const p of engine.particles) {
    const k = p.age / p.life;
    const color =
      p.kind === "dust"
        ? k < 0.5
          ? "faint"
          : "line"
        : p.kind === "puff"
          ? "muted"
          : k < 0.3
            ? "warm"
            : k < 0.7
              ? "hot"
              : "faint";
    dot(p.x, p.y, color);
    if (p.kind === "spark") dot(p.x - p.vx * 0.03, p.y - p.vy * 0.03, color);
  }
  if (wreck) {
    const age = game.t - wreck.t0;
    for (const d of engine.debris)
      for (const p of d.trail.slice(1)) dot(p.x, p.y, age - d.cool < 1.1 ? "hot" : "faint");
    for (const m of wreck.smoke)
      for (let k = 0; k < Math.max(1, Math.round(7 * (1 - m.age / 2.2))); k++) {
        const spread = 1 + m.age * 1.5;
        dot(
          m.x + (hash(m.seed, k, 1) - 0.5) * 2 * spread,
          m.y + (hash(m.seed, k, 2) - 0.5) * 3 * spread,
          m.age < 0.8 ? "muted" : m.age < 1.5 ? "faint" : "line",
        );
      }
    if (age <= 0.35) {
      const r = 3 + age * 90,
        n = Math.ceil(r * 1.8);
      for (let k = 0; k <= n; k++) {
        const a = Math.PI + (Math.PI * k) / n,
          x = wreck.x + r * Math.cos(a),
          y = wreck.y + r * Math.sin(a);
        if (y < w.ground(x)) dot(x, y, age < 0.12 ? "text" : "faint");
      }
    }
    if (age < 0.5) {
      const reach = 4 + age * 40,
        fade = 1 - age / 0.5;
      for (let x = Math.floor(wreck.x - reach); x <= wreck.x + reach; x++)
        for (let y = Math.floor((wreck.y - reach) / w.K); y * w.K <= wreck.y + 2; y++) {
          const d = Math.hypot(x + 0.5 - wreck.x, (y + 0.5) * w.K - wreck.y) / reach;
          if (d > 1 || (y + 0.5) * w.K > w.ground(x) + 1) continue;
          const density = d < 0.8 ? fade * fade + (fade - fade * fade) * (d / 0.8) : (fade * (1 - d)) / 0.2;
          if (hash(x, y, Math.floor(game.t * 30)) < density)
            s.dot(moonlander.mod(x, w.W), y, d < 0.35 && age < 0.25 ? "strong" : d < 0.7 ? "warm" : "hot");
        }
    }
  }
  // Clear the cabin before drawing its outline and passenger.
  if (L) {
    const cos = Math.cos(L.a),
      sin = Math.sin(L.a),
      reach = 20;
    for (let row = Math.floor((L.y - reach) / R); row <= (L.y + reach) / R; row++)
      for (let col = Math.floor((L.x - reach) / 2); col <= (L.x + reach) / 2; col++) {
        const dx = col * 2 + 1 - L.x,
          dy = (row + 0.5) * R - L.y;
        const x = dx * cos + dy * sin,
          y = dy * cos - dx * sin;
        if (
          (Math.abs(x) < moonlander.SHIP.cabin && y > -moonlander.SHIP.top && y < 0) ||
          (Math.abs(x) < moonlander.SHIP.body && y >= 0 && y < R)
        )
          s.put(moonlander.mod(col, w.cols), row, " ");
      }
  }
  for (const d of engine.debris) {
    const bits = Number(d.g.slice(3)),
      col = engine.cellOf(d.x),
      row = Math.floor(d.y / R);
    s.put(col, row, " ");
    for (let b = 0; b < 8; b++)
      if (bits & (1 << b)) s.dot(col * 2 + (b % 2), row * 4 + Math.floor(b / 2), heat(game.t - wreck!.t0 - d.cool));
  }
  if (corgi) {
    const col = engine.cellOf(corgi.x),
      row = corgi.y / R,
      since = corgi.down === null ? 0 : corgi.t - corgi.down;
    const face = corgi.air
      ? corgi.crashed
        ? moonlander.FACE.scared
        : moonlander.FACE.burn
      : corgi.crashed
        ? moonlander.FACE.dizzy
        : since < 0.6 || corgi.t % 3.1 < 0.13
          ? moonlander.FACE.blink
          : moonlander.FACE.calm;
    s.text(col - 2, row, face, "strong");
    if (!corgi.air && !corgi.crashed) s.put(col - 3, row, moonlander.TAIL[Math.floor(since * 8) % 4], "strong");
    if (!corgi.air && corgi.crashed) {
      const offset = [-2, -1, 0, 1, 2, 1, 0, -1][Math.floor(corgi.t * 10) % 8];
      s.put(col + offset, row - 1, "*", "warm");
      s.put(col - offset, row - 1, "+", "warm");
    }
  }
  // The ship and its passenger, on screen rather than in the world, so a
  // camera that follows the ship doesn't jostle it.
  s.cameraY = 0;
  if (L) {
    const [ox, oy] = engine.shipAt(L, engine.cameraY);
    if (style !== "image") brailleHull(s, engine, L, style, ox, oy);
    const face = engine.face();
    if (face && !smoothFace)
      s.text(
        Math.round((ox - moonlander.SHIP.face * Math.sin(L.a)) / 2 - 2),
        (oy * w.K + moonlander.SHIP.face * Math.cos(L.a)) / R,
        face,
        "strong",
      );
  }
  const scores = `${game.state === "title" ? "" : `moon ${game.round}   score ${game.score}   `}best ${game.best}`;
  s.text(w.cols - scores.length - 2, 0, scores, "strong");
  if (L && game.state !== "title") {
    const burning = game.state === "flying" && !game.paused && engine.keys.up && L.fuel > 0,
      altitude = Math.max(0, Math.round(w.ground(L.x) - L.y - 10 * w.K));
    let col = fuelBar(s, 2, 2, L, game.t);
    col = s.text(col, 2, `${burning ? "ON " : "off"}   alt ${String(altitude).padStart(3)}   `, "faint");
    col = s.text(
      col,
      2,
      `↓ ${L.vy.toFixed(1).padStart(4)}   `,
      judge(Math.max(0, L.vy), moonlander.SOFT.vy, moonlander.SAFE.vy),
    );
    col = s.text(
      col,
      2,
      `→ ${L.vx.toFixed(1).padStart(4)}   `,
      judge(Math.abs(L.vx), moonlander.SOFT.vx, moonlander.SAFE.vx),
    );
    s.text(
      col,
      2,
      `tilt ${Math.round((L.a * 180) / Math.PI)}°`,
      judge(Math.abs(L.a), moonlander.SOFT.a, moonlander.SAFE.a),
    );
  }
  let card: string[] | null = null,
    color: Token = "strong";
  const r = game.result;
  if (game.paused) card = ["paused", "", "p / space to resume"];
  else if (game.state === "title")
    card = [
      "moonlander",
      "",
      "land the corgi on a pad, gently",
      "",
      "← → / a d  tilt     ↑ / space  thrust",
      "",
      "space / enter to launch",
    ];
  else if (engine.settled() && r) {
    if (game.state === "landed") {
      card = [
        r.soft ? "good boy!" : "bumpy, but good boy.",
        "",
        `+${r.points! + r.bonus!}   ×${r.pad!.mult} pad · ${r.bonus} fuel bonus`,
        `score ${game.score}${r.best ? "   new best" : ""}`,
        "",
        "space / enter for next moon",
      ];
      color = r.soft ? "accent" : "warm";
    } else if (game.state === "crashed") {
      card = ["wuff landing.", r.why!, "", `score ${game.score}   best ${game.best}`, "", "space / enter to try again"];
      color = "hot";
    }
  }
  if (card) {
    const width = Math.max(...card.map(displayWidth)) + 6,
      height = card.length + 4;
    const left = Math.floor((w.cols - width) / 2),
      top = Math.min(Math.max(10, Math.floor(w.rows * 0.24)), w.rows - height - 2);
    for (let row = 0; row < height; row++) {
      s.text(left, top + row, " ".repeat(width), "text", "surface");
      s.put(left, top + row, row === 0 ? "╭" : row === height - 1 ? "╰" : "│", "line", "surface");
      s.put(left + width - 1, top + row, row === 0 ? "╮" : row === height - 1 ? "╯" : "│", "line", "surface");
      if (row === 0 || row === height - 1) s.text(left + 1, top + row, "─".repeat(width - 2), "line", "surface");
    }
    s.occludes.push({ x: left, y: top, w: width, h: height });
    card.forEach((line, i) =>
      s.text(
        left + Math.floor((width - displayWidth(line)) / 2),
        top + 2 + i,
        line,
        i === 0 ? color : "muted",
        "surface",
        i === 0,
      ),
    );
  }
  const footer = "← → tilt   ↑/space thrust   ↓ cut   p pause   r restart   q quit";
  s.text(Math.floor((w.cols - footer.length) / 2), w.rows - 1, footer, "faint");
  s.occludes.push(
    { x: 0, y: 0, w: w.cols, h: 1 },
    { x: 0, y: 2, w: w.cols, h: 1 },
    { x: 0, y: w.rows - 1, w: w.cols, h: 1 },
  );
  return s;
}
