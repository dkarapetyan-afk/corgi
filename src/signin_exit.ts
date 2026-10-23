import * as palette from "./palette";
import { Grid } from "./cell_grid";
import type { Surface } from "./pane/surface";
import { Writer, codepointWidth, displayWidth, clipped, ellipsis, clamp } from "./text";
import { Rect } from "./layout";

export const pull_ms = 700;
const unfold_ms = 240,
  overlap_ms = 60,
  step_ms = 1000 / 30;
export const duration_ms = pull_ms - overlap_ms + unfold_ms;

/** Cells from the native surface's normalized RGB rows, with links removed.
 * The stopped sign-in leaves no terminal or process alive for the effect. */
export function capture(surface: Surface): Grid {
  const grid = new Grid(surface.cols, surface.rows, palette.colors.text);
  surface.lines.forEach((line, y) => {
    let x = 0,
      previous = -1,
      fg = palette.colors.text,
      bg = palette.colors.bg,
      bold = false;
    for (const token of line.matchAll(/\x1b\[[\d;]*m|\x1b\][^\x1b\x07]*(?:\x07|\x1b\\)|[^\x1b]/gu)) {
      const value = token[0];
      if (value.startsWith("\x1b[")) {
        const fields = value.slice(2, -1).split(";").map(Number);
        for (let i = 0; i < fields.length; i++) {
          switch (fields[i]) {
            case 0:
              fg = palette.colors.text;
              bg = palette.colors.bg;
              bold = false;
              break;
            case 1:
              bold = true;
              break;
            case 22:
              bold = false;
              break;
            case 38:
            case 48: {
              const color: palette.Rgb = [fields[i + 2], fields[i + 3], fields[i + 4]];
              if (fields[i] === 38) fg = color;
              else bg = color;
              i += 4;
              break;
            }
          }
        }
      } else if (!value.startsWith("\x1b")) {
        const width = codepointWidth(value.codePointAt(0)!);
        if (width === 0) {
          const cell = grid.at(previous, y);
          if (cell) cell.ch += value;
        } else if (x + width <= grid.w) {
          grid.text(x, y, value, fg, bold);
          grid.fill(x, y, width, bg);
          previous = x;
          x += width;
        }
      }
    }
  });
  return grid;
}

/** Time advances on the viewer loop, never when a frame is drawn. */
export class State {
  elapsed = 0;
  constructor(
    readonly source: Grid,
    readonly started: number,
  ) {}
  tick(now: number): boolean {
    const age = Math.max(0, now - this.started),
      elapsed = age >= duration_ms ? duration_ms : Math.floor(age / step_ms) * step_ms;
    if (elapsed === this.elapsed) return false;
    this.elapsed = elapsed;
    return true;
  }
  get done(): boolean {
    return this.elapsed >= duration_ms;
  }
  fits(width: number, height: number): boolean {
    return this.source.w === width && this.source.h === height;
  }
}

/** The sign-in narrows into the check's cell; its label unfolds from there.
 * Returns what it covers: the screen while it narrows, then the toast. */
export function draw(
  w: Writer,
  account: string,
  width: number,
  height: number,
  exit: State | null = null,
): Rect | null {
  if (!account || width < 20 || height < 5) return null;
  const label = ellipsis(`Added ${account}`, width - 10),
    full = displayWidth(label) + 6,
    x = Math.floor((width - full) / 2),
    tx = x + 2,
    ty = 2,
    moving = exit?.fits(width, height) ? exit : null,
    elapsed = moving?.elapsed ?? duration_ms,
    p = clamp(elapsed / pull_ms, 0, 1),
    background = new palette.Style({ bg: "bg" }).sgr();
  w.write("\x1b7");
  if (moving && p === 0) {
    moving.source.write(w, 0, 0, background);
    w.write("\x1b[0m\x1b8");
    return new Rect(0, 0, width, height);
  }
  if (moving && p < 1) {
    const bands = new Map<number, { sy: number; left: number; right: number; horizontal: number }>();
    for (let sy = height - 1; sy >= 0; sy--) {
      const near = 1 - sy / (height - 1),
        local = clamp(p + near * 0.24 * Math.sin(p * Math.PI), 0, 1),
        horizontal = (1 - local) ** 1.5,
        dy = Math.round(ty + (sy - ty) * (1 - local ** 1.75)),
        left = Math.round(tx - tx * horizontal),
        right = Math.round(tx + (width - 1 - tx) * horizontal);
      if (right - left >= 2) bands.set(dy, { sy, left, right, horizontal });
    }
    const edge = palette.mix(palette.colors.line, palette.colors.accent, Math.max(0, (p - 0.45) * 50));
    for (const [dy, { sy, left, right, horizontal }] of bands) {
      const row = new Grid(right - left + 1, 1, palette.colors.text);
      for (let sx = 1; sx < width - 1; sx++) {
        const cell = moving.source.rows[sy][sx];
        if (!cell.ch || cell.ch === " ") continue;
        if (horizontal < 0.55 && (sx + sy) % Math.ceil(1 / Math.max(horizontal, 0.1))) continue;
        const dx = Math.round(tx + (sx - tx) * horizontal) - left,
          size = codepointWidth(cell.ch.codePointAt(0)!);
        if (dx < 1 || dx + size >= row.w) continue;
        const fg = palette.mix(cell.fg, palette.colors.faint, p * 65);
        row.put(dx, 0, cell.ch, fg, cell.bold);
        if (size === 2) row.put(dx + 1, 0, "", fg, cell.bold);
        if (cell.bg) row.fill(dx, 0, size, palette.mix(cell.bg, palette.colors.bg, p * 100));
      }
      row.put(0, 0, "│", edge);
      row.put(row.w - 1, 0, "│", edge);
      if (sy === 0 || sy === height - 1) {
        row.text(1, 0, "─".repeat(row.w - 2), edge);
        row.put(0, 0, sy === 0 ? "╭" : "╰", edge);
        row.put(row.w - 1, 0, sy === 0 ? "╮" : "╯", edge);
      }
      row.write(w, left, dy, background);
    }
    if (p > 0.66) {
      const q = (p - 0.66) / 0.34;
      w.write(
        `\x1b[${ty + 1};${tx + 1}H` +
          palette.bg("surface") +
          palette.fgRgb(palette.mix(palette.colors.faint, palette.colors.accent, q * 100)) +
          (q > 0.62 ? "✓" : q > 0.25 ? "·" : "◌"),
      );
    }
  }
  if (elapsed >= pull_ms - overlap_ms) {
    const progress = clamp((elapsed - (pull_ms - overlap_ms)) / unfold_ms, 0, 1),
      size = Math.max(5, Math.round(5 + (full - 5) * (1 - (1 - progress) ** 3))),
      row = new Grid(size, 3, palette.colors.line);
    for (let y = 0; y < 3; y++) row.fill(0, y, size, palette.colors.surface);
    row.text(0, 0, "╭" + "─".repeat(size - 2) + "╮", palette.colors.line);
    row.text(0, 2, "╰" + "─".repeat(size - 2) + "╯", palette.colors.line);
    row.put(0, 1, "│", palette.colors.line);
    row.put(size - 1, 1, "│", palette.colors.line);
    row.put(2, 1, "✓", palette.colors.accent, true);
    if (size > 6) row.text(4, 1, clipped(label, size - 6), palette.colors.strong, true);
    row.write(w, x, 1, new palette.Style({ bg: "surface" }).sgr());
  }
  w.write("\x1b[0m\x1b8");
  return moving && p < 1 ? new Rect(0, 0, width, height) : new Rect(x, 1, full, 3);
}
