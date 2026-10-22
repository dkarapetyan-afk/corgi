//! Compact, single-line usage and reset groups for the agent picker.
//! Mirrors launcher_usage.zig.
import { fg } from "./palette";
import { Writer, displayWidth, writeEllipsis, asciiText, truncatedText, sat } from "./text";
import * as spend from "./usage/spend";

const text_capacity = 160;
/** "  6%" through "100%". */
const percent_width = 4;
const separator = " │ ";

export interface LimitWindow {
  minutes: number | null;
  used: number;
  reset_at: number | null;
}
export function windowLabel(w: LimitWindow): string {
  const n = w.minutes;
  if (n === null || n === undefined || n <= 0) return "Window";
  if (n % 1440 === 0) return `${n / 1440}d`;
  if (n % 60 === 0) return `${n / 60}h`;
  return `${n}m`;
}
export function countdown(w: LimitWindow, now: number): string | null {
  if (w.reset_at === null || w.reset_at === undefined) return null;
  return resetCountdown(w.reset_at, now);
}
function resetCountdown(at: number, now: number): string {
  const seconds = at - now;
  if (seconds <= 0) return "now";
  const minutes = Math.trunc(seconds / 60) + (seconds % 60 > 0 ? 1 : 0);
  const days = Math.trunc(minutes / 1440);
  const hours = Math.trunc(minutes / 60) % 24;
  const mins = minutes % 60;
  if (days > 0) {
    if (hours > 0) return `${days}d ${hours}h`;
    if (mins > 0) return `${days}d ${mins}m`;
    return `${days}d`;
  }
  if (hours > 0) {
    if (mins > 0) return `${hours}h ${mins}m`;
    return `${hours}h`;
  }
  return `${minutes}m`;
}
export const usage_max_age = 10 * 60;
/** Whether a reading fetched at `fetched_at` is too old to show. */
export function expired(fetched_at: number, now: number): boolean {
  return fetched_at <= 0 || now - fetched_at >= usage_max_age;
}

interface CellWindow {
  label: string;
  used: number | null;
  figure: string;
  reset: string;
}
export class Cell {
  /** By slot, so one provider's weekly limit sits under another's. */
  windows: [CellWindow | null, CellWindow | null] = [null, null];
  spend: CellWindow | null = null;
  fallback = "";

