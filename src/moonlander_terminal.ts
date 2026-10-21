//! Viewer-independent terminal adapter for Moonlander's shared engine and renderer.
import { deflateSync } from "node:zlib";
import * as moonlander from "./moonlander";
import * as scene from "./moonlander_scene";
import * as faces from "./moonlander_faces";
import * as palette from "./palette";
import * as keyboard from "./keyboard";
import { masks } from "./assets/moonlander_glyphs";
import type { Cell } from "./fork_motion";

export type Rasterize = (atlas: faces.Atlas) => Uint8Array | Promise<Uint8Array>;
function lines(screen: scene.Screen) {
  return Array.from({ length: screen.rows }, (_, row) => {
    let line = "",
      previous = "";
    for (const cell of screen.cells.slice(row * screen.cols, (row + 1) * screen.cols)) {
      const style = `${cell.fg}/${cell.bg}/${cell.bold}`;
      if (style !== previous) {
        line += `\x1b[0m${palette.fg(cell.fg)}${palette.bg(cell.bg)}${cell.bold ? "\x1b[1m" : ""}`;
        previous = style;
      }
      line += cell.glyph;
    }
    return line + "\x1b[0m";
  });
}

const imageId = 730202;
const queryId = 730201;
const hideFace = `\x1b_Ga=d,d=i,i=${imageId},q=2\x1b\\`;
const removeFace = `\x1b_Ga=d,d=I,i=${imageId},q=2\x1b\\`;
/** Ghostty's ED2 also deletes stored images, including an unplaced atlas. */
export function clearText(cols: number, rows: number): string {
  let out = hideFace + `\x1b[0m${palette.bg("bg")}`;
  for (let row = 0; row < rows; row++) out += `\x1b[${row + 1};1H${" ".repeat(cols)}`;
  return out;
}
export function upload(png: Uint8Array): string {
  const data = Buffer.from(png).toString("base64");
  let out = "";
  for (let offset = 0; offset < data.length; offset += 4096) {
    const end = Math.min(offset + 4096, data.length),
      more = Number(end < data.length);
    out +=
      (offset === 0 ? `\x1b_Ga=t,t=d,f=100,i=${imageId},m=${more};` : `\x1b_Gm=${more};`) +
      data.slice(offset, end) +
      "\x1b\\";
  }
  return out;
}
function place(items: faces.Placement[], atlas: faces.Atlas, ox: number, oy: number): string {
  let out = hideFace;
  items.forEach((p, i) => {
    const x = p.x + ox * atlas.cw,
      y = p.y + oy * atlas.ch,
      col = Math.floor(x / atlas.cw),
      row = Math.floor(y / atlas.ch);
    out += `\x1b[${row + 1};${col + 1}H\x1b_Ga=p,i=${imageId},p=${i + 1},x=${p.sx},y=${p.sy},w=${p.w},h=${p.h},X=${x - col * atlas.cw},Y=${y - row * atlas.ch},z=1,C=1,q=1\x1b\\`;
  });
  return out;
}

