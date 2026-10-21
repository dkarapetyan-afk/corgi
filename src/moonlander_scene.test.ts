import { expect, test } from "bun:test";
import * as moonlander from "./moonlander";
import * as hull from "./moonlander_hull";
import * as scene from "./moonlander_scene";

function create() {
  const engine = moonlander.create({ size: () => ({ cols: 72, rows: 40 }), aspect: 2.2, random: () => 0.5 });
  engine.launch(1);
  return engine;
}

function hud(engine: moonlander.Engine) {
  const screen = scene.render(engine);
  return screen.cells.slice(screen.cols * 2, screen.cols * 3);
}

const flameDots = (engine: moonlander.Engine) =>
  hud(engine).reduce((n, cell) => n + cell.dots.toString(2).replaceAll("0", "").length, 0);

test("the camera pans foreground graphics while the HUD and controls stay fixed", () => {
  const engine = create(),
    R = 4 * engine.world.K,
    L = engine.lander!;
  engine.world.stars = [{ dx: 4, dy: 48, color: "faint" }];
  engine.world.twinkles = [];
  engine.particles.push({ kind: "puff", x: 10, y: 10 * R, vx: 0, vy: 0, age: 0, life: 1 });
  const before = scene.render(engine);
  Object.assign(L, { y: moonlander.SHIP.top + (3.75 - 8) * R, vx: 0, vy: -moonlander.G * moonlander.STEP });
  engine.tick(moonlander.STEP);
  expect(engine.cameraY).toBeCloseTo(-8 * R);
  const after = scene.render(engine),
    row = (screen: scene.Screen, y: number) => screen.cells.slice(y * screen.cols, (y + 1) * screen.cols),
    text = (y: number) =>
      row(after, y)
        .map(cell => cell.glyph)
        .join("");
  expect(after.cells[12 * after.cols + 2].dots).not.toBe(0);
  expect(after.cells[18 * after.cols + 5]).toEqual(before.cells[10 * before.cols + 5]);
  expect(row(after, 0)).toEqual(row(before, 0));
  const footer = "← → tilt   ↑/space thrust   ↓ cut   p pause   r restart   q quit",
    left = Math.floor((after.cols - footer.length) / 2);
  expect(row(after, after.rows - 1).slice(left, left + footer.length)).toEqual(
    row(before, before.rows - 1).slice(left, left + footer.length),
  );
  expect(text(2)).toContain("fuel");
  expect(text(Math.floor((L.y + moonlander.SHIP.face - engine.cameraY) / R))).toContain(engine.face()!);
  const camera = engine.cameraY;
  scene.render(engine);
  expect(engine.cameraY).toBe(camera);
});

test("the stars, twinkles and crescent pan together and wrap at high altitudes", () => {
  const engine = create(),
    { world: w } = engine,
    R = 4 * w.K;
  w.stars = [
    { dx: 4, dy: 48, color: "faint" },
    { dx: 6, dy: (w.rows - 2) * 4 + 1, color: "line" },
  ];
  w.twinkles = [{ col: 10, row: 8, phase: Math.PI / 2, speed: 1 }];
  w.earth = { x: 100, y: 60, r: 8 };
  const before = scene.render(engine),
    crescent = (screen: scene.Screen, shift: number) =>
      Array.from({ length: 8 * 9 }, (_, i) => screen.cells[(10 + Math.floor(i / 9) + shift) * w.cols + 46 + (i % 9)]);
  expect(before.cells[12 * w.cols + 2].dots).not.toBe(0);
  expect(before.cells[8 * w.cols + 10].glyph).toBe("+");
  expect(crescent(before, 0).some(cell => cell.dots !== 0)).toBe(true);
  // 25 rows of foreground motion move the sky three rows; another 1,000 wraps it three times.
  for (const rows of [25, 1025]) {
    Object.assign(engine.lander!, {
      y: moonlander.SHIP.top + (3.75 - rows) * R,
      vx: 0,
      vy: -moonlander.G * moonlander.STEP,
    });
    engine.tick(moonlander.STEP);
    expect(engine.cameraY).toBeCloseTo(-rows * R);
    const after = scene.render(engine);
    expect(after.cells[15 * w.cols + 2]).toEqual(before.cells[12 * w.cols + 2]);
    expect(after.cells[11 * w.cols + 10].glyph).toBe("+");
    expect(after.cells[w.cols + 3].dots).toBe(2);
    expect(crescent(after, 3)).toEqual(crescent(before, 0));
    expect(scene.render(engine).cells).toEqual(after.cells);
  }
});

