import { expect, test } from "bun:test";
import * as moonlander from "./moonlander";

function create(saveBest?: (score: number) => void) {
  let seed = 12345;
  const engine = moonlander.create({
    size: () => ({ cols: 100, rows: 40 }),
    aspect: 2.2,
    random: () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    },
    saveBest,
  });
  engine.title();
  return engine;
}

function approach(engine: moonlander.Engine) {
  engine.launch(1);
  const pad = engine.world.pads[0],
    lander = engine.lander!;
  Object.assign(lander, { x: (pad.x0 + pad.x1) / 2, y: pad.y - 10 * engine.world.K - 0.1, vx: 0, vy: 2, a: 0 });
  return { pad, lander };
}

test("terrain wraps and landing pads remain flat and inside the world", () => {
  const engine = create();
  for (const cols of [72, 80, 100, 200]) {
    const sized = moonlander.create({ size: () => ({ cols, rows: 24 }), aspect: 2.2 });
    for (const round of [1, 8, 20]) {
      sized.launch(round);
      const { world } = sized;
      expect(world.ground(-0.25)).toBeCloseTo(world.ground(world.W - 0.25));
      expect(world.ground(world.W + 0.25)).toBeCloseTo(world.ground(0.25));
      for (const pad of world.pads) {
        expect(pad.x0).toBeGreaterThanOrEqual(0);
        expect(pad.x1).toBeLessThan(world.W);
        for (let x = pad.x0; x <= pad.x1; x++) expect(world.ground(x)).toBe(pad.y);
      }
    }
  }
  expect(engine.game.state).toBe("title");
});

test("thrust burns fuel and overcomes gravity; a pause freezes the simulation", () => {
  const engine = create();
  engine.launch(1);
  const lander = engine.lander!,
    before = { ...lander };
  engine.keys.up = true;
  for (let i = 0; i < 5; i++) engine.tick(0.1);
  expect(lander.fuel).toBeCloseTo(before.fuel - 30);
  expect(lander.vy).toBeCloseTo(before.vy + (moonlander.G - moonlander.THRUST) * 0.5);
  engine.game.paused = true;
  const frozen = { ...lander },
    time = engine.game.t;
  engine.tick(0.1);
  engine.tilt(1);
  expect(lander).toEqual(frozen);
  expect(engine.game.t).toBe(time);
});

test("fixed steps give the same flight at different rendering cadences", () => {
  const a = create(),
    b = create();
  a.launch(1);
  b.launch(1);
  a.keys.up = b.keys.up = true;
  for (let i = 0; i < 60; i++) a.tick(1 / 120);
  for (let i = 0; i < 15; i++) b.tick(1 / 30);
  expect(a.lander).toEqual(b.lander);
  expect(a.game.t).toBe(b.game.t);
  expect(a.cameraY).toBe(b.cameraY);
});

test("the camera follows an ascending ship past the old ceiling and returns during descent", () => {
  for (const angle of [-Math.PI / 2, 0, Math.PI / 2]) {
    const engine = create();
    engine.launch(1);
    const L = engine.lander!,
      R = 4 * engine.world.K;
    expect(engine.cameraY).toBe(0);
    Object.assign(L, { vx: 0, vy: -40, a: angle });
    for (let i = 0; i < 30; i++) {
      engine.tick(0.1);
      expect(engine.game.state).toBe("flying");
      for (const cell of engine.shipCells(L).cells.values())
        for (let bit = 0; bit < 8; bit++)
          if (cell.bits & (1 << bit))
            expect((cell.row * 4 + Math.floor(bit / 2)) * engine.world.K - engine.cameraY).toBeGreaterThanOrEqual(
              3 * R,
            );
    }
    expect(L.y).toBeLessThan(-40);
    expect(L.vy).toBeLessThan(0);
    expect(engine.cameraY).toBeLessThan(0);
    const camera = engine.cameraY;
    engine.game.paused = true;
    engine.tick(0.1);
    expect(engine.cameraY).toBe(camera);
    engine.game.paused = false;
    for (let i = 0; i < 90 && engine.cameraY < 0; i++) engine.tick(0.1);
    expect(engine.cameraY).toBe(0);
    expect(engine.game.state).toBe("flying");
  }
});