export class State {
  readonly engine: moonlander.Engine;
  cell: Cell | null = null;
  supported = false;
  private size: { cols: number; rows: number };
  private options: moonlander.Options;
  private atlas: faces.Atlas | null = null;
  private ready = false;
  private building = "";
  private generation = 0;
  private closed = false;
  private last: number | null = null;
  private writes: string[] = [];
  private rasterize: Rasterize;
  constructor(
    cols: number,
    rows: number,
    private changed = () => {},
    rasterize?: Rasterize,
  ) {
    this.size = { cols: Math.max(72, Math.min(200, cols)), rows: Math.max(24, Math.min(70, rows)) };
    this.options = { size: () => this.size, aspect: 2.2 };
    this.engine = moonlander.create(this.options);
    this.engine.title();
    this.rasterize = rasterize ?? (atlas => faces.rasterize(atlas, masks));
  }
  static query() {
    return `\x1b[16t\x1b[14t\x1b_Ga=q,i=${queryId},t=d,f=24,s=1,v=1;AAAA\x1b\\`;
  }
  takeWrites(): string[] {
    return this.writes.splice(0);
  }
  close(): string {
    this.closed = true;
    this.generation++;
    this.writes = [];
    return removeFace;
  }
  release(): void {
    this.engine.keys.up = false;
    if (this.engine.game.state === "flying") this.engine.game.paused = true;
  }
  key(byte: number): boolean {
    if (byte === 27 || byte === 113 || byte === 3) return true;
    const inputs: Record<number, moonlander.Input> = {
      13: "advance",
      10: "advance",
      32: "thrust",
      119: "thrust",
      115: "cut",
      97: "left",
      100: "right",
      112: "pause",
      114: "restart",
    };
    const input = inputs[byte];
    if (input) this.engine.press(input);
    return false;
  }
  sequence(sequence: string): boolean {
    const key = keyboard.decode(sequence);
    if (!key) return false;
    if (key.mods.ctrl) return key.codepoint === 99;
    if (key.mods.alt || key.mods.super) return false;
    const inputs: Record<number, moonlander.Input> = {
      [keyboard.arrow_up]: "thrust",
      [keyboard.arrow_down]: "cut",
      [keyboard.arrow_left]: "left",
      [keyboard.arrow_right]: "right",
    };
    const input = inputs[key.codepoint];
    if (input) this.engine.press(input);
    else return this.key(key.codepoint);
    return false;
  }
  click(x: number, y: number): boolean {
    if (y === 0 && x >= 2 && x < 10) return true;
    if (this.engine.game.state !== "flying" || this.engine.game.paused) this.engine.press("advance");
    return false;
  }
  reply(sequence: string, cols: number, rows: number): boolean {
    const pixels = /^\x1b\[(6|4);(\d+);(\d+)t$/.exec(sequence);
    if (pixels) {
      const window = pixels[1] === "4",
        width = window ? Math.floor(Number(pixels[3]) / cols) : Number(pixels[3]),
        height = window ? Math.floor(Number(pixels[2]) / rows) : Number(pixels[2]);
      if (width > 0 && width <= 128 && height > 0 && height <= 256) this.cell = { width, height };
      return true;
    }
    const result = /^\x1b_G([^;]+);([\s\S]*)\x1b\\$/.exec(sequence);
    if (!result) return false;
    const fields = new Map(result[1].split(",").map(field => field.split("=", 2)) as [string, string][]);
    if (fields.get("i") === String(queryId)) {
      this.supported = result[2] === "OK";
      return true;
    }
    if (fields.get("i") !== String(imageId)) return false;
    if (this.atlas) {
      this.ready = result[2] === "OK";
      this.changed();
    }
    return true;
  }
  private async prepare(cell: Cell): Promise<void> {
    const key = `${cell.width}/${cell.height}/${palette.colors.strong.join(",")}`;
    if (this.building === key || this.closed) return;
    this.building = key;
    const generation = ++this.generation,
      atlas = faces.layout(cell.width, cell.height);
    try {
      const alpha = await this.rasterize(atlas),
        png = await faces.encode(
          atlas,
          alpha,
          [...palette.colors.strong],
          4,
          raw => new Uint8Array(deflateSync(raw, { level: 9 })),
        );
      if (this.closed || generation !== this.generation) return;
      this.atlas = atlas;
      this.ready = false;
      this.writes.push(removeFace + upload(png));
      this.changed();
    } catch {
      // A failed image keeps the text passenger visible.
      if (generation === this.generation) {
        this.ready = false;
        this.changed();
      }
    }
  }
  frame(
    cols: number,
    rows: number,
    cell: Cell | null = this.cell,
    supported = this.supported,
    now = performance.now(),
  ): string {
    this.cell = cell;
    this.supported = supported;
    this.size = { cols: Math.max(72, Math.min(200, cols)), rows: Math.max(24, Math.min(70, rows)) };
    if (cell) this.options.aspect = cell.height / cell.width;
    const w = this.engine.world;
    if (
      this.engine.game.state === "title" &&
      (w.cols !== this.size.cols || w.rows !== this.size.rows || w.K !== this.options.aspect / 2)
    )
      this.engine.title();
    if (supported && cell) void this.prepare(cell);
    const dt = this.last === null ? 0 : (now - this.last) / 1000;
    this.last = now;
    let out = "\x1b[?1003h\x1b[?2026h\x1b[?25l" + clearText(cols, rows);
    if (cols < 72 || rows < 24 || cols < this.engine.world.cols || rows < this.engine.world.rows) {
      const message =
        cols < 72 || rows < 24
          ? "Moonlander needs 72 columns × 24 rows. Resize, or q to go back."
          : `Resize to ${w.cols} × ${w.rows} to continue, or r to restart.`;
      return out + `\x1b[1;1H${palette.fg("text")}${message.slice(0, cols)}\x1b[?2026l`;
    }
    this.engine.tick(dt);
    const screen = scene.render(this.engine, this.ready && supported),
      rendered = lines(screen),
      ox = Math.floor((cols - this.engine.world.cols) / 2),
      oy = Math.floor((rows - this.engine.world.rows) / 2);
    rendered.forEach((line, row) => {
      out += `\x1b[${row + oy + 1};${ox + 1}H${line}`;
    });
    out += `\x1b[1;3H${palette.fg("muted")}[ back ]`;
    if (this.ready && supported && this.atlas)
      out += place(faces.placements(this.engine, this.atlas, screen.occludes), this.atlas, ox, oy);
    return out + "\x1b[0m\x1b[?25l\x1b[?2026l";
  }
}
