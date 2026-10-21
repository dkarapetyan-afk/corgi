import { expect, test } from "bun:test";
import * as moonlander from "./moonlander";
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