test("the fuel flame reverses smoothly through rapid thrust toggles in the flight simulation", () => {
  const engine = create(),
    lander = engine.lander!;
  const run = (steps: number, burning: boolean) => {
    const before = lander.flame;
    engine.press("thrust");
    expect(engine.keys.up).toBe(burning);
    expect(lander.flame).toBe(before);
    for (let i = 0; i < steps; i++) {
      const previous = lander.flame;
      engine.tick(moonlander.STEP);
      expect(engine.game.state).toBe("flying");
      expect(lander.flame).toBeGreaterThanOrEqual(0);
      expect(lander.flame).toBeLessThanOrEqual(1);
      expect(Math.abs(lander.flame - previous)).toBeLessThan(0.11);
      if (burning) expect(lander.flame).toBeGreaterThan(previous);
      else expect(lander.flame).toBeLessThan(previous);
    }
  };
  expect(flameDots(engine)).toBe(0);
  run(8, true);
  const rising = lander.flame;
  expect(rising).toBeGreaterThan(0.4);
  expect(rising).toBeLessThan(0.7);
  expect(flameDots(engine)).toBeGreaterThan(0);
  run(4, false);
  expect(lander.flame).toBeLessThan(rising);
  expect(flameDots(engine)).toBeGreaterThan(0);
  run(4, true);
  run(4, false);
  run(32, true);
  expect(lander.flame).toBeGreaterThan(0.95);
  expect(flameDots(engine)).toBeGreaterThanOrEqual(6);
  run(64, false);
  expect(lander.flame).toBeLessThan(0.02);
  expect(flameDots(engine)).toBe(0);
});

test("fuel flame timing is independent of rendering cadence and renders do not advance it", () => {
  const slow = create(),
    fast = create();
  for (const steps of [8, 4, 4, 4, 32, 64]) {
    slow.press("thrust");
    fast.press("thrust");
    for (let i = 0; i < steps; i++) {
      fast.tick(moonlander.STEP);
      scene.render(fast);
    }
    for (let i = 0; i < steps / 4; i++) {
      slow.tick(moonlander.STEP * 4);
      const before = slow.lander!.flame;
      scene.render(slow);
      scene.render(slow);
      expect(slow.lander!.flame).toBe(before);
    }
    expect(slow.lander!.flame).toBeCloseTo(fast.lander!.flame, 10);
    expect(hud(slow)).toEqual(hud(fast));
  }
});

test("the flame grows directly from a solid heated cap, including half-filled edge cells", () => {
  const engine = create();
  engine.lander!.fuel = 420;
  engine.press("thrust");
  for (let i = 0; i < 4; i++) engine.tick(moonlander.STEP);
  const cells = hud(engine),
    edge = cells.findIndex(cell => cell.dots !== 0);
  expect(edge).toBeGreaterThan(0);
  expect(cells[edge - 1].glyph).toBe("█");
  expect(cells[edge - 1].fg).toBe("warm");
  expect(cells[edge].fg).toBe("warm");
  expect(cells[edge].dots & 0x47).toBe(0x47);
});

test("fuel flame freezes on pause, fades after fuel exhaustion, and resets on restart", () => {
  const engine = create();
  engine.press("thrust");
  for (let i = 0; i < 8; i++) engine.tick(0.1);
  engine.press("pause");
  const paused = hud(engine),
    flame = engine.lander!.flame;
  engine.tick(0.1);
  expect(engine.lander!.flame).toBe(flame);
  expect(hud(engine)).toEqual(paused);
  engine.press("pause");
  engine.lander!.fuel = 0;
  engine.tick(moonlander.STEP);
  expect(engine.lander!.flame).toBeLessThan(flame);
  expect(flameDots(engine)).toBeGreaterThan(0);
  for (let i = 0; i < 16; i++) engine.tick(0.1);
  expect(flameDots(engine)).toBe(0);
  expect(
    hud(engine)
      .map(cell => cell.glyph)
      .join(""),
  ).toContain("tilt 0°");
  engine.press("restart");
  engine.press("advance");
  expect(engine.lander!.flame).toBe(0);
  expect(flameDots(engine)).toBe(0);
});

