//! Moonlander simulation and ship geometry, shared by the site and viewer.
export const G = 9,
  THRUST = 21,
  TURN = 2.4,
  BURN = 60,
  MAX_TILT = Math.PI / 2,
  HOP_G = 20,
  /** How many rows the corgi climbs or steps down in a stride, rather than hop or fall. */
  CLIMB = 2,
  STEP = 1 / 120;
export const SOFT = { vy: 5, vx: 2.5, a: 0.12 },
  SAFE = { vy: 9, vx: 5, a: 0.24 };
export const FACE = { calm: "ᐯ•ᴥ•ᐯ", blink: "ᐯ◡ᴥ◡ᐯ", burn: "ᐱ•ᴥ•ᐱ", scared: "ᐯ°ᴥ°ᐯ", dizzy: "ᐯ@ᴥ@ᐯ" };
export const TAIL = ["~", "-", "~", "^"];
/** The corgi off the ship, facing right, as the sidebar draws it digging up a bone. */
export const POSE = {
  sit: "~ᐯ•ᴥ•ᐯ",
  blink: "~ᐯ◡ᴥ◡ᐯ",
  perk: "~ᐱ•ᴥ•ᐱ",
  sniff: ["~ᐯ•ω•ᐯ", "~ᐯ•ˑ•ᐯ"],
  chew: "~ᐯ◡ω◡ᐯ",
  trot: ["~[/\\]o>", "~[||]o>", "~[\\/]o>", "~[||]o>"],
  dig: ["~[\\/]o›", "~[/\\]o›"],
  still: "~[||]o›",
};
export const BONE = "ε=з";
export const SHIP = { cabin: 7.5, top: 12, body: 9.5, face: -6, corner: 1 };
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const mod = (v: number, n: number) => ((v % n) + n) % n;
export const octant = (bits: number) => "oct" + bits;
const bitsOf = (g: string) => +g.slice(3);
export type Point = [number, number];
export interface PixelCell {
  col: number;
  row: number;
  bits: number;
}
export interface Pad {
  x0: number;
  x1: number;
  y: number;
  mult: number;
}
export interface World {
  cols: number;
  rows: number;
  W: number;
  H: number;
  K: number;
  g: Float64Array;
  ground(x: number): number;
  pads: Pad[];
  seed: number;
  stars: { dx: number; dy: number; color: "line" | "faint" }[];
  twinkles: { col: number; row: number; phase: number; speed: number }[];
  earth: { x: number; y: number; r: number };
}
export interface Lander {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  fuel: number;
  fuelMax: number;
  flame: number;
  puff: number;
  held: number;
  ears: number;
  scared: number;
}
export interface Particle {
  kind: "flame" | "puff" | "dust" | "spark" | "fire" | "clod";
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** A clod's dirt, added to the ground where it lands. */
  dirt?: number;
  /** The dot column's edge a clod is thrown to, to fill a dip. */
  aim?: number;
}
export interface Debris {
  g: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rest: boolean;
  bounced: boolean;
  slid: number;
  cool: number;
  trail: { x: number; y: number }[];
  trailIn: number;
  col: number;
  row: number;
}
export interface Corgi {
  x: number;
  y: number;
  vx: number;
  vy: number;
  air: boolean;
  t: number;
  down: number | null;
  crashed: boolean;
  row: number;
  /** A `POSE`, drawn mirrored when facing left, from the tail three cells
   * behind its column; null draws the face alone. */
  pose: string | null;
  facing: 1 | -1;
  /** How fast a posed tail wags: 0 holds it, 2 is excited. */
  wag: number;
}
/** The bone in its pit, or in the corgi's mouth; `shown` is when each cell
 * was dug clear, and `eaten` counts cells chewed from the corgi's side. */
export interface Bone {
  col: number;
  row: number;
  shown: (number | null)[];
  eaten: number;
  held: boolean;
  facing: 1 | -1;
}
/** Where the corgi digs: its column and row, which way it faces, the bone's
 * first cell and row, and where it sits to chew. It digs the ground at
 * `trench`'s dot columns' edges down to their heights; into a hill, the
 * hillside along `hillside`, from the trench out, slides into what it digs. */
