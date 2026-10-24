import { expect, test } from "bun:test";
import { outlines, rasterize } from "./path_raster";

const white = [255, 255, 255] as [number, number, number];
const alpha = (pixels: Uint8Array, width: number, x: number, y: number) => pixels[(y * width + x) * 4 + 3];

test("a square covers whole pixels inside and the share of each pixel its edge cuts", () => {
  const pixels = rasterize([{ d: "M1 1h2v2H1z", rgb: white }], [0, 0, 4, 4], 4, 4);
  expect(alpha(pixels, 4, 1, 1)).toBe(255);
  expect(alpha(pixels, 4, 2, 2)).toBe(255);
  expect(alpha(pixels, 4, 0, 0)).toBe(0);
  expect(alpha(pixels, 4, 3, 3)).toBe(0);
  // Half a pixel in from the edge, half its ink.
  const half = rasterize([{ d: "M.5 0H2V2H.5z", rgb: white }], [0, 0, 2, 2], 2, 2);
  expect(alpha(half, 2, 0, 0)).toBe(128);
  expect(alpha(half, 2, 1, 1)).toBe(255);
  // Reversed winding inside cuts a hole, as the nonzero rule does.
  const ring = rasterize([{ d: "M0 0h4v4H0zM1 1v2h2V1z", rgb: white }], [0, 0, 4, 4], 4, 4);
  expect(alpha(ring, 4, 0, 0)).toBe(255);
  expect(alpha(ring, 4, 1, 1)).toBe(0);
});

test("relative commands, shorthand curves and compact arc flags trace the shapes they describe", () => {
  // A circle of radius 1 from two arcs whose flags run into their numbers.
  const [circle] = outlines("M0 1a1 1 0 102 0 1 1 0 10-2 0z", 16);
  const radii = [];
  for (let i = 0; i < circle.length; i += 2) radii.push(Math.hypot(circle[i] - 1, circle[i + 1] - 1));
  for (const r of radii) expect(r).toBeCloseTo(1, 5);
  // A relative move after a close starts from where the last shape began.
  const shapes = outlines("M2 2h1v1z m1 1h1v1z", 1);
  expect(shapes[1].slice(0, 2)).toEqual([3, 3]);
  // A smooth cubic mirrors the last control point.
  const [s] = outlines("M0 0C0 1 1 1 1 0S2-1 2 0", 4);
  expect(s.slice(-2)).toEqual([2, 0]);
  expect(() => outlines("M0 0 Q", 1)).toThrow("InvalidPath");
});

test("layers paint over the ones before them, in their colors", () => {
  const pixels = rasterize(
    [
      { d: "M0 0h2v2H0z", rgb: [255, 0, 0] },
      { d: "M1 0h1v2H1z", rgb: [0, 0, 255] },
    ],
    [0, 0, 2, 2],
    2,
    2,
  );
  expect([...pixels.subarray(0, 8)]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  // A view box wider than the image is fitted and centered.
  const wide = rasterize([{ d: "M0 0h4v2H0z", rgb: white }], [0, 0, 4, 2], 4, 4);
  expect(alpha(wide, 4, 0, 0)).toBe(0);
  expect(alpha(wide, 4, 0, 1)).toBe(255);
  expect(alpha(wide, 4, 0, 3)).toBe(0);
  // A box that starts away from the origin draws from its corner.
  const offset = rasterize([{ d: "M1 1h2v2H1z", rgb: white }], [1, 1, 2, 2], 2, 2);
  expect(alpha(offset, 2, 0, 0)).toBe(255);
});