test("a braille hull of any style moves as one piece, a whole dot at a time", () => {
  const engine = create(),
    K = engine.world.K;
  Object.assign(engine.world, { stars: [], twinkles: [], earth: { x: 0, y: 0, r: 0 } });
  let style: hull.Braille = "fixed";
  const dots = (x: number, y: number, a: number) => {
    Object.assign(engine.lander!, { x, y: y * K, a });
    const screen = scene.render(engine, true, style),
      out: string[] = [];
    screen.cells.forEach((cell, i) => {
      if (cell.fg !== "text" || !cell.dots) return;
      for (let b = 0; b < 8; b++)
        if (cell.dots & (1 << b)) {
          const at = [1, 8, 2, 16, 4, 32, 64, 128].indexOf(1 << b);
          out.push(`${(i % screen.cols) * 2 + (at % 2)},${Math.floor(i / screen.cols) * 4 + Math.floor(at / 2)}`);
        }
    });
    return out.sort();
  };
  const shifted = (list: string[], by: number) =>
    list
      .map(dot => {
        const [x, y] = dot.split(",").map(Number);
        return `${x + by},${y + by}`;
      })
      .sort();
  for (style of ["fixed", "turned", "turned-gray"] as const)
    for (const a of [0, 0.36, -0.84]) {
      const rest = dots(72, 40, a);
      expect(rest.length).toBeGreaterThan(60);
      for (const d of [0.1, 0.3, 0.7, 1.2, 1.4, 1.6])
        expect(dots(72 + d, 40 + d, a)).toEqual(shifted(rest, Math.round(d)));
    }
  // The image draws the hull itself, so the text leaves it out.
  style = "fixed";
  const braille = dots(72, 40, 0.36);
  Object.assign(engine.lander!, { x: 72, y: 40 * K, a: 0.36 });
  expect(scene.render(engine, true, "image").cells.filter(cell => cell.dots && cell.fg === "text")).toEqual([]);
  expect(braille.length).toBeGreaterThan(60);
});

test("as the camera pans, a pad slides with the ground's dots and its label blurs across rows", () => {
  const engine = create(),
    R = 4 * engine.world.K,
    L = engine.lander!,
    lines = ["▔", ...Array.from({ length: 6 }, (_, i) => String.fromCodePoint(0x1fb76 + i)), "▁"];
  // Where the first pad's line is, in eighths of a cell from the top, and its
  // label, in cells, each row weighed by its share of the label.
  const pad = () => {
    const screen = scene.render(engine, true),
      at = screen.cells.findIndex(cell => lines.includes(cell.glyph)),
      width = screen.cells.filter(
        (cell, i) => lines.includes(cell.glyph) && Math.floor(i / screen.cols) === Math.floor(at / screen.cols),
      ).length,
      col = screen.cells.findIndex(cell => cell.glyph === "×") % screen.cols,
      label = screen.cells
        .map((cell, i) => ({ cell, row: Math.floor(i / screen.cols), col: i % screen.cols }))
        .filter(({ cell, col: c }) => cell.glyph === "×" && c === col);
    expect(label.length).toBeLessThanOrEqual(2);
    return {
      width,
      line: Math.floor(at / screen.cols) * 8 + lines.indexOf(screen.cells[at].glyph),
      label: label.reduce((sum, { cell, row }) => sum + row * cell.alpha ** (1 / 0.6), 0),
      shares: label.reduce((sum, { cell }) => sum + cell.alpha ** (1 / 0.6), 0),
    };
  };
  Object.assign(L, { y: moonlander.SHIP.top + (3.75 - 1) * R, vx: 0, vy: 0 });
  engine.tick(moonlander.STEP);
  let camera = engine.cameraY,
    at = pad(),
    moved = 0;
  for (let i = 0; i < 40; i++) {
    Object.assign(L, { y: L.y - 0.2, vy: 0 });
    engine.tick(moonlander.STEP);
    const next = pad(),
      dots = Math.floor(-camera / engine.world.K) - Math.floor(-engine.cameraY / engine.world.K);
    expect(at.line - next.line).toBe(2 * dots);
    expect(Math.abs(next.line - at.line)).toBeLessThanOrEqual(2);
    expect(next.shares).toBeCloseTo(1, 6);
    // The label never takes cells from the line.
    expect(next.width).toBe(at.width);
    expect((next.label - at.label) * 8).toBeCloseTo(next.line - at.line, 6);
    moved += Math.abs(next.line - at.line);
    ((at = next), (camera = engine.cameraY));
  }
  expect(moved).toBeGreaterThan(8);
  // Once the camera holds still, the label settles into one row.
  for (let i = 0; i < 30; i++) {
    Object.assign(L, { vy: 0 });
    engine.tick(moonlander.STEP * 3);
  }
  expect(engine.cameraY).toBe(camera);
  const settled = scene.render(engine, true).cells.filter(cell => cell.glyph === "×");
  expect(settled.every(cell => cell.alpha === 1)).toBe(true);
});