  static init(windows: [LimitWindow | null, LimitWindow | null], now: number): Cell {
    const cell = new Cell();
    windows.forEach((window, i) => {
      if (!window) return;
      cell.windows[i] = {
        label: asciiText(windowLabel(window), text_capacity),
        used: window.used,
        figure: `${window.used}%`,
        reset: asciiText(countdown(window, now) ?? "unknown", text_capacity),
      };
    });
    return cell;
  }
  static monthly(reading: spend.Reading, now: number): Cell {
    const cell = new Cell();
    cell.spend = {
      label: "1M",
      used: spend.percent(reading),
      figure: spend.amounts(reading),
      reset: resetCountdown(reading.reset_at, now),
    };
    return cell;
  }
  /** Not `ascii`, which would blank the "…" and "—" in statuses. */
  static status(text: string): Cell {
    const cell = new Cell();
    cell.fallback = truncatedText(text, text_capacity);
    return cell;
  }
  static unavailable(reason: string): Cell {
    const cell = new Cell();
    cell.fallback = truncatedText(`Unavailable · ${reason}`, text_capacity);
    return cell;
  }
  limited(): boolean {
    return this.spend !== null || this.windows[0] !== null || this.windows[1] !== null;
  }
  /** `selected` rows need brighter grays: faint text and empty cells vanish on them. */
  write(w: Writer, grid: Grid, width: number, row_style: string, selected: boolean): void {
    if (!this.limited()) return writeEllipsis(w, this.fallback, width);
    const slots = this.spend ? [grid.spend, null] : grid.slots;
    const windows = this.spend ? [this.spend, null] : this.windows;
    if (width < grid.groupsWidth(0) || !grid.holds(this)) {
      // At exceptionally small widths, clip text before adding any SGR.
      let plain = "";
      slots.forEach((slot, i) => {
        if (!slot) return;
        if (i > 0 && slots[0] !== null) plain += separator;
        const window = windows[i];
        if (!window) {
          plain += " ".repeat(slotWidth(slot, 0));
          return;
        }
        plain += padded(window.label, slot.label);
        plain += ` ${window.figure.padStart(slot.figure)} · `;
        plain += padded(window.reset, slot.reset);
      });
      writeEllipsis(w, plain.replace(/ +$/, ""), width);
      return;
    }
    const bar_width = grid.barWidth(width);
    const empty = selected ? fg("line") : fg("selected");
    const quiet = selected ? fg("muted") : fg("faint");
    slots.forEach((slot, i) => {
      if (!slot) return;
      if (i > 0 && slots[0] !== null) w.write(fg("line") + separator + row_style);
      const window = windows[i];
      if (!window) {
        w.splat(" ", slotWidth(slot, bar_width));
        return;
      }
      w.write(row_style + fg("muted"));
      w.write(padded(window.label, slot.label));
      w.write(`${row_style} `);
      const used = window.used ?? 0;
      const color = used >= 100 ? fg("hot") : used >= 80 ? fg("warm") : fg("accent");
      if (bar_width > 0) {
        if (window.used === null) w.splat(" ", bar_width);
        else writeBar(w, used, bar_width, color, empty);
        w.write(`${row_style} `);
      }
      w.write(
        `\x1b[1m${used >= 80 ? color : fg("strong")}${window.figure.padStart(slot.figure)}${row_style}` +
          fg("line") +
          ` · ${quiet}`,
      );
      w.write(padded(window.reset, slot.reset));
      w.write(row_style);
    });
  }
}
export function writeBar(w: Writer, used: number, width: number, filled_ink: string, empty_ink: string) {
  const filled = Math.round((width * Math.max(0, Math.min(100, used))) / 100);
  w.write(filled_ink + "━".repeat(filled) + empty_ink + "━".repeat(width - filled));
}
interface Slot {
  label: number;
  figure: number;
  reset: number;
}
function slotWidth(slot: Slot, bar: number): number {
  return slot.label + 1 + (bar > 0 ? bar + 1 : 0) + slot.figure + 3 + slot.reset;
}
/** Column widths shared by every row's groups, so they line up as a grid. */
export class Grid {
  /** Null where no row has that window. */
  slots: [Slot | null, Slot | null] = [null, null];
  /** Monthly money spans the whole cell, without widening the quota slots. */
  spend: Slot | null = null;
  /** The widest status, such as "Track usage", shown instead of groups. */
  status = 0;
  add(cell: Cell): void {
    if (!cell.limited()) this.status = Math.max(this.status, displayWidth(cell.fallback));
    if (cell.spend) this.spend = widen(this.spend, cell.spend);
    cell.windows.forEach((window, i) => {
      if (!window) return;
      this.slots[i] = widen(this.slots[i], window);
    });
  }
  minimumWidth(): number {
    return Math.max(this.status, this.groupsWidth(0));
  }
  preferredWidth(): number {
    return Math.max(this.status, this.groupsWidth(6));
  }
  groupsWidth(bar: number): number {
    let size = 0;
    for (const slot of this.slots) {
      if (!slot) continue;
      if (size > 0) size += displayWidth(separator);
      size += slotWidth(slot, bar);
    }
    return Math.max(size, this.spend ? slotWidth(this.spend, bar) : 0);
  }
  /** The same in every row: up to six cells, then none once a group would
   * get fewer than two. */
  barWidth(width: number): number {
    for (let bar = 6; bar >= 2; bar--) if (this.groupsWidth(bar) <= width) return bar;
    return 0;
  }
  /** Whether `cell` was among the rows the grid was sized for. */
  holds(cell: Cell): boolean {
    const wider = new Grid();
    wider.slots = [this.slots[0] && { ...this.slots[0] }, this.slots[1] && { ...this.slots[1] }];
    wider.spend = this.spend && { ...this.spend };
    wider.status = this.status;
    wider.add(cell);
    return JSON.stringify([wider.slots, wider.spend]) === JSON.stringify([this.slots, this.spend]);
  }
}
function widen(slot: Slot | null, window: CellWindow): Slot {
  return {
    label: Math.max(slot?.label ?? 0, displayWidth(window.label)),
    figure: Math.max(slot?.figure ?? percent_width, displayWidth(window.figure)),
    reset: Math.max(slot?.reset ?? 0, displayWidth(window.reset)),
  };
}
function padded(text: string, width: number): string {
  return text + " ".repeat(sat(width, displayWidth(text)));
}
