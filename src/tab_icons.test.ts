import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import * as palette from "./palette";
import { Icons, size } from "./tab_icons";

const cell = { width: 9, height: 18 };
/** The pixels of the one mark an upload sends. */
function pixels(upload: string): Uint8Array {
  const data = [...upload.matchAll(/\x1b_G[^;]*;([^\x1b]*)\x1b\\/g)].map(m => m[1]).join("");
  return inflateSync(Buffer.from(data, "base64"));
}
/** The color of its most opaque pixel. */
function ink(rgba: Uint8Array): number[] {
  let best = 0;
  for (let at = 0; at < rgba.length; at += 4) if (rgba[at + 3] > rgba[best + 3]) best = at;
  return [...rgba.subarray(best, best + 3)];
}

test("a mark is sent the first time a tab shows it, then only placed", () => {
  const icons = new Icons();
  expect(icons.begin()).toBe("");
  expect(icons.place("bun", 5, 0, cell)).toBe("");
  const sent = icons.end();
  expect(sent).toStartWith("\x1b_Ga=t,t=d,f=32,o=z,s=14,v=14,i=730301,q=2,m=0;");
  expect(pixels(sent)).toHaveLength(14 * 14 * 4);
  // Later frames take it off and place it again; nothing is sent.
  expect(icons.begin()).toBe("\x1b_Ga=d,d=i,i=730301,q=2\x1b\\");
  expect(icons.place("bun", 5, 0, cell)).toBe("\x1b7\x1b[1;6H\x1b_Ga=p,i=730301,p=1,Y=2,z=1,C=1,q=2\x1b\\\x1b8");
  expect(icons.place("bun", 17, 0, cell)).toContain("p=2,");
  expect(icons.end()).toBe("");
  // A frame without it keeps it on the host, so it comes back without a send.
  icons.begin();
  expect(icons.end()).toBe("");
  icons.begin();
  expect(icons.place("bun", 5, 0, cell)).not.toBe("");
  // Another brand sends only itself.
  icons.place("node", 17, 0, cell);
  expect(icons.end()).toContain("i=730300,");
  expect(icons.end()).toBe("");
});

test("a new cell size draws the mark again, and leaving frees them all", () => {
  const icons = new Icons();
  icons.place("vim", 3, 0, cell);
  icons.end();
  icons.begin();
  const big = { width: 18, height: 36 };
  expect(icons.place("vim", 3, 0, big)).toBe("");
  expect(icons.end()).toContain("s=28,v=28,i=730309,");
  expect(icons.clear()).toBe("\x1b_Ga=d,d=I,i=730309,q=2\x1b\\");
  expect(icons.begin()).toBe("");
});

test("a one-color mark that would barely show takes the tabs' ink; others keep their colors", () => {
  const icons = new Icons();
  const big = { width: 18, height: 36 };
  icons.place("rust", 3, 0, big);
  expect(ink(pixels(icons.end()))).toEqual(palette.colors.text);
  icons.place("node", 3, 0, big);
  expect(ink(pixels(icons.end()))).toEqual([0x5f, 0xa0, 0x4e]);
});

test("a mark fills its two cells' box less a tenth at each edge, centered down the cell", () => {
  expect(size({ width: 9, height: 18 })).toEqual({ side: 14, top: 2 });
  expect(size({ width: 18, height: 37 })).toEqual({ side: 28, top: 4 });
  // Narrow cells give the width.
  expect(size({ width: 7, height: 20 })).toEqual({ side: 12, top: 4 });
});
