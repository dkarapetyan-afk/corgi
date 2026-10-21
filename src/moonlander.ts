//! Moonlander simulation and ship geometry, shared by the site and viewer.
export const G = 9,
  THRUST = 21,
  TURN = 2.4,
  BURN = 60,
  MAX_TILT = Math.PI / 2,
  HOP_G = 20,
  STEP = 1 / 120;
export const SOFT = { vy: 5, vx: 2.5, a: 0.12 },
  SAFE = { vy: 9, vx: 5, a: 0.24 };
export const FACE = { calm: "ᐯ•ᴥ•ᐯ", blink: "ᐯ◡ᴥ◡ᐯ", burn: "ᐱ•ᴥ•ᐱ", scared: "ᐯ°ᴥ°ᐯ", dizzy: "ᐯ@ᴥ@ᐯ" };
export const TAIL = ["~", "-", "~", "^"];
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
  kind: "flame" | "puff" | "dust" | "spark" | "fire";
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
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
    for (let span = size, rough = H * 0.3; span > 1; span >>= 1, rough *= 0.54)
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
      for (let d = 1; d <= 10; d++) {
        const keep = (d / 10) ** 2 * (3 - (2 * d) / 10);
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
    wreck: Wreck | null = null;
  const cellOf = (x: number) => mod(Math.floor(x / 2), world.cols);
  function groundRows() {
    const { ground } = world,
      R = 4 * world.K;
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
  function title() {
    newWorld(1);
    lander = newLander(1);
    lander.x = world.W / 2;
    Object.assign(game, { state: "title", since: 0, paused: false });
    ((particles = []), (debris = []), (corgi = null), (pile = null), (wreck = null));
  }
  function launch(round: number) {
    if (round === 1) game.score = 0;
    newWorld(round);
    lander = newLander(round);
    Object.assign(game, { state: "flying", since: 0, round, paused: false, result: null });
    ((particles = []), (debris = []), (corgi = null), (pile = null), (wreck = null));
  }
  // The card waits for the corgi to come down.
  const settled = () =>
    game.since > 5 ||
    (game.since > 1.2 && corgi?.down != null && corgi.t - corgi.down > (game.state === "crashed" ? 1 : 0.3));
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
      const room = SHIP.body + 1,
        right = pad.x1 - (L.x + room) >= L.x - room - pad.x0 ? 1 : -1,
        cab = onShip(L, 0, SHIP.face);
      pile = groundRows();
      corgi = { x: cab.x, y: cab.y, vx: right * 8, vy: -15, row: 0, air: true, t: 0, down: null, crashed: false };
    }
  }

  // The corgi stands on the highest of the cells under it, tail included.
  const corgiFloor = (x: number) => Math.min(...[-3, -2, -1, 0, 1, 2].map(o => pile![mod(cellOf(x) + o, world.cols)]));
  function stepCorgi(dt: number) {
    if (!corgi) return;
    const d = corgi,
      R = 4 * world.K;
    d.t += dt;
    if (!d.air) {
      if (corgiFloor(d.x) <= d.row) return;
      d.air = true;
    }
    d.vy += HOP_G * dt;
    d.x = mod(d.x + d.vx * dt, world.W);
    d.y += d.vy * dt;
    const floor = corgiFloor(d.x);
    if (d.vy < 0 || Math.floor(d.y / R) < floor) return;
    Object.assign(d, { air: false, row: floor, x: cellOf(d.x) * 2 + 1, y: (floor + 0.5) * R, vx: 0, vy: 0 });
    if (d.down == null) d.down = d.t;
    dust(d.x, (floor + 1) * R, 6, 8);
  }

  function stepParticles(dt: number) {
    for (const p of particles) {
      p.age += dt;
      p.vy +=
        (({ dust: G * 0.6, spark: G * 0.8, fire: -G * 0.3 } as Partial<Record<Particle["kind"], number>>)[p.kind] ??
          G * 0.15) * dt;
      p.x = mod(p.x + p.vx * dt, world.W);
      p.y += p.vy * dt;
      const floor = world.ground(p.x);
      if (p.y < floor) continue;
      p.y = floor - 0.2;
      if (p.kind === "spark") p.age = p.life;
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
