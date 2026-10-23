import { Rect, max_panes } from "../layout";
export class Geometry {
  panes: { id: number; rect: Rect }[] = [];
  get count() {
    return this.panes.length;
  }
  find(id: string): Rect | null {
    if (!/^%\d+$/.test(id) || Number(id.slice(1)) > 0xffffffff) return null;
    return this.panes.find(p => p.id === Number(id.slice(1)))?.rect ?? null;
  }
}
export function checksum(text: string): number {
  let sum = 0;
  for (const byte of Buffer.from(text)) sum = (((sum >>> 1) | (sum << 15)) + byte) & 0xffff;
  return sum;
}
function fail(): never {
  throw Error("InvalidTmuxLayout");
}
export function parse(text: string): Geometry {
  if (text.startsWith("{")) return parseJson(text);
  if (!/^[0-9a-fA-F]{4},/.test(text) || parseInt(text.slice(0, 4), 16) !== checksum(text.slice(5))) fail();
  const body = text.slice(5),
    geometry = new Geometry();
  let pos = 0;
  function take(char: string): boolean {
    if (body[pos] !== char) return false;
    pos++;
    return true;
  }
  function expect(char: string) {
    if (!take(char)) fail();
  }
  function number(max = 65535): number {
    const match = /^\d+/.exec(body.slice(pos));
    if (!match) return fail() as never;
    pos += match[0].length;
    const n = Number(match[0]);
    if (n > max) fail();
    return n;
  }
  function cell(depth: number): void {
    if (depth >= max_panes) fail();
    const w = number();
    expect("x");
    const h = number();
    expect(",");
    const x = number();
    expect(",");
    const y = number();
    if (!w || !h) fail();
    const close = take("{") ? "}" : take("[") ? "]" : null;
    if (close) {
      cell(depth + 1);
      while (take(",")) cell(depth + 1);
      expect(close);
    } else {
      expect(",");
      const id = number(0xffffffff);
      if (geometry.count === max_panes) throw Error("TooManyPanes");
      if (geometry.panes.some(p => p.id === id)) fail();
      geometry.panes.push({ id, rect: new Rect(x, y, w, h) });
    }
  }
  cell(0);
  if (pos !== body.length) fail();
  return geometry;
}
/** tmux 3.8 writes a layout as JSON, `{"V":2,"L":node}`: a node is a pane
 * (`"t":"p"`, its id in `"I"`) or a split (`"h"` or `"v"`) of the nodes in `"c"`. */
function parseJson(text: string): Geometry {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    fail();
  }
  const geometry = new Geometry();
  const number = (value: unknown, max = 65535) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? value : fail();
  function cell(node: unknown, depth: number): void {
    if (depth >= max_panes || typeof node !== "object" || node === null) fail();
    const { t, w, h, x, y, I, c } = node as Record<string, unknown>;
    const rect = new Rect(number(x), number(y), number(w), number(h));
    if (!rect.w || !rect.h) fail();
    if (t === "p") {
      if (typeof I !== "string" || !/^%\d+$/.test(I)) fail();
      const id = number(Number(I.slice(1)), 0xffffffff);
      if (geometry.count === max_panes) throw Error("TooManyPanes");
      if (geometry.panes.some(p => p.id === id)) fail();
      geometry.panes.push({ id, rect });
    } else if ((t === "h" || t === "v") && Array.isArray(c) && c.length > 0) {
      for (const child of c) cell(child, depth + 1);
    } else fail();
  }
  cell(typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>).L : null, 0);
  return geometry;
}
