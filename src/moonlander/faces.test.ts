import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import * as moonlander from "./moonlander";
import * as faces from "./faces";

function chunks(png: Uint8Array) {
  const data = Buffer.from(png),
    found = new Map<string, Buffer>();
  for (let at = 8; at < data.length;) {
    const size = data.readUInt32BE(at),
      name = data.toString("ascii", at + 4, at + 8);
    found.set(name, data.subarray(at + 8, at + 8 + size));
    at += size + 12;
  }
  return found;
}

test("indexed PNGs keep palette alpha, packed rows and quantization at every supported bit depth", async () => {
  for (const bits of [2, 4, 8] as const) {
    // Odd row lengths exercise padding between packed scanlines.
    const atlas = { ...faces.layout(10, 22), width: 7, height: 3 };
    const alpha = Uint8Array.from({ length: 21 }, (_, i) => Math.round((i * 255) / 20));
    const png = await faces.encode(atlas, alpha, [238, 241, 244], bits),
      parts = chunks(png);
    expect(parts.get("IHDR")![8]).toBe(bits);
    expect(parts.get("IHDR")![9]).toBe(3);
    expect(parts.get("PLTE")!.length).toBe((1 << bits) * 3);
    expect(parts.get("tRNS")!.length).toBe(1 << bits);
    // Native PNG decode independently checks the stream, CRCs and palette.
    expect((await new Bun.Image(png).png().bytes()).length).toBeGreaterThan(0);
    const raw = inflateSync(parts.get("IDAT")!),
      stride = Math.ceil((7 * bits) / 8),
      levels = (1 << bits) - 1;
    for (let y = 0; y < 3; y++) {
      expect(raw[y * (stride + 1)]).toBe(0);
      for (let x = 0; x < 7; x++) {
        const packed = raw[y * (stride + 1) + 1 + Math.floor((x * bits) / 8)],
          index = (packed >> (8 - bits - ((x * bits) % 8))) & levels;
        expect(Math.abs(parts.get("tRNS")![index] - alpha[y * 7 + x])).toBeLessThanOrEqual(Math.ceil(255 / levels / 2));
      }
    }
  }
});

test("moods reuse glyph tiles and the round bullet has a single tile", () => {
  const atlas = faces.layout(10, 22);
  expect(atlas.tiles.find(t => t.glyph === "•")?.count).toBe(1);
  expect(atlas.tiles.filter(t => t.glyph !== "•").every(t => t.count === 91)).toBe(true);
  expect(atlas.tiles.reduce((n, t) => n + t.count, 0)).toBe(547);
  expect(() => faces.pack(atlas, new Uint8Array(1))).toThrow("BadFaceTiles");
});

test("face crops stay inside the atlas and viewport, including wraps and overlay occlusion", () => {
  const engine = moonlander.create({ size: () => ({ cols: 80, rows: 24 }), aspect: 2.2 });
  engine.title();
  const atlas = faces.layout(10, 22),
    L = engine.lander!;
  for (const x of [0.1, 80, 159.9])
    for (const a of [-Math.PI / 2, 0, Math.PI / 2]) {
      Object.assign(L, { x, a });
      const placements = faces.placements(engine, atlas);
      expect(placements.length).toBeGreaterThan(0);
      for (const p of placements) {
        expect(Object.values(p).every(Number.isInteger)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + p.w).toBeLessThanOrEqual(800);
        expect(p.y + p.h).toBeLessThanOrEqual(528);
        expect(p.sx).toBeGreaterThanOrEqual(0);
        expect(p.sy).toBeGreaterThanOrEqual(0);
        expect(p.sx + p.w).toBeLessThanOrEqual(atlas.width);
        expect(p.sy + p.h).toBeLessThanOrEqual(atlas.height);
      }
    }
  expect(faces.placements(engine, atlas, [{ x: 0, y: 0, w: 80, h: 24 }])).toEqual([]);
});

test("the graphical passenger follows the camera above the original viewport", () => {
  const engine = moonlander.create({ size: () => ({ cols: 80, rows: 24 }), aspect: 2.2 });
  engine.launch(1);
  const L = engine.lander!,
    atlas = faces.layout(10, 22);
  Object.assign(L, { y: -100, vx: 0, vy: -moonlander.G * moonlander.STEP });
  engine.tick(moonlander.STEP);
  const panned = faces.placements(engine, atlas);
  expect(panned.length).toBeGreaterThan(0);
  expect(panned.every(p => p.y >= 3 * atlas.ch && p.y + p.h < 8 * atlas.ch)).toBe(true);
  // Moving the ship and camera by the same distance preserves its placement.
  L.y -= engine.cameraY;
  engine.launch(1);
  Object.assign(engine.lander!, L);
  expect(faces.placements(engine, atlas)).toEqual(panned);
});

test("the passenger moves with the hull, a whole dot at a time", () => {
  const engine = moonlander.create({ size: () => ({ cols: 80, rows: 24 }), aspect: 2.2 });
  engine.launch(1);
  const L = engine.lander!,
    atlas = faces.layout(10, 22),
    at = (x: number) => {
      Object.assign(L, { x, a: 0.36 });
      return faces.placements(engine, atlas);
    };
  const rest = at(80);
  expect(at(80.3)).toEqual(rest);
  expect(at(80.7)).toEqual(rest.map(p => ({ ...p, x: p.x + atlas.cw / 2 })));
});