interface Spot {
  col: number;
  row: number;
  facing: 1 | -1;
  first: number;
  bone: number;
  seat: number;
  trench: Map<number, number>;
  hillside: number[];
  /** Dips in where it will eat, and the heights it fills them to. */
  fill: Map<number, number>;
}
export interface Wreck {
  x: number;
  y: number;
  t0: number;
  flames: { col: number; until: number; puff: number }[] | null;
  smoke: { x: number; y: number; age: number; drift: number; seed: number }[];
}
export interface Result {
  why?: string;
  soft?: boolean;
  pad?: Pad;
  points?: number;
  bonus?: number;
  best: boolean;
}
export interface Game {
  state: "title" | "flying" | "landed" | "crashed";
  t: number;
  since: number;
  round: number;
  score: number;
  best: number;
  paused: boolean;
  result: Result | null;
}
export interface Options {
  size(): { cols: number; rows: number };
  aspect: number;
  best?: number;
  random?: () => number;
  changed?: () => void;
  saveBest?: (score: number) => void;
  /** Each flight starts just above a pad, drifting up, and lands softly
   * about a second in. */
  autoland?: boolean;
}
export type Input = "advance" | "thrust" | "cut" | "left" | "right" | "pause" | "restart";
export function create(options: Options) {
  const random = options.random ?? Math.random;
  const rand = (lo: number, hi: number) => lo + random() * (hi - lo);
  // The moon: ground heights at each dot column, wrapping at the edges, with
  // flat pads; narrow pads pay more.
  let world: World,
    cameraY = 0,
    // How long the camera has held still, in game seconds.
    cameraStill = Infinity;
  function makeWorld(cols: number, rows: number, round: number): World {
    const K = options.aspect / 2,
      W = cols * 2,
      H = rows * 4 * K,
      g = new Float64Array(W + 1);
    let size = 1;
    while (size < W) size *= 2;
    const p = new Float64Array(size + 1);
    p[0] = p[size] = H * rand(0.66, 0.8);
    for (let span = size, rough = H * 0.3; span > 1; span >>= 1, rough *= 0.5)
      for (let i = 0; i < size; i += span) p[i + span / 2] = (p[i] + p[i + span]) / 2 + rand(-rough, rough);
    // Stretched rather than clamped, so no flat ground passes for a pad.
    const bottom = H - 5 * K,
      top = bottom - Math.min(H * 0.5, W * 0.36) * rand(0.75, 1);
    const lo = Math.min(...p),
      span = Math.max(...p) - lo || 1;
    for (let i = 0; i <= W; i++) {
      const t = (i / W) * size,
        j = Math.min(size - 1, Math.floor(t));
      g[i] = top + ((p[j] + (p[j + 1] - p[j]) * (t - j) - lo) / span) * (bottom - top);
    }
    const mults = cols < 100 ? [2, 5] : [2, 3, 5],
      shrink = Math.max(0.8, 1 - 0.04 * (round - 1)),
      zone = W / mults.length;
    mults.sort(() => random() - 0.5);
    const pads = mults.map((mult, z) => {
      const w = Math.max(23, Math.round(({ 2: 44, 3: 34, 5: 26 } as Record<number, number>)[mult] * shrink));
      const x0 = Math.round(z * zone + 8 + random() * Math.max(0, zone - w - 16)),
        x1 = x0 + w;
      let y = 0;
      for (let i = x0; i <= x1; i++) y += g[i] / (w + 1);
      y = Math.round(clamp(y, H * 0.48, H - 9 * K) / (4 * K)) * 4 * K;
      for (let i = x0; i <= x1; i++) g[i] = y;
      // Gentle ground either side, for the corgi to dig in.
      for (let d = 1; d <= 14; d++) {
        const keep = (d / 14) ** 2 * (3 - (2 * d) / 14);
        for (const i of [x0 - d, x1 + d]) if (i > 0 && i < W) g[i] = y + (g[i] - y) * keep;
      }
      return { x0, x1, y, mult };
    });
    g[W] = g[0];
    const ground = (x: number) => {
      x = mod(x, W);
      const i = Math.floor(x);
      return g[i] + (g[i + 1] - g[i]) * (x - i);
    };
    const stars: World["stars"] = [],
      twinkles: World["twinkles"] = [];
    for (let n = Math.round((cols * rows) / 26); n > 0; n--) {
      const dx = Math.floor(rand(0, W)),
        dy = Math.floor(rand(12, (ground(dx) - 10) / K));
      if (dy > 12) stars.push({ dx, dy, color: random() < 0.8 ? "line" : "faint" });
    }
    for (let n = 0; n < Math.round(cols / 18); n++) {
      const col = Math.floor(rand(1, cols - 1)),
        row = Math.floor(rand(4, (ground(col * 2 + 1) - 12) / (4 * K)));
      if (row > 4) twinkles.push({ col, row, phase: rand(0, 7), speed: rand(0.6, 1.6) });
    }
    const earth = { x: W * rand(0.7, 0.86), y: H * rand(0.14, 0.2), r: 8 };
    return { cols, rows, W, H, K, g, ground, pads, stars, twinkles, earth, seed: (random() * 1e9) | 0 };
  }

  // The game.
  const game: Game = { state: "title", t: 0, since: 0, round: 1, score: 0, best: 0, paused: false, result: null };
  game.best = options.best ?? 0;
  const keys = { up: false, left: false, right: false };
  let lander: Lander | null = null,
    particles: Particle[] = [],
    debris: Debris[] = [],
    corgi: Corgi | null = null;
  // Outside the ship, the wreck and the corgi live on the cell grid, one glyph
  // per cell. `pile` holds, per column, the row the next thing to land rests in.
  let pile: Int32Array | null = null,
    toppleIn = 0,
    wreck: Wreck | null = null,
    bone: Bone | null = null,
    // The dirt the corgi has thrown, at each dot column: drawn and in the
    // way of what falls, but behind the corgi, which stands in front of it.
    heap: Float64Array | null = null,
    // The dips it is filling, while it digs.
    filling: Map<number, number> | null = null,
    fetch: Generator | null = null,
    resting = false,
    resultAt: number | null = null;
  const cellOf = (x: number) => mod(Math.floor(x / 2), world.cols);
  /** Whether `n` cells from `a` and `m` from `b` share one, around the moon. */
  const overlap = (a: number, n: number, b: number, m: number) =>
    mod(a - b, world.cols) < m || mod(b - a, world.cols) < n;
  function groundRows(ground = (i: number) => world.g[i]) {
    const R = 4 * world.K;
    return Int32Array.from({ length: world.cols }, (_, c) =>
      Math.round(Math.min(ground(2 * c), ground(2 * c + 1), ground(2 * c + 2)) / R - 0.77),
    );
  }

  const fuelFor = (round: number) => Math.max(450, 800 - 50 * (round - 1));
  function newLander(round: number): Lander {
    const { W, K } = world,
      side = random() < 0.5 ? -1 : 1;
    return {
      x: W * rand(0.25, 0.75),
      y: 26 * K,
      vx: side * Math.min(20, 7 + 2 * round + rand(0, 4)),
      vy: 2,
      a: 0,
      fuel: fuelFor(round),
      fuelMax: fuelFor(round),
      flame: 0,
      puff: 0,
      held: 0,
      ears: 0,
      scared: 0,
    };
  }
  function newWorld(round: number) {
    const { cols, rows } = options.size();
    world = makeWorld(cols, rows, round);
    cameraY = 0;
    cameraStill = Infinity;
    options.changed?.();
  }
  // What the last flight left behind.
  function sweep() {
    ((particles = []), (debris = []), (corgi = null), (pile = null), (wreck = null));
    ((bone = null), (heap = null), (filling = null), (fetch = null), (resting = false));
    resultAt = null;
  }
  function title() {
    newWorld(1);
    lander = newLander(1);
    lander.x = world.W / 2;
    Object.assign(game, { state: "title", since: 0, paused: false });
    sweep();
  }
  function launch(round: number) {
    if (round === 1) game.score = 0;
    newWorld(round);
    lander = newLander(round);
    if (options.autoland) {
      const pad = pick(world.pads);
      Object.assign(lander, { x: (pad.x0 + pad.x1) / 2, y: pad.y - 10 * world.K - 0.25, vx: 0, vy: -4, a: 0 });
    }
    Object.assign(game, { state: "flying", since: 0, round, paused: false, result: null });
    sweep();
  }
  // The card waits for the corgi to come down, and after a landing, for it
  // to eat its bone.
  const settled = () =>
    game.state === "landed"
      ? resting || game.since > 30
      : game.since > 5 || (game.since > 1.2 && corgi?.down != null && corgi.t - corgi.down > 1);
  // Space, Enter or a tap moves on once the moment has played out.
  function advance() {
    if (game.paused) return void (game.paused = false);
    if (game.state === "title") launch(1);
    else if (game.state === "landed" && settled()) launch(game.round + 1);
    else if (game.state === "crashed" && settled()) launch(1);
  }

  // A point on the ship, in its own frame, in the world.
  function onShip(L: Lander, lx: number, ly: number) {
    const c = Math.cos(L.a),
      s = Math.sin(L.a);
    return { x: L.x + lx * c - ly * s, y: L.y + lx * s + ly * c };
  }
  function feet(L: Lander) {
    const K = world.K;
    return [onShip(L, -SHIP.body - 0.1, 10 * K), onShip(L, SHIP.body + 0.1, 10 * K)];
  }
  function hull(L: Lander) {
    const K = world.K;
    const { body: b, cabin: w, top: t } = SHIP;
    return [
      [-b, 0],
      [b, 0],
      [-b, 4 * K],
      [b, 4 * K],
      [1.5 - w, -t],
      [w - 1.5, -t],
      [0, -t],
    ].map(([x, y]) => onShip(L, x, y));
  }

  function fly(dt: number) {
    const L = lander!,
      K = world.K,
      turn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
      burning = keys.up && L.fuel > 0;
    L.a = clamp(L.a + turn * TURN * dt, -MAX_TILT, MAX_TILT);
    L.flame += ((burning ? 1 : 0) - L.flame) * Math.min(1, dt * (burning ? 10 : 12));
    // Ears go up once the engine has run a moment and drop a beat after; a
    // fright lasts a little while.
    L.held = burning ? L.held + dt : 0;
    L.ears = L.held > 0.25 ? 0.35 : Math.max(0, L.ears - dt);
    const alt = world.ground(L.x) - L.y - 10 * world.K;
    L.scared = L.fuel <= 0 || (L.vy > SAFE.vy && alt < 50) ? 0.5 : Math.max(0, L.scared - dt);
    let ax = 0,
      ay = G;
    if (burning) {
      ax += Math.sin(L.a) * THRUST;
      ay -= Math.cos(L.a) * THRUST;
      L.fuel = Math.max(0, L.fuel - BURN * dt);
      for (let n = 0; n < 2; n++) {
        const spread = rand(-0.28, 0.28),
          speed = rand(30, 46),
          from = onShip(L, rand(-1.5, 1.5), 7 * K);
        particles.push({
          kind: "flame",
          x: from.x,
          y: from.y,
          vx: L.vx - Math.sin(L.a + spread) * speed,
          vy: L.vy + Math.cos(L.a + spread) * speed,
          age: 0,
          life: rand(0.3, 0.6),
        });
      }
    }
    if (turn && (L.puff -= dt) <= 0) {
      L.puff = 0.03;
      for (const side of [-1, 1]) {
        const from = onShip(L, side * 7, (side === turn ? -8 : 4) * K),
          out = side * 14;
        particles.push({
          kind: "puff",
          x: from.x,
          y: from.y,
          vx: L.vx + out * Math.cos(L.a),
          vy: L.vy + out * Math.sin(L.a),
          age: 0,
          life: 0.25,
        });
      }
    }
    L.vx += ax * dt;
    L.vy += ay * dt;
    L.x = mod(L.x + L.vx * dt, world.W);
    L.y += L.vy * dt;
    if (hull(L).some(p => p.y >= world.ground(p.x))) return crash("hit the rocks");
    const [l, r] = feet(L);
    if (l.y < world.ground(l.x) && r.y < world.ground(r.x)) return;
    const lo = Math.min(l.x, r.x),
      hi = Math.max(l.x, r.x),
      pad = world.pads.find(p => lo >= p.x0 - 0.5 && hi <= p.x1 + 0.5);
    if (!pad) return crash("missed the pad");
    const over = (
      [
        [L.vy / SAFE.vy, `too fast  ↓ ${L.vy.toFixed(1)}`],
        [Math.abs(L.vx) / SAFE.vx, `came in sideways  ${L.vx < 0 ? "←" : "→"} ${Math.abs(L.vx).toFixed(1)}`],
        [Math.abs(L.a) / SAFE.a, `too tilted  ${Math.round((Math.abs(L.a) * 180) / Math.PI)}°`],
      ] as [number, string][]
    ).sort((a, b) => b[0] - a[0])[0];
    if (over[0] > 1) return crash(over[1]);
    land(pad, L.vy <= SOFT.vy && Math.abs(L.vx) <= SOFT.vx && Math.abs(L.a) <= SOFT.a);
  }

  function dust(x: number, y: number, n: number, speed: number) {
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      particles.push({
        kind: "dust",
        x,
        y: y - 0.2,
        vx: side * rand(4, speed),
        vy: -rand(1, speed / 3),
        age: 0,
        life: rand(0.5, 1.1),
      });
    }
  }

  function land(pad: Pad, soft: boolean) {
    const L = lander!,
      points = (soft ? 100 : 40) * pad.mult,
      bonus = Math.round(L.fuel / 10);
    game.score += points + bonus;
    const best = game.score > game.best;
    if (best) {
      game.best = game.score;
      options.saveBest?.(game.best);
    }
    game.result = { soft, pad, points, bonus, best };
    for (const f of feet(L)) dust(f.x, pad.y, 10, 18);
    Object.assign(L, { vx: 0, vy: 0, flame: 0 });
    Object.assign(game, { state: "landed", since: 0 });
  }

  // The crash, on the cell grid: a flash of solid blocks, then a braille
  // fireball, shock ring and crater, the ship's pixel cells chipping, glowing
  // and cooling as they fly, and a small braille fire on the embers that smokes.
  // A piece's pixels drop to the bottom of its cell once it lands.
  function settleBits(bits: number) {
    let out = 0;
    for (const side of [0, 1]) {
      let n = 0;
      for (let r = 0; r < 4; r++) if (bits & (1 << (r * 2 + side))) n++;
      for (let r = 4 - n; r < 4; r++) out |= 1 << (r * 2 + side);
    }
    return out;
  }
  // A piece's pixels: chip some off, keeping one.
  function chip(bits: number, n: number) {
    for (; n > 0; n--) {
      const set = [0, 1, 2, 3, 4, 5, 6, 7].filter(i => bits & (1 << i));
      if (set.length > 1) bits &= ~(1 << pick(set));
    }
    return bits;
  }

  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];

  function crash(why: string) {
    const L = lander!,
      R = 4 * world.K;
    game.result = { why, best: game.score > 0 && game.score >= game.best };
    Object.assign(game, { state: "crashed", since: 0 });
    const depth = (p: { x: number; y: number }) => p.y - world.ground(p.x),
      hit = [...hull(L), ...feet(L)].reduce((a, b) => (depth(b) > depth(a) ? b : a));
    wreck = { x: hit.x, y: world.ground(hit.x), t0: game.t, flames: null, smoke: [] };
    crater(hit.x, 9, 5);
    pile = groundRows();
    for (const e of shipCells(L).cells.values()) {
      // A third of the hull burns up in the blast.
      if (random() < 0.35) continue;
      const x = e.col * 2 + 1,
        y = (e.row + 0.5) * R,
        g = octant(random() < 0.4 ? chip(e.bits, 1 + Math.floor(rand(0, 3))) : e.bits);
      debris.push({
        g,
        x,
        y,
        vx: L.vx * 0.15 + ((x - L.x) / 8) * rand(3, 10) + rand(-2, 2),
        vy: -rand(2, 12),
        col: 0,
        row: 0,
        rest: false,
        bounced: false,
        slid: 0,
        cool: rand(0, 0.4),
        trail: [],
        trailIn: 0,
      });
    }
    for (let i = 0; i < 22; i++) {
      const t = rand(Math.PI * 1.05, Math.PI * 1.95),
        speed = rand(12, 36);
      particles.push({
        kind: "spark",
        x: wreck!.x,
        y: wreck.y - 1,
        vx: Math.cos(t) * speed,
        vy: Math.sin(t) * speed,
        age: 0,
        life: rand(0.35, 0.8),
      });
    }
    dust(wreck!.x, wreck.y, 18, 30);
    const cab = onShip(L, 0, -R);
    corgi = {
      x: cab.x,
      y: cab.y,
      vx: rand(-5, 5),
      vy: -rand(16, 20),
      row: 0,
      air: true,
      t: 0,
      down: null,
      crashed: true,
      pose: null,
      facing: 1,
      wag: 0,
    };
    lander = null;
  }

  // A bowl with a lip, pressed into the ground; pads hold.
  function crater(x: number, rad: number, depth: number) {
    const { g, W, H, K, pads } = world;
    for (let i = Math.ceil(x - rad * 1.5); i <= x + rad * 1.5; i++) {
      const j = mod(i, W),
        u = Math.abs(i - x) / rad;
      if (pads.some(p => j >= p.x0 && j <= p.x1)) continue;
      g[j] = Math.min(
        H - 2 * K,
        g[j] + (u < 1 ? depth * (1 - u * u) : -depth * 0.4 * Math.sin(((u - 1) / 0.5) * Math.PI)),
      );
    }
    g[W] = g[0];
    options.changed?.();
  }

  function stepWreck(dt: number) {
    if (!wreck) return;
    const age = game.t - wreck.t0,
      R = 4 * world.K;
    if (!wreck.flames && age > 0.9) {
      const cols = [...new Set(debris.filter(d => d.rest && Math.abs(d.col - wreck!.x / 2) < 8).map(d => d.col))].sort(
        () => random() - 0.5,
      );
      if (cols.length || age > 2)
        wreck.flames = cols.slice(0, 3).map(col => ({ col, until: age + rand(2.5, 4.5), puff: rand(0, 0.3) }));
    }
    for (const f of wreck.flames ?? []) {
      if (age > f.until) continue;
      for (let n = (f.until - age < 0.6 ? 20 : 80) * dt; n > 0; n--)
        if (n >= 1 || random() < n)
          particles.push({
            kind: "fire",
            x: f.col * 2 + 1 + rand(-1.8, 1.8),
            y: (pile![f.col] + 0.9) * R,
            vx: rand(-3, 3),
            vy: -rand(6, 16),
            age: 0,
            life: rand(0.25, 0.6),
          });
      if ((f.puff -= dt) > 0) continue;
      f.puff = rand(0.25, 0.45);
      wreck.smoke.push({
        x: f.col * 2 + 1,
        y: (pile![f.col] - 0.3) * R,
        age: 0,
        drift: rand(-2, 2),
        seed: (random() * 1e9) | 0,
      });
    }
    for (const m of wreck.smoke) ((m.age += dt), (m.y -= 6 * dt), (m.x += m.drift * dt));
    wreck.smoke = wreck.smoke.filter(m => m.age < 2.2);
  }

  function settle(dt: number) {
    const L = lander!,
      K = world.K,
      pad = game.result!.pad!;
    L.a += -L.a * Math.min(1, dt * 12);
    L.y = pad.y - (10 * K * Math.cos(L.a) + (SHIP.body + 0.1) * Math.abs(Math.sin(L.a)));
    if (!corgi && game.since > 0.7) {
      pile = groundRows();
      // Out toward where it will dig, else the roomier side of the pad, but
      // never out over the edge of the screen.
      const room = SHIP.body + 1,
        middle = Math.floor(L.x / 2),
        plan = findSpot(middle, floorAt(middle, walking(1)), 1),
        toward = plan?.facing ?? (pad.x1 - (L.x + room) >= L.x - room - pad.x0 ? 1 : -1),
        right: 1 | -1 = L.x + toward * 26 > 8 && L.x + toward * 26 < world.W - 8 ? toward : toward > 0 ? -1 : 1,
        cab = onShip(L, 0, SHIP.face);
      corgi = {
        x: cab.x,
        y: cab.y,
        vx: right * 8,
        vy: -15,
        row: 0,
        air: true,
        t: 0,
        down: null,
        crashed: false,
        pose: null,
        facing: right,
        wag: 0,
      };
    }
  }

  // The corgi stands on the highest of the cells under it, tail included,
  // and once it is off the ship, on the highest under its legs or seat.
  function reach(length: number, facing: 1 | -1) {
    return facing > 0 ? [-3, length - 4] : [4 - length, 3];
  }
  function legs(length: number, facing: 1 | -1) {
    return length < 7 ? [-2, 2] : facing > 0 ? [-2, 1] : [-1, 2];
  }
  function floorAt(col: number, [from, to]: number[]) {
    let floor = Infinity;
    for (let o = from; o <= to; o++) floor = Math.min(floor, pile![mod(col + o, world.cols)]);
    return floor;
  }
  const corgiFloor = (d: Corgi, x = d.x) =>
    floorAt(cellOf(x), d.pose ? legs([...d.pose].length, d.facing) : reach(6, d.facing));
  const walking = (facing: 1 | -1) => legs(POSE.trot[0].length, facing);
  const seated = (facing: 1 | -1) => legs(POSE.sit.length, facing);
  // A pit changes the ground the corgi and bone stand on; its heap doesn't.
  const reground = () => {
    if (game.state === "landed") pile = groundRows(i => world.g[i] + (heap?.[mod(i, world.W)] ?? 0));
  };
  const onPad = (p: Pad, i: number) => mod(i, world.W) >= p.x0 && mod(i, world.W) <= p.x1;
  /** Whether a pad holds dot column `i`; the corgi may dig into `own`. */
  const holds = (i: number, own?: Pad) => world.pads.some(p => p !== own && onPad(p, i));
  function setGround(i: number, y: number) {
    const { g, W } = world;
    g[mod(i, W)] = y;
    g[W] = g[0];
  }
  const groundAt = (i: number) => world.g[mod(i, world.W)];
  /** The ground under any dirt the corgi has thrown onto it, which digging
   * and filling leave be. */
  const baseAt = (i: number) => groundAt(i) + (heap?.[mod(i, world.W)] ?? 0);

  /** How the corgi would dig a spot: wanting level ground about it or not,
   * and into its own pad or not. */
  type Way = { level: boolean; pad: boolean };
  const ways: Way[] = [
    { level: true, pad: false },
    { level: false, pad: false },
    { level: false, pad: true },
  ];
  const surfaceDot = (x: number) => Math.floor((groundAt(x) + groundAt(x + 1)) / 2 / world.K);
  function pitAt(col: number, row: number, facing: 1 | -1, way: Way): Spot | null {
    const nose = col + 3 * facing,
      // The bone's first cell, `gap` cells past the nose.
      past = (gap: number) => (facing > 0 ? nose + gap : nose - gap - 2);
    // Into a hill at its own level, the bone as close as it can dig to; on
    // lower ground, a pit a row into it a cell further on.
    for (const gap of [1, 2]) {
      if (floorAt(past(gap), [0, 2]) >= row) continue;
      // Only a bank two rows or more over it.
      const spot = hillAt(col, row, facing, past(gap), gap);
      return hillOver(spot) >= 2 ? finish(spot, way) : null;
    }
    if (floorAt(past(1), [0, 2]) < row) return null;
    const first = past(2),
      under = floorAt(first, [0, 2]) + 1;
    if (under <= row || under > row + 2) return null;
    return finish(pitFor(col, row, facing, first, under), way);
  }
  // The pit: a flat floor under the bone's three cells, with sloping sides.
  // It also levels the ground it will eat on, from where it sits to where
  // it sets the bone down: it digs away what stands over its row, and fills
  // the dips with the dirt it digs, over a pad too.
  function pitFor(col: number, row: number, facing: 1 | -1, first: number, under: number): Spot {
    const R = 4 * world.K,
      floor = (under + 1) * R,
      level = (row + 0.3) * R,
      trench = new Map<number, number>(),
      fill = new Map<number, number>(),
      [left, right] = facing > 0 ? [col - 7, col + 3] : [col - 3, col + 7];
    // A pad standing over its row it can't dig; dirt may fill over one.
    for (let i = 2 * left; i <= 2 * right + 2; i++)
      if (groundAt(i) < level) trench.set(i, level);
      else if (groundAt(i) > (row + 0.9) * R) fill.set(i, (row + 0.9) * R);
    for (let n = 0; n <= 14; n++) {
      const i = facing > 0 ? 2 * first - 4 + n : 2 * first + 10 - n,
        past = Math.max(0, 2 * first - i, i - 2 * first - 6);
      trench.set(i, Math.max(trench.get(i) ?? -Infinity, floor - world.K * past));
      fill.delete(i);
    }
    return { col, row, facing, first, bone: under, seat: col - 4 * facing, trench, hillside: [], fill };
  }
  // Into a hill, a notch from under its head to the bone's far end, its
  // floor level with its feet; as it undercuts the hill, the face above
  // slumps into it, a few cells of it, until it stands no steeper than dirt
  // can.
  function hillAt(col: number, row: number, facing: 1 | -1, first: number, gap: number): Spot {
    const floor = (row + 1) * 4 * world.K,
      trench = new Map<number, number>(),
      hillside: number[] = [],
      from = 2 * (col + 2 * facing) + 1,
      to = facing > 0 ? 2 * first + 6 : 2 * first;
    for (let i = from; facing > 0 ? i <= to : i >= to; i += facing) (trench.set(i, floor), hillside.push(i));
    for (let n = 1; n <= 6; n++) hillside.push(to + n * facing);
    // It fills the dips under where it digs and sits with the dirt it kicks
    // back, so none of it stands over air.
    const seat = gap === 1 ? col - facing : col,
      fill = new Map<number, number>(),
      left = Math.min(col - 3, seat - (facing > 0 ? 3 : 2)),
      right = Math.max(col + 3, seat + (facing > 0 ? 2 : 3)),
      level = (row + 0.9) * 4 * world.K;
    for (let i = 2 * left; i <= 2 * right + 2; i++) if (!trench.has(i) && baseAt(i) > level) fill.set(i, level);
    return { col, row, facing, first, bone: row, seat, trench, hillside, fill };
  }
  /** The steepest a hillside stands, in height between dot columns' edges. */
  const repose = () => 3 * world.K;
  /** Lets dirt along `side`, from the trench out, slide down where it stands
   * steeper than it can, a pass at a time; whether any slid. */
  function slide(heights: (i: number) => number, set: (i: number, y: number) => void, side: number[]) {
    let slid = false;
    for (let n = 1; n < side.length; n++) {
      const near = side[n - 1],
        far = side[n],
        over = heights(near) - heights(far) - repose();
      if (over <= 0.1 * world.K || holds(far) || holds(near)) continue;
      set(far, heights(far) + over / 2);
      set(near, heights(near) - over / 2);
      slid = true;
    }
    return slid;
  }
  /** How much dirt digging `spot` takes, the hillside that slides in included. */
  function dirtFor(spot: Spot) {
    const ground = new Map(spot.hillside.map(i => [i, groundAt(i)])),
      at = (i: number) => ground.get(i) ?? groundAt(i);
    let dirt = 0;
    for (let pass = 0; pass < 400; pass++) {
      for (const [i, floor] of spot.trench)
        if (at(i) < floor - 0.1 * world.K) ((dirt += floor - at(i)), ground.set(i, floor));
      if (!slide(at, (i, y) => ground.set(i, y), spot.hillside)) break;
    }
    return dirt;
  }
  /** `spot` if the corgi can dig it the way it would. */
  function finish(spot: Spot, way: Way): Spot | null {
    const { K, rows } = world,
      R = 4 * K,
      { first, facing } = spot;
    if (spot.bone > rows - 2) return null;
    // Sitting back from a hill, it sits level with the bone.
    if (!tugs(spot) && floorAt(spot.seat, seated(facing)) !== spot.row) return null;
    // It stands on level enough ground, its head and tail neither over a
    // drop nor in a bank, with room to sit and chew.
    if (way.level && !levelAt(spot, facing)) return null;
    // Into its own pad, the pit ends at the pad's end.
    const own = way.pad ? game.result!.pad! : undefined,
      far = facing > 0 ? 2 * first + 10 : 2 * first - 4;
    if (own && (tugs(spot) ? !onPad(own, far) || onPad(own, far + 2 * facing) : true)) return null;
    // Each of the bone's cells starts buried, and none sits over a hole.
    const floor = (spot.bone + 1) * R;
    for (let k = 0; k < 3; k++) {
      const x = 2 * (first + k);
      let deepest = -Infinity;
      for (const i of [x, x + 1, x + 2]) {
        const depth = (spot.trench.get(i) ?? floor) - groundAt(i);
        if (depth < -0.5 * R) return null;
        deepest = Math.max(deepest, depth);
      }
      if (deepest < 1.5 * K) return null;
    }
    for (const [i, height] of spot.trench) if (height - groundAt(i) > 0 && holds(i, own)) return null;
    const dirt = dirtFor(spot);
    // Enough dirt to fill the dips where it will eat.
    let dips = 0;
    for (const [i, height] of spot.fill) dips += groundAt(i) - height;
    return dirt >= 4 * R && dirt <= 40 * R && dips <= dirt ? spot : null;
  }
  // Out of a pit the corgi tugs the bone, backs up and sits; from a hill at
  // its own level it sits back where it is, or a step back.
  const tugs = (spot: Spot) => spot.bone > spot.row;
  /** The cells the corgi stands and sits in there, from the left. */
  const footprint = (spot: Spot, facing: 1 | -1): [number, number] => {
    if (tugs(spot)) return [spot.col - (facing > 0 ? 7 : 3), 11];
    const left = Math.min(spot.col - 3, spot.seat - (facing > 0 ? 3 : 2)),
      right = Math.max(spot.col + 3, spot.seat + (facing > 0 ? 2 : 3));
    return [left, right - left + 1];
  };
  function levelAt(spot: Spot, facing: 1 | -1) {
    const { col, row } = spot,
      [from, to] = reach(POSE.trot[0].length, facing);
    for (let o = from; o <= to; o++) {
      const ground = pile![mod(col + o, world.cols)];
      // Into a hill, its head is already at the hill, and digs it away.
      if (ground > row + 2 || (ground < row - 1 && (tugs(spot) || o * facing < 2))) return false;
    }
    if (!tugs(spot)) return true;
    let at = row;
    for (let step = 1; step <= 3; step++) {
      const floor = floorAt(col - step * facing, walking(facing));
      if (Math.abs(floor - at) > 1) return false;
      at = floor;
    }
    const seat = floorAt(col - 4 * facing, seated(facing)),
      set = floorAt(col + (facing > 0 ? 1 : -3), [0, 2]);
    return Math.abs(seat - at) <= 1 && set === seat;
  }
  /** What a spot costs beyond the trot there, in seconds of trotting: digging
   * turned back, on uneven ground, each cell it would stand in front of the
   * ship, crossing in front of it to get there, and digging into its own
   * pad, which always has room; digging into a bank, unless it's a big hill,
   * the bigger the better. */
  const penalty = { turn: 0.2, uneven: 1.5, front: 1.0, cross: 3, pad: 6, bank: 2, hill: -0.5 };
  /** How many rows of hill rise over a dig into one. */
  function hillOver(spot: Spot) {
    if (tugs(spot)) return 0;
    let top = Infinity;
    for (const i of spot.hillside.slice(0, 12)) top = Math.min(top, surfaceDot(i));
    return Math.max(0, (4 * spot.row + 4 - top) / 4);
  }
  /** How many of `n` cells from `from` are in front of the ship's hull. */
  function inFront(from: number, n: number) {
    const L = lander!,
      left = Math.floor((L.x - SHIP.body) / 2),
      width = Math.floor((L.x + SHIP.body) / 2) + 1 - left;
    let cells = 0;
    for (let col = from; col < from + n; col++) if (overlap(col, 1, left, width)) cells++;
    return cells;
  }
  // The cheapest spot to trot to and dig, scanning one way over the ground it
  // would cross: a step of a row or two it scrambles, higher it hops, and it
  // walks off drops, but never past the edge of the screen. There it digs
  // on ahead, or turns back.
  function scan(col: number, row: number, facing: 1 | -1) {
    let best: { spot: Spot; facing: 1 | -1; dig: 1 | -1; way: Way; cost: number } | null = null,
      cost = 0,
      crossed = false;
    for (let n = 0; n < world.cols / 2 && cost < 12; n++, col += facing) {
      if (col < 3 || col > world.cols - 4) break;
      const floor = floorAt(col, walking(facing));
      if (n && (floor < row - 4 || floor > row + 8)) break;
      const climb = Math.abs(floor - row);
      cost += !n ? 0 : climb <= CLIMB ? 0.09 + 0.04 * climb : floor < row ? 0.5 + 0.5 * climb : 0.9;
      row = floor;
      // Past the middle of the ship, it has trotted across in front of it.
      crossed ||= n > 0 && overlap(col - 3, 7, cellOf(lander!.x), 1);
      for (const dig of [facing, -facing as 1 | -1]) {
        const turned = floorAt(col, walking(dig));
        if (Math.abs(turned - row) > CLIMB) continue;
        for (const way of ways) {
          const spot = pitAt(col, turned, dig, way);
          if (!spot) continue;
          const [from, cells] = footprint(spot, dig);
          if (Math.min(from, spot.first - 2) < 0 || Math.max(from + cells, spot.first + 6) > world.cols) break;
          const total =
            cost +
            (dig === facing ? 0 : penalty.turn) +
            (way.level ? 0 : penalty.uneven) +
            (way.pad ? penalty.pad : 0) +
            (crossed ? penalty.cross : 0) +
            (tugs(spot) ? 0 : penalty.bank + penalty.hill * Math.min(5, Math.max(0, hillOver(spot) - 3))) +
            penalty.front * inFront(from, cells);
          if (!best || total < best.cost)
            best = { spot: { ...spot, col: mod(col, world.cols) }, facing, dig, way, cost: total };
          break;
        }
      }
    }
    return best;
  }
  function findSpot(col: number, row: number, toward: 1 | -1) {
    const found = [toward, -toward as 1 | -1].map(facing => scan(col, row, facing)).filter(f => f !== null);
    return found.length ? found.reduce((a, b) => (b.cost < a.cost ? b : a)) : null;
  }
  // A pit it digs from the topmost dirt down, nearest the nose on a tie; a
  // hill it digs at the face, and the hillside slides in after.
  function carve(spot: Spot) {
    let best: number | null = null;
    for (const [i, height] of spot.trench) {
      if (height - baseAt(i) <= 0.1 * world.K) continue;
      if (spot.hillside.length) {
        best = i;
        break;
      }
      if (best === null || baseAt(i) < baseAt(best) - 1e-6) best = i;
    }
    if (best === null) return 0;
    const dirt = Math.min(world.K, spot.trench.get(best)! - baseAt(best));
    setGround(best, groundAt(best) + dirt);
    for (let pass = 0; pass < 4 && slide(groundAt, setGround, spot.hillside); pass++);
    return dirt;
  }
  // A clod thrown into a dip fills it, as ground the corgi stands on; the
  // rest of it lands like any other.
  function fillDip(x: number, i: number, dirt: number) {
    const height = filling?.get(i) ?? baseAt(i),
      put = Math.min(dirt, Math.max(0, baseAt(i) - height));
    setGround(i, groundAt(i) - put);
    if (dirt - put > 1e-6) deposit(x, dirt - put);
    else reground();
  }
  // A clod lands and rolls downhill until the slope holds it, on a pad too.
  function deposit(x: number, dirt: number) {
    const K = world.K;
    let i = Math.round(x);
    for (let n = 0; n < 12; n++) {
      const l = groundAt(i - 1),
        r = groundAt(i + 1),
        low = l > r ? i - 1 : r > l ? i + 1 : random() < 0.5 ? i - 1 : i + 1;
      if (low < 0 || low >= world.W || groundAt(low) - (groundAt(i) - dirt) <= 1.2 * K) break;
      i = low;
    }
    setGround(i, groundAt(i) - dirt);
    (heap ??= new Float64Array(world.W))[mod(i, world.W)] += dirt;
    reground();
  }

  // A cell along: up or down a row or two it scrambles, and further it falls.
  function step(d: Corgi, col: number, span: number[]) {
    const floor = floorAt(col, span);
    d.x = mod(col, world.cols) * 2 + 1;
    if (Math.abs(floor - d.row) <= CLIMB) Object.assign(d, { row: floor, y: (floor + 0.5) * 4 * world.K });
  }
  function* hold(d: Corgi, seconds: number, pose: string, wag = 0) {
    Object.assign(d, { pose, wag });
    for (let n = Math.round(seconds / STEP); n > 0; n--) yield;
  }
  // After a landing the corgi catches a scent, trots off the pad to a spot
  // it can dig, digs a pit throwing the dirt behind it, tugs the bone out,
  // and chews it two cells back, as the sidebar's corgi does.
  function* fetchBone(d: Corgi, toward: 1 | -1) {
    const R = 4 * world.K,
      start = cellOf(d.x);
    const found = findSpot(start, d.row, toward);
    let travel = found?.facing ?? toward,
      spot = found?.spot ?? null,
      facing = found?.dig ?? travel,
      way = found?.way ?? ways[0];
    d.facing = travel;
    yield* hold(d, 0.5, POSE.blink, 1);
    yield* hold(d, 0.1, POSE.sit, 1);
    if (!spot) return yield* rest(d);
    for (const [seconds, pose] of [
      [0.12, POSE.sniff[0]],
      [0.08, POSE.sniff[1]],
      [0.12, POSE.sniff[0]],
      [0.12, POSE.sniff[1]],
    ] as const)
      yield* hold(d, seconds, pose);
    yield* hold(d, 0.25, POSE.perk, 2);
    // Trot there, a cell a stride, on whatever ground is underfoot.
    for (let stride = 0; cellOf(d.x) !== spot.col; stride++) {
      const col = cellOf(d.x),
        next = col + travel,
        floor = floorAt(next, walking(travel)),
        climb = Math.abs(floor - d.row);
      // A step or two up or down takes a little longer.
      yield* hold(d, 0.09 + (climb <= CLIMB ? 0.04 * climb : 0), POSE.trot[stride % 4], 1);
      if (climb <= CLIMB) {
        step(d, next, walking(travel));
        continue;
      }
      // It hops onto a cliff, over it at the top of the hop, and steps off a
      // drop to fall onto the ground below.
      const rise = Math.sqrt(2 * HOP_G * (d.row - floor + 0.6) * R);
      if (floor < d.row) Object.assign(d, { vx: (travel * 2 * HOP_G) / rise, vy: -rise });
      else Object.assign(d, { x: mod(next, world.cols) * 2 + 1, vx: travel, vy: 0 });
      Object.assign(d, { air: true, pose: POSE.trot[1] });
      while (d.air) yield;
      // A hop that carries it past the spot looks again from where it lands.
      if (mod((spot.col - cellOf(d.x)) * travel, world.cols) > world.cols / 2) {
        const again = findSpot(cellOf(d.x), d.row, travel);
        if (!again) return yield* rest(d);
        ({ spot, dig: facing, way, facing: travel } = again);
        d.facing = travel;
      }
    }
    // Turned to dig, with the ground under its legs.
    d.facing = facing;
    yield* hold(d, 0.1, POSE.still);
    if (d.row !== spot.row) spot = pitAt(spot.col, d.row, facing, way) ?? spot;
    const dug: Bone = { col: spot.first, row: spot.bone, shown: [null, null, null], eaten: 0, held: false, facing },
      plan = spot;
    bone = dug;
    filling = plan.fill;
    const tail = 2 * cellOf(d.x) - 6 * facing + (facing > 0 ? -0.5 : 2.5),
      cleared = (i: number) => (plan.trench.get(i) ?? -Infinity) - baseAt(i) < 0.3,
      dugOut = (k: number) => [0, 1, 2].every(o => cleared(2 * (plan.first + k) + o));
    for (let stroke = 0; ; stroke++) {
      yield* hold(d, 0.08, POSE.dig[stroke % 2]);
      let dirt = 0;
      for (let clods = 0; clods < 3; clods++) {
        const clod = carve(spot);
        if (!clod) break;
        dirt += clod;
        // The deepest dip still to fill where it will eat, counting the
        // dirt on its way there, else behind it.
        const thrown = new Map<number, number>();
        for (const p of particles) if (p.aim !== undefined) thrown.set(p.aim, (thrown.get(p.aim) ?? 0) + (p.dirt ?? 0));
        let aim: number | undefined;
        for (const [i, height] of plan.fill) {
          const short = baseAt(i) - height - (thrown.get(i) ?? 0);
          if (
            short > 0.1 * world.K &&
            (aim === undefined || short > baseAt(aim) - plan.fill.get(aim)! - (thrown.get(aim) ?? 0))
          )
            aim = i;
        }
        const vy = -rand(8, 12),
          from = aim === undefined || (aim - tail) * facing < 0 ? tail : 2 * cellOf(d.x) + 3 * facing + 1;
        particles.push({
          kind: "clod",
          x: from,
          y: Math.min((d.row + 0.7) * R, world.ground(from) - 0.5),
          vx: aim === undefined ? -facing * rand(6, 18) : ((aim - from) * HOP_G) / -vy,
          vy: aim === undefined ? -rand(6, 13) : vy,
          age: 0,
          life: 3,
          dirt: clod,
          aim,
        });
      }
      // Dirt sliding back over the bone hides it again.
      dug.shown = dug.shown.map((at, k) => (dugOut(k) ? (at ?? game.t) : null));
      if (!dirt) break;
      reground();
    }
    yield* hold(d, 0.3, POSE.still);
    if (tugs(spot)) {
      // Tug it out of the pit, backing up three cells, and set it down.
      dug.held = true;
      const carry = () => Object.assign(dug, { col: cellOf(d.x) + (facing > 0 ? 4 : -6), row: d.row });
      carry();
      yield* hold(d, 0.2, POSE.still);
      for (let n = 0; n < 3; n++) {
        const back = cellOf(d.x) - facing;
        if (Math.abs(floorAt(back, walking(facing)) - d.row) > CLIMB) break;
        step(d, back, walking(facing));
        carry();
        yield* hold(d, 0.12, POSE.dig[n % 2]);
      }
      dug.held = false;
      dug.row = floorAt(dug.col, [0, 2]);
    }
    yield* hold(d, 0.1, POSE.sit);
    const seat = tugs(spot) ? cellOf(d.x) - facing : spot.seat;
    if (seat !== cellOf(d.x) && Math.abs(floorAt(seat, seated(facing)) - d.row) <= CLIMB) step(d, seat, seated(facing));
    // Two cells back from it, facing you.
    yield* hold(d, 0.24, POSE.perk, 2);
    for (const [seconds, pose] of [
      [0.12, POSE.sniff[0]],
      [0.08, POSE.sniff[1]],
      [0.12, POSE.sniff[0]],
      [0.12, POSE.sniff[1]],
    ] as const)
      yield* hold(d, seconds, pose);
    yield* hold(d, 0.16, POSE.blink, 2);
    for (let bite = 0; bite < 24; bite++) {
      const eaten = Math.min(3, Math.floor((bite + 2) / 6));
      if (eaten > dug.eaten) {
        const cell = facing > 0 ? dug.col + eaten - 1 : dug.col + 3 - eaten;
        dust(cell * 2 + 1, (dug.row + 1) * R, 3, 5);
      }
      dug.eaten = eaten;
      yield* hold(d, 0.04, bite % 6 < 3 ? POSE.chew : POSE.blink, 1);
    }
    bone = null;
    yield* hold(d, 0.12, POSE.blink, 1);
    yield* rest(d);
  }
  function* rest(d: Corgi): Generator {
    resting = true;
    for (;;) yield* hold(d, STEP, d.t % 3.1 < 0.13 ? POSE.blink : POSE.sit, 1);
  }

  function stepCorgi(dt: number) {
    if (!corgi) return;
    const d = corgi,
      R = 4 * world.K;
    d.t += dt;
    if (!d.air) {
      fetch?.next();
      const floor = corgiFloor(d);
      // Ground a row or two higher or lower under its legs, as it turns or
      // sits, it stands up onto or steps down to; further down, it falls.
      if (!d.crashed && (floor < d.row || floor - d.row <= CLIMB))
        Object.assign(d, { row: floor, y: (floor + 0.5) * R });
      if (d.air || floor <= d.row) return;
      d.air = true;
    }
    d.vy += HOP_G * dt;
    d.x = mod(d.x + d.vx * dt, world.W);
    d.y += d.vy * dt;
    const floor = corgiFloor(d);
    if (d.vy < 0 || Math.floor(d.y / R) < floor) return;
    Object.assign(d, { air: false, row: floor, x: cellOf(d.x) * 2 + 1, y: (floor + 0.5) * R, vx: 0, vy: 0 });
    if (d.down == null) {
      d.down = d.t;
      if (!d.crashed) (fetch = fetchBone(d, d.facing)).next();
    }
    dust(d.x, (floor + 1) * R, 6, 8);
  }

  const fall: Partial<Record<Particle["kind"], number>> = {
    dust: G * 0.6,
    spark: G * 0.8,
    fire: -G * 0.3,
    clod: HOP_G * 2,
  };
  function stepParticles(dt: number) {
    for (const p of particles) {
      p.age += dt;
      p.vy += (fall[p.kind] ?? G * 0.15) * dt;
      // Clods stop at the edge of the screen; the rest wraps around.
      p.x = p.kind === "clod" ? clamp(p.x + p.vx * dt, 0, world.W - 1) : mod(p.x + p.vx * dt, world.W);
      p.y += p.vy * dt;
      const floor = world.ground(p.x);
      if (p.y < floor) continue;
      p.y = floor - 0.2;
      if (p.kind === "clod")
        ((p.age = p.life), p.aim === undefined ? deposit(p.x, p.dirt ?? 0) : fillDip(p.x, p.aim, p.dirt ?? 0));
      else if (p.kind === "spark") p.age = p.life;
      else if (p.kind === "flame")
        Object.assign(p, {
          kind: "dust",
          vx: Math.sign(p.vx || rand(-1, 1)) * rand(8, 26),
          vy: -rand(0, 6),
          age: 0,
          life: rand(0.3, 0.7),
        });
      else ((p.vx *= 0.5), (p.vy = 0));
    }
    particles = particles.filter(p => p.age < p.life);
  }

  function stepDebris(dt: number) {
    if (!pile) return;
    const R = 4 * world.K;
    for (const d of debris) {
      if (d.rest) continue;
      d.vy += HOP_G * dt;
      d.x = mod(d.x + d.vx * dt, world.W);
      d.y += d.vy * dt;
      if ((d.trailIn -= dt) <= 0)
        ((d.trailIn = 0.04), d.trail.unshift({ x: d.x, y: d.y }), (d.trail.length = Math.min(d.trail.length, 4)));
      const col = cellOf(d.x);
      if (Math.floor(d.y / R) < pile![col]) continue;
      // A fast piece bounces once, and may snap in two.
      if (!d.bounced && d.vy > 9) {
        Object.assign(d, { bounced: true, y: (pile![col] - 0.5) * R, vx: d.vx * 0.6, vy: -d.vy * 0.3 });
        const bits = bitsOf(d.g),
          left = bits & 0x55,
          right = bits & 0xaa;
        if (left && right && random() < 0.6) {
          debris.push({ ...d, g: octant(right), vx: Math.abs(d.vx) + rand(1, 4), trail: [] });
          Object.assign(d, { g: octant(left), vx: -Math.abs(d.vx) - rand(1, 4) });
        } else d.g = octant(chip(bits, 1));
        continue;
      }
      const row = pile![col]--;
      Object.assign(d, {
        rest: true,
        col,
        row,
        x: col * 2 + 1,
        y: (row + 0.5) * R,
        trail: [],
        g: octant(settleBits(bitsOf(d.g))),
      });
    }
    // A piece on top of its column slides to a lower neighbor, twice at most,
    // and settled pieces crumble for a while.
    if ((toppleIn -= dt) > 0) return;
    toppleIn = 0.07;
    for (const d of debris) {
      if (!d.rest || d.slid >= 2 || d.row !== pile![d.col] + 1) continue;
      const side = random() < 0.5 ? -1 : 1;
      for (const n of [d.col + side, d.col - side].map(c => mod(c, world.cols))) {
        if (pile![n] < d.row + 1) continue;
        pile![d.col]++;
        Object.assign(d, { rest: false, slid: d.slid + 1, x: n * 2 + 1, y: (d.row + 1.5) * R, vx: 0, vy: 0 });
        break;
      }
    }
    const d = debris.length && game.since < 5 && random() < 0.25 ? pick(debris) : null;
    if (d?.rest) d.g = octant(settleBits(chip(bitsOf(d.g), 1)));
  }

  function update(dt: number) {
    game.t += dt;
    game.since += dt;
    if (game.state === "flying") fly(dt);
    else if (game.state === "landed") settle(dt);
    else if (game.state === "title") lander!.y = 26 * world.K + Math.sin(game.t * 1.6) * 0.9;
    stepParticles(dt);
    stepDebris(dt);
    stepWreck(dt);
    stepCorgi(dt);
    if (game.result && settled()) resultAt ??= game.t;
    if (game.state !== "title") {
      // The camera follows the ship up once its top nears the top of the
      // screen, and back down once it has dropped four rows below that.
      const R = 4 * world.K,
        points = lander ? [...hull(lander), ...feet(lander)] : [],
        top = Math.min(...points.map(p => p.y), corgi ? corgi.y - R : Infinity),
        margin = 3.75 * R;
      const was = cameraY;
      cameraY = Math.min(0, Math.max(top - margin - 4 * R, Math.min(cameraY, top - margin)));
      cameraStill = cameraY === was ? cameraStill + dt : 0;
    }
  }

  function face() {
    const L = lander!,
      blink = game.t % 3.7 < 0.13;
    if (game.state === "landed") return game.since < 0.7 ? FACE.blink : null;
    if (game.state !== "flying") return blink ? FACE.blink : FACE.calm;
    if (L.scared > 0) return FACE.scared;
    if (L.ears > 0) return FACE.burn;
    return blink ? FACE.blink : FACE.calm;
  }

  // The ship turns the way a terminal can turn it: its outline is strokes in
  // its own frame, drawn back onto the grid as octant pixels, two across and
  // four down per cell. Each turn is drawn once, around an origin on a dot
  // corner, and the ship carries it a whole dot at a time, so its dots never
  // shift against each other in flight.

  // The ship in its own frame, in units with y down: straight edges with their
  // corners cut, legs, and a skirt under the nozzle.
  function shipShape(): Point[][] {
    const K = world.K,
      B = 4 * K,
      { cabin: cw, top, body: bw, corner: c } = SHIP;
    // The feet stand on the row above the ground, not in it.
    const foot = 10 * K - 0.05;
    const outline: Point[][] = [
      [
        [-cw, 0],
        [-cw, c - top],
        [c - cw, -top],
        [cw - c, -top],
        [cw, c - top],
        [cw, 0],
      ],
      [
        [c - bw, 0],
        [bw - c, 0],
        [bw, c],
        [bw, B - c],
        [bw - c, B],
        [c - bw, B],
        [-bw, B - c],
        [-bw, c],
        [c - bw, 0],
      ],
      [
        [-1.5, B + K],
        [1.5, B + K],
      ],
    ];
    for (const s of [-1, 1])
      outline.push(
        [
          [(bw - 3) * s, B],
          [(bw + 0.1) * s, foot],
        ],
        [
          [(bw - 1.1) * s, foot],
          [(bw + 1.3) * s, foot],
        ],
      );
    return outline;
  }
  // The ship's dots from its origin, turned to the nearest degree, each stroke
  // a Bresenham line between the dots its ends fall in.
  const sprites = new Map<string, Point[]>();
  function shipDots(a: number): Point[] {
    const turn = Math.round((a * 180) / Math.PI),
      key = world.K + "/" + turn;
    const cached = sprites.get(key);
    if (cached) return cached;
    const t = (turn * Math.PI) / 180,
      cos = Math.cos(t),
      sin = Math.sin(t),
      lit = new Set<string>();
    const at = ([x, y]: Point): Point => [
      Math.floor(x * cos - y * sin + 1e-9),
      Math.floor((x * sin + y * cos) / world.K + 1e-9),
    ];
    for (const line of shipShape())
      for (let i = 1; i < line.length; i++) {
        // Top down, so a tilt either way draws the same stroke mirrored.
        const ends = [at(line[i - 1]), at(line[i])].sort((p, q) => p[1] - q[1]);
        let [x, y] = ends[0];
        const [ex, ey] = ends[1],
          dx = Math.abs(ex - x),
          dy = -Math.abs(ey - y),
          sx = x < ex ? 1 : -1,
          sy = y < ey ? 1 : -1;
        for (let err = dx + dy; ;) {
          lit.add(x + "," + y);
          if (x === ex && y === ey) break;
          const e2 = 2 * err;
          if (e2 >= dy) ((err += dy), (x += sx));
          if (e2 <= dx) ((err += dx), (y += sy));
        }
      }
    const dots = [...lit].map(key => key.split(",").map(Number) as Point);
    sprites.set(key, dots);
    return dots;
  }
  // The ship's origin on whole dots, `camera` units down the world.
  function shipAt(L: Lander, camera = 0): Point {
    return [Math.round(L.x), Math.round((L.y - camera) / world.K)];
  }
  // Where the ship's pixels fall: what breaks off in a crash.
  function shipCells(L: Lander) {
    const [ox, oy] = shipAt(L),
      cells = new Map<string, PixelCell>();
    for (const [x, y] of shipDots(L.a)) {
      const px = ox + x,
        py = oy + y,
        col = Math.floor(px / 2),
        row = Math.floor(py / 4),
        key = col + "," + row;
      if (!cells.has(key)) cells.set(key, { col, row, bits: 0 });
      cells.get(key)!.bits |= 1 << ((py - row * 4) * 2 + (px - col * 2));
    }
    return { cells };
  }

  let accumulator = 0;
  function tick(seconds: number) {
    if (game.paused) return;
    for (accumulator += clamp(seconds, 0, 0.1); accumulator >= STEP; accumulator -= STEP) update(STEP);
  }
  function tilt(side: -1 | 1) {
    if (lander && game.state === "flying" && !game.paused)
      lander.a = clamp(lander.a + side * 0.12, -MAX_TILT, MAX_TILT);
  }
  function press(input: Input) {
    switch (input) {
      case "left":
        tilt(-1);
        break;
      case "right":
        tilt(1);
        break;
      case "cut":
        keys.up = false;
        break;
      case "pause":
        if (game.state === "flying") game.paused = !game.paused;
        break;
      case "restart":
        keys.up = false;
        title();
        break;
      case "advance":
        keys.up = false;
        advance();
        break;
      case "thrust":
        if (game.paused || game.state !== "flying") {
          keys.up = false;
          advance();
        } else keys.up = !keys.up;
        break;
    }
  }
  return {
    get world() {
      return world;
    },
    get cameraY() {
      return cameraY;
    },
    get cameraStill() {
      return cameraStill;
    },
    get resultAge() {
      return resultAt === null ? 0 : game.t - resultAt;
    },
    game,
    keys,
    get lander() {
      return lander;
    },
    get particles() {
      return particles;
    },
    get debris() {
      return debris;
    },
    get corgi() {
      return corgi;
    },
    get wreck() {
      return wreck;
    },
    get pile() {
      return pile;
    },
    get bone() {
      return bone;
    },
    get heap() {
      return heap;
    },
    title,
    launch,
    advance,
    settled,
    tick,
    face,
    shipAt,
    shipDots,
    shipCells,
    cellOf,
    tilt,
    press,
  };
}
export type Engine = ReturnType<typeof create>;
