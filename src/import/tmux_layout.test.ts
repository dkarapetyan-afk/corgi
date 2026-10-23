import { test, expect } from "bun:test";
import { parse, checksum } from "./tmux_layout";
const fixture = (body: string) => checksum(body).toString(16).padStart(4, "0") + "," + body;
test("tmux saved layout preserves nested panes by id, not listing order", () => {
  const g = parse(fixture("120x40,0,0{59x40,0,0,12,60x40,60,0[60x19,60,0,3,60x20,60,20,27]}"));
  expect(g.count).toBe(3);
  expect({ ...g.find("%12") }).toEqual({ x: 0, y: 0, w: 59, h: 40 });
  expect({ ...g.find("%3") }).toEqual({ x: 60, y: 0, w: 60, h: 19 });
  expect({ ...g.find("%27") }).toEqual({ x: 60, y: 20, w: 60, h: 20 });
  expect(g.find("%1")).toBe(null);
});
test("tmux layouts allow single panes and multiple siblings", () => {
  expect(parse(fixture("80x24,0,0,42")).count).toBe(1);
  const g = parse(fixture("122x24,0,0{40x24,0,0,1,40x24,41,0,2,40x24,82,0,3}"));
  expect(g.count).toBe(3);
  expect(g.find("%3")?.x).toBe(82);
});
test("tmux layouts reject malformed or incomplete snapshots", () => {
  for (const body of [
    "80x24,0,0",
    "80x24,0,0{39x24,0,0,1,40x24,40,0,2]",
    "80x24,0,0{39x24,0,0,1,40x24,40,0,1}",
    "80x24,0,0,1trailing",
    "65536x24,0,0,1",
    "0x24,0,0,1",
  ])
    expect(() => parse(fixture(body))).toThrow("InvalidTmuxLayout");
  expect(() => parse("0000,80x24,0,0,1")).toThrow("InvalidTmuxLayout");
});
test("tmux 3.8's JSON layouts read the same panes", () => {
  const pane = (id: number, w: number, h: number, x: number, y: number) => ({ t: "p", w, h, x, y, I: `%${id}` });
  const layout = (root: object) => JSON.stringify({ V: 2, L: root });
  const g = parse(
    layout({
      t: "h",
      w: 100,
      h: 30,
      x: 0,
      y: 0,
      c: [
        pane(0, 50, 30, 0, 0),
        { t: "v", w: 49, h: 30, x: 51, y: 0, c: [pane(1, 49, 15, 51, 0), pane(2, 49, 14, 51, 16)] },
      ],
    }),
  );
  expect(g.count).toBe(3);
  expect({ ...g.find("%0") }).toEqual({ x: 0, y: 0, w: 50, h: 30 });
  expect({ ...g.find("%2") }).toEqual({ x: 51, y: 16, w: 49, h: 14 });
  expect(parse(layout(pane(42, 80, 24, 0, 0))).count).toBe(1);
  for (const root of [
    { t: "h", w: 80, h: 24, x: 0, y: 0, c: [] },
    { t: "h", w: 80, h: 24, x: 0, y: 0, c: [pane(1, 40, 24, 0, 0), pane(1, 39, 24, 41, 0)] },
    pane(1, 0, 24, 0, 0),
    pane(1, 65536, 24, 0, 0),
    { ...pane(1, 80, 24, 0, 0), I: "1" },
    { ...pane(1, 80, 24, 0, 0), t: "x" },
  ])
    expect(() => parse(layout(root))).toThrow("InvalidTmuxLayout");
  for (const text of ["{", "{}", '{"V":2}', "[]"]) expect(() => parse(text)).toThrow("InvalidTmuxLayout");
});
