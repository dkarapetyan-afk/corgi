//! A short slide between two terminal cards, with one frame changing height.
import { Rect } from "./layout";
import * as palette from "./palette";
import { Writer, codepointWidth } from "./text";

export const duration_ms = 260;
type Cell = { text: string; style: string; width: number };
export type Frame = { box: Rect; cells: (Cell | null)[][] };

/** Capture the CUP/SGR output our cards draw; no terminal or native surface. */
export function capture(text: string, box: Rect): Frame {
  const cells: Frame["cells"] = Array.from({ length: box.h }, () => Array(box.w).fill(null));
  let x = 0,
    y = 0,
    style = "\x1b[0m";
  for (const part of text.matchAll(/\x1b\[[0-?]*[ -/]*[@-~]|[^\x1b]+/g)) {
    const value = part[0];
    if (value.startsWith("\x1b[")) {
      const fields = value.slice(2, -1);
      switch (value.at(-1)) {
        case "H": {
          const [row = 1, col = 1] = fields.split(";").map(Number);
          x = col - 1 - box.x;
          y = row - 1 - box.y;
          break;
        }
        case "m":
          style = fields === "" || fields === "0" || fields.startsWith("0;") ? value : style + value;
          break;
      }
      continue;
    }
    for (const ch of value) {
      const width = codepointWidth(ch.codePointAt(0)!);
      if (width === 0) {
        const previous = cells[y]?.[x - 1] ?? cells[y]?.[x - 2];
        if (previous) previous.text += ch;
        continue;
      }
      if (cells[y] && x >= 0 && x + width <= box.w) {
        cells[y][x] = { text: ch, style, width };
        if (width === 2) cells[y][x + 1] = null;
      }
      x += width;
    }
  }
  return { box, cells };
}

export class Slide {
  private last: Frame | null = null;
  private from: Frame | null = null;
  private started = 0;
  private progress = 1;
  private direction = 1;
  private size = "";

  start(direction: number, now: number): void {
    this.from = this.last;
    this.started = now;
    this.progress = this.from ? 0 : 1;
    this.direction = direction;
  }
  get active(): boolean {
    return this.from !== null;
  }
  /** Only the input clock advances the slide; repeated draws are identical. */
  tick(now: number): boolean {
    if (!this.from) return false;
    this.progress = Math.min(1, Math.max(0, (now - this.started) / duration_ms));
    if (this.progress === 1) this.from = null;
    return true;
  }
  draw(w: Writer, text: string, box: Rect, cols: number, rows: number): void {
    const size = `${cols}:${rows}`;
    if (size !== this.size) this.from = null;
    this.size = size;
    const target = capture(text, box),
      from = this.from;
    if (!from || from.box.w !== box.w) {
      this.from = null;
      this.last = target;
      w.write(text);
      return;
    }
    const t = 1 - (1 - this.progress) ** 3,
      mix = (a: number, b: number) => Math.round(a + (b - a) * t),
      frame = new Rect(mix(from.box.x, box.x), mix(from.box.y, box.y), box.w, mix(from.box.h, box.h)),
      width = box.w - 2,
      distance = Math.round(width * t),
      offsets = this.direction > 0 ? [-distance, width - distance] : [distance, distance - width],
      surface = new palette.Style({ fg: "text", bg: "surface" }).sgr(),
      border = new palette.Style({ fg: "line", bg: "surface" }).sgr(),
      painted: Frame = { box: frame, cells: [] };
    for (let y = 0; y < frame.h; y++) {
      const line: (Cell | null)[] = Array.from({ length: frame.w }, () => ({ text: " ", style: surface, width: 1 }));
      const edge = y === 0 || y === frame.h - 1;
      if (edge) {
        for (const cell of line) {
          cell!.text = "─";
          cell!.style = border;
        }
      }
      line[0] = { text: y === 0 ? "╭" : edge ? "╰" : "│", style: border, width: 1 };
      line[frame.w - 1] = { text: y === 0 ? "╮" : edge ? "╯" : "│", style: border, width: 1 };
      if (y < frame.h - 1) {
        for (const [i, source] of [from, target].entries()) {
          if (y >= source.box.h - 1) continue;
          for (let x = 1; x < source.box.w - 1; x++) {
            const cell = source.cells[y]?.[x],
              dest = x + offsets[i];
            if (!cell || dest < 1 || dest + cell.width > frame.w - 1) continue;
            line[dest] = cell;
            if (cell.width === 2) line[dest + 1] = null;
          }
        }
      }
      painted.cells.push(line);
      w.write(`\x1b[${frame.y + y + 1};${frame.x + 1}H`);
      let style = "";
      for (const cell of line) {
        if (!cell) continue;
        if (cell.style !== style) w.write((style = cell.style));
        w.write(cell.text);
      }
    }
    // A small highlight follows the seam along the bottom edge.
    const seam = this.direction > 0 ? width - distance : distance;
    if (seam > 0 && seam < width) {
      const glow = palette.fgRgb(palette.mix(palette.colors.line, palette.colors.accent, 65));
      w.write(`\x1b[${frame.y + frame.h};${frame.x + seam + 1}H${border}${glow}━`);
    }
    w.write("\x1b[0m\x1b[?25l");
    this.last = painted;
  }
}