test("new rounds and the title reset the camera", () => {
  const engine = create();
  for (const reset of [() => engine.launch(2), () => engine.title()]) {
    engine.launch(1);
    Object.assign(engine.lander!, { y: -100, vx: 0, vy: -1 });
    engine.tick(moonlander.STEP);
    expect(engine.cameraY).toBeLessThan(0);
    reset();
    expect(engine.cameraY).toBe(0);
  }
});

test("a soft landing awards pad and fuel points, saves the best, then advances a round", () => {
  const saved: number[] = [],
    engine = create(score => saved.push(score));
  const { pad } = approach(engine);
  engine.tick(0.1);
  expect(engine.game.state).toBe("landed");
  expect(engine.game.result?.soft).toBe(true);
  expect(engine.game.score).toBe(100 * pad.mult + 80);
  expect(saved).toEqual([engine.game.score]);
  const score = engine.game.score;
  engine.advance();
  expect(engine.game.state).toBe("landed");
  for (let i = 0; i < 65; i++) engine.tick(0.1);
  expect(engine.corgi?.air).toBe(false);
  engine.advance();
  expect(engine.game.state).toBe("flying");
  expect(engine.game.round).toBe(2);
  expect(engine.game.score).toBe(score);
  expect(engine.lander?.fuelMax).toBe(750);
});

test("unsafe approaches crash into debris and recover to a fresh attempt", () => {
  for (const velocity of [{ vy: 20 }, { vx: 10 }, { a: 0.5 }]) {
    const engine = create();
    const { lander } = approach(engine);
    Object.assign(lander, velocity);
    engine.tick(0.1);
    expect(engine.game.state).toBe("crashed");
    expect(engine.lander).toBeNull();
    expect(engine.debris.length).toBeGreaterThan(0);
    expect(engine.corgi?.crashed).toBe(true);
    expect(engine.game.result?.why).toBeTruthy();
    for (let i = 0; i < 80; i++) engine.tick(0.1);
    expect(engine.corgi?.air).toBe(false);
    engine.advance();
    expect(engine.game.state).toBe("flying");
    expect(engine.game.score).toBe(0);
  }
});

test("terminal and browser share launch, thrust toggles, tilt steps and pause controls", () => {
  const engine = create();
  engine.press("thrust");
  expect(engine.game.state).toBe("flying");
  expect(engine.keys.up).toBe(false);
  engine.press("thrust");
  expect(engine.keys.up).toBe(true);
  engine.press("left");
  expect(engine.lander!.a).toBe(-0.12);
  engine.press("right");
  expect(engine.lander!.a).toBe(0);
  engine.press("cut");
  expect(engine.keys.up).toBe(false);
  engine.press("pause");
  expect(engine.game.paused).toBe(true);
  engine.press("thrust");
  expect(engine.game.paused).toBe(false);
  expect(engine.keys.up).toBe(false);
  engine.press("restart");
  expect(engine.game.state).toBe("title");
  expect(engine.keys.up).toBe(false);
});

test("a tilt either way draws the same outline mirrored", () => {
  const engine = create();
  engine.launch(1);
  for (let step = 0; step <= 13; step++) {
    const lit = engine.shipDots(step * 0.12).map(([x, y]) => x + "," + y),
      mirrored = engine.shipDots(-step * 0.12).map(([x, y]) => -1 - x + "," + y);
    expect(mirrored.sort()).toEqual(lit.sort());
  }
});

test("while panned, the camera keeps the ship's top within four rows below its follow line", () => {
  const engine = create();
  engine.launch(1);
  const L = engine.lander!,
    R = 4 * engine.world.K;
  Object.assign(L, { vx: 0, vy: -40, a: 0 });
  let up = 0,
    down = 0;
  for (let i = 0; i < 500 && engine.game.state === "flying"; i++) {
    const vy = L.vy;
    engine.tick(0.02);
    if (engine.cameraY >= 0) continue;
    const top = L.y - moonlander.SHIP.top - engine.cameraY;
    expect(top).toBeGreaterThanOrEqual(3.75 * R - 1e-6);
    expect(top).toBeLessThanOrEqual(7.75 * R + 1e-6);
    if (vy < 0) up++;
    else down++;
  }
  expect(up).toBeGreaterThan(10);
  expect(down).toBeGreaterThan(10);
});
