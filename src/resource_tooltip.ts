//! Viewer-local resource card: framed graphs and a stable mini top. On a host
//! with GPUs the card is taller, with a row for GPU graphs (drawn while the
//! workspace uses one) and GPU columns, so its layout doesn't follow usage.
//! Mirrors resource_tooltip.zig.
import { Style, derived, colors, mix, fgRgb } from "./palette";
import { Provider, adapter } from "./providers";
import { Rect } from "./layout";
import { cpuText, ioText, history_bucket_ms, type Sort } from "./trackers/resources";
import { Writer, displayWidth, writeClipped, directoryLabel, sat, zigRound } from "./text";

// Each write sets a whole style, so bold never leaks into the next.
let text: string,
  faint: string,
  rule: string,
  strong: string,
  warm: string,
  live: string,
  past: string,
  well: string,
  cursor: string,
  spot: string,
  lit: string,
  track: string;
derived(() => {
  text = new Style({ fg: "text", bg: "bg" }).sgr();
  faint = new Style({ fg: "faint", bg: "bg" }).sgr();
  rule = new Style({ fg: "line", bg: "bg" }).sgr();
  // Titles, headings, and the figures the table sorts by.
  strong = new Style({ fg: "strong", bg: "bg", bold: true }).sgr();
  warm = new Style({ fg: "warm", bg: "bg" }).sgr();
  // Graph cells: live data, like the limit sparks.
  live = new Style({ fg: "accent", bg: "bg" }).sgr();
  // A figure from the history under the pointer rather than now.
  past = new Style({ fg: "accent", bg: "bg", bold: true }).sgr();
  // Backgrounds for heatmap cells, colored per cell: its well, set apart from
  // the device list beside it, the column under the pointer, and the cell.
  well = new Style({ bg: "surface" }).sgr();
  cursor = new Style({ bg: "selected" }).sgr();
  spot = new Style({ bg: "line" }).sgr();
  lit = new Style({ fg: "accent", bg: "selected" }).sgr();
  // A device's meter now, on its empty cell.
  track = new Style({ fg: "accent", bg: "selected" }).sgr();
});

export type { Sort };

/** How many GPUs the snapshot's host has, which sets the card's layout. */
export function gpuCount(snapshot: any): number {
  return snapshot?.gpus?.length ?? 0;
}
/** On a host with `gpus`, the card is taller for a row of GPU graphs where the terminal has room. */
export function geometry(cols: number, rows: number, side: number, anchor: number, gpus = 0): Rect | null {
  if (cols < 68 || rows < 22) return null;
  const w = Math.min(82, cols - 2);
  const h = Math.min(gpus ? 24 + gpuBox(gpus) + 1 : 24, rows - 2);
  return new Rect(Math.min(side, cols - w - 1), Math.min(anchor, rows - h - 1), w, h);
}
/** The GPU graphs' height: the total, then a line per device, from the other
 * graphs' height up to eight devices. */
function gpuBox(gpus: number): number {
  return Math.min(11, Math.max(7, gpus + 3));
}
/** How far the GPU graphs push the rest down: none in a card too short for them. */
function gpuShift(rect: Rect, gpus: number): number {
  const row = gpuBox(gpus) + 1;
  return gpus && rect.h >= 22 + row ? row : 0;
}
/** The GPU graphs' column for the total and its devices, left of the history,
 * and the blank columns that keep its figures from reading as the history's. */
const tree_width = 11,
  tree_gap = 4;
interface Graph {
  metric: Sort;
  box: Rect;
  /** The cells that chart its history. */
  chart: Rect;
}
function graphs(rect: Rect, gpus: number): Graph[] {
  const shift = gpuShift(rect, gpus),
    rows: Sort[][] = [["cpu", "memory", "io"], ...(shift ? [["gpu", "gpu_memory"] as Sort[]] : [])];
  return rows.flatMap((metrics, row) => {
    const gw = Math.floor((rect.w - 4 - (metrics.length - 1)) / metrics.length);
    return metrics.map(metric => {
      const i = metrics.indexOf(metric),
        box = new Rect(rect.x + 2 + i * (gw + 1), rect.y + 3 + row * 8, gw, row ? gpuBox(gpus) : 7),
        // GPU history fills the box beside the tree; the rest sits under the figure.
        chart = row
          ? new Rect(box.x + 2 + tree_width + tree_gap, box.y + 1, box.w - 4 - tree_width - tree_gap, box.h - 2)
          : new Rect(box.x + 2, box.y + 3, box.w - 4, box.h - 4);
      return { metric, box, chart };
    });
  });
}
/** The graph whose history the pointer is over, how many points back from the
 * newest, and on a GPU heatmap the line under it, from 0 at the foot. */
export function hoverAt(
  rect: Rect,
  gpus: number,
  x: number,
  y: number,
): { metric: Sort; age: number; line: number | null } | null {
  for (const { metric, box, chart } of graphs(rect, gpus))
    if (x >= chart.x && x < chart.x + chart.w && y > box.y && y < box.y + box.h - 1)
      return {
        metric,
        age: chart.x + chart.w - 1 - x,
        line: metric === "gpu" || metric === "gpu_memory" ? chart.y + chart.h - 1 - y : null,
      };
  return null;
}
/** Where the pointer left the resource row on its way to the card, and when it
 * last moved inside the aim triangle. */
export interface Aim {
  x: number;
  y: number;
  at: number;
}
/** A pointer resting this long short of the card has stopped aiming for it. */
export { aim_ms, aimed } from "./menu_aim";
export interface Process {
  pid: number;
  start: bigint;
  name: string;
  provider?: Provider | null;
  cpu?: number | null;
  memory?: bigint;
  read?: bigint | null;
  written?: bigint | null;
  gpu?: number | null;
  gpu_memory?: bigint | null;
  gpu_devices?: { index: number; util: number | null; memory: bigint | null }[];
}
function metricValue(sort: Sort, p: Process): number | null {
  switch (sort) {
    case "cpu":
      return p.cpu ?? null;
    case "memory":
      return Number(p.memory ?? 0);
    case "io":
      return p.read != null && p.written != null ? Number(p.read) + Number(p.written) : null;
    case "gpu":
      return p.gpu ?? null;
    case "gpu_memory":
      return p.gpu_memory == null ? null : Number(p.gpu_memory);
  }
}
/** The most first, or the least when `ascending`; unsampled processes last either way. */
export function less(sort: Sort, left: Process, right: Process, ascending = false): boolean {
  const l = metricValue(sort, left);
  const r = metricValue(sort, right);
  if (l === r) return left.pid < right.pid;
  if (l === null || r === null) return r === null;
  return ascending ? l < r : l > r;
}
const process_capacity = 64;
interface Key {
  pid: number;
  start: string;
}
export class State {
  workspace: number | null = null;
  anchor = 0;
  sort: Sort = "cpu";
  ascending = false;
  order: Key[] = [];
  count = 0;
  frozen = false;
  /** The host's GPUs, which give the card their graphs and columns. */
  gpus = 0;
  constructor(fields: Partial<State> = {}) {
    Object.assign(this, fields);
  }
  update(work: { id: number; processes?: Process[] }, freeze: boolean, gpus = 0): void {
    if (this.workspace !== work.id || (!gpus && (this.sort === "gpu" || this.sort === "gpu_memory"))) {
      this.workspace = work.id;
      this.count = 0;
      this.sort = "cpu";
      this.ascending = false;
      this.frozen = false;
    }
    if (gpus !== this.gpus) this.frozen = false;
    this.gpus = gpus;
    if (freeze && this.frozen && this.count > 0) return;
    const list = (work.processes ?? []).slice(0, process_capacity);
    // std.mem.sort is stable, as Array.sort is.
    const sort = this.sort,
      ascending = this.ascending;
    list.sort((a, b) => (less(sort, a, b, ascending) ? -1 : less(sort, b, a, ascending) ? 1 : 0));
    this.order = list.map(p => ({ pid: p.pid, start: String(p.start) }));
    this.count = list.length;
    this.frozen = freeze;
  }
  /** Sorts by the heading under a cell, the most first; the sorted heading turns it around. */
  click(rect: Rect, x: number, y: number): void {
    const sort = sortAt(rect, x, y, this.gpus);
    if (sort === null) return;
    this.ascending = sort === this.sort && !this.ascending;
    this.sort = sort;
    this.frozen = false;
  }
}
interface Column {
  sort: Sort;
  field: Field;
  label: string;
  width: number;
  /** Its left edge, counted back from the card's right one. */
  x: number;
}
/** The table's figures, right to left from the border, one column apart. */
function columns(gpu: boolean, memory_kind: string): Column[] {
  const list: Omit<Column, "x">[] = [
    { sort: "cpu", field: "cpu", label: "CPU %", width: 7 },
    { sort: "memory", field: "memory", label: "GiB", width: 6 },
    ...(gpu
      ? ([
          { sort: "gpu", field: "gpu", label: "GPU %", width: 7 },
          { sort: "gpu_memory", field: "gpu_memory", label: memory_kind || "GPU GiB", width: 7 },
        ] as const)
      : []),
    { sort: "io", field: "read", label: "R MB/s", width: 7 },
    { sort: "io", field: "written", label: "W MB/s", width: 7 },
  ];
  let x = 1;
  return list
    .reverse()
    .map(c => ({ ...c, x: (x += c.width + 1) }))
    .reverse();
}
/** The sortable column header under a cell, from "CPU %" through "W MB/s".
 * Both disk columns sort by I/O. */
export function sortAt(rect: Rect, x: number, y: number, gpus = 0): Sort | null {
  if (y !== rect.y + 14 + gpuShift(rect, gpus)) return null;
  const column = columns(gpus > 0, "").find(c => x >= rect.x + rect.w - c.x && x < rect.x + rect.w - c.x + c.width + 1);
  return column && x < rect.x + rect.w - 2 ? column.sort : null;
}

type Field = Exclude<Sort, "io"> | "read" | "written";
function cell(p: Process, field: Field): string {
  switch (field) {
    case "cpu":
      return p.cpu != null ? fixed(p.cpu, 1) : "";
    case "memory":
      return fixed(Number(p.memory ?? 0) / (1024 * 1024 * 1024), 2);
    case "gpu":
      return p.gpu != null ? fixed(p.gpu, 1) : "";
    case "gpu_memory":
      return p.gpu_memory != null ? fixed(Number(p.gpu_memory) / (1024 * 1024 * 1024), 2) : "";
    case "read":
      return p.read != null ? fixed(Number(p.read) / 1000000, 1) : "";
    case "written":
      return p.written != null ? fixed(Number(p.written) / 1000000, 1) : "";
  }
}
function at(w: Writer, x: number, y: number, color: string, value: string, width: number): void {
  w.write(`\x1b[${y + 1};${x + 1}H${color}`);
  if (value.length === 0) return;
  writeClipped(w, directoryLabel(value, null, 512), width);
}
function right(w: Writer, x: number, y: number, color: string, value: string, width: number): void {
  at(w, x + sat(width, Math.min(width, displayWidth(value))), y, color, value, width);
}
function box(w: Writer, rect: Rect, title: string, title_color: string): void {
  at(w, rect.x, rect.y, rule, "┌", 1);
  w.write("─".repeat(rect.w - 2));
  w.write("┐");
  for (let row = 1; row < rect.h - 1; row++) {
    at(w, rect.x, rect.y + row, rule, "│", 1);
    at(w, rect.x + rect.w - 1, rect.y + row, rule, "│", 1);
  }
  at(w, rect.x, rect.y + rect.h - 1, rule, "└", 1);
  w.write("─".repeat(rect.w - 2));
  w.write("┘");
  at(w, rect.x + 2, rect.y, title_color, title, rect.w - 4);
}
/** Zig's `{d:.N}` for a float. */
export function fixed(value: number, digits: number): string {
  return value.toFixed(digits);
}
const u64 = (value: unknown): bigint | null => (value === null || value === undefined ? null : BigInt(value as number));
const gib = (value: unknown) => `${fixed(Number(value) / (1024 * 1024 * 1024), 2)} GiB`;
/** Device indices as runs: "0-3,6". */
export function devicesText(devices: number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < devices.length;) {
    let j = i;
    while (j + 1 < devices.length && devices[j + 1] === devices[j] + 1) j++;
    runs.push(j > i ? `${devices[i]}-${devices[j]}` : `${devices[i]}`);
    i = j + 1;
  }
  return runs.join(",");
}
function graphTitle(metric: Sort, work: any, memory_kind: string): string {
  switch (metric) {
    case "cpu":
      return " cpu ";
    case "memory":
      return " memory ";
    case "io":
      return " disk I/O ";
    case "gpu": {
      const devices: number[] = (work.gpu_devices ?? []).map((d: any) => d.index);
      return devices.length ? ` gpu ${devicesText(devices)} ` : " gpu ";
    }
    case "gpu_memory":
      return ` ${(memory_kind || "gpu memory").toLowerCase()} `;
  }
}
/** The history point `age` back from the newest, or none for now. */
function pointAt(work: any, age: number | null): any {
  return age === null ? null : ((work.history ?? []).at(-1 - age) ?? null);
}
/** How long `ms` is, to the second or the minute. */
function spanText(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
}
function graph(
  w: Writer,
  g: Graph,
  work: any,
  memory_kind: string,
  gpus: any[],
  age: number | null,
  line: number | null,
): void {
  const { metric, box: rect, chart } = g;
  if (metric === "gpu" || metric === "gpu_memory") return gpuGraph(w, g, work, metric, memory_kind, gpus, age, line);
  const read = u64(work.read);
  const written = u64(work.written);
  const total = read !== null && written !== null ? read + written : null;
  const shown = (source: any, io: bigint | null) => {
    switch (metric) {
      case "cpu":
        return cpuText(source.cpu ?? null);
      case "memory":
        return source.memory != null ? gib(source.memory) : "";
      case "io":
        return ioText(io);
    }
  };
  if (shown(work, total).length === 0) return;
  box(w, rect, graphTitle(metric, work, memory_kind), faint);
  const point = pointAt(work, age);
  at(
    w,
    rect.x + 2,
    rect.y + 1,
    point ? past : strong,
    point ? shown(point, u64(point.io)) : shown(work, total),
    rect.w - 4,
  );
  const all: any[] = work.history ?? [];
  const history = all.slice(all.length - Math.min(chart.w, all.length));
  let ceiling = metric === "cpu" ? 100 : 1;
  for (const point of history) {
    const v = sample(point, metric);
    if (v !== null) ceiling = Math.max(ceiling, v);
  }
  const rows = chart.h;
  history.forEach((point, i) => {
    const v = sample(point, metric),
      here = age !== null && i === history.length - 1 - age;
    const eighths = v === null ? 0 : zigRound((v / ceiling) * (rows * 8));
    for (let row = 0; row < rows; row++) {
      const fill = Math.min(8, sat(eighths, row * 8));
      if (v === null && !here) continue;
      at(w, chart.x + chart.w - history.length + i, chart.y + rows - 1 - row, here ? lit : live, glyphs[fill], 1);
    }
  });
}
function sample(point: any, metric: Sort): number | null {
  switch (metric) {
    case "cpu":
      return point.cpu ?? null;
    case "memory":
      return point.memory == null ? null : Number(point.memory);
    case "io":
      return point.io == null ? null : Number(point.io);
    case "gpu":
    case "gpu_memory":
      return null;
  }
}
const glyphs = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
/** A cell holding `share` of the devices: lighter in glyph and color the fewer. */
const shades = ["░", "▒", "▓", "█"];
function density(share: number): string {
  return fgRgb(mix(colors.bg, colors.accent, zigRound((0.25 + 0.75 * share) * 100)));
}
/** A GPU graph's figure on one device, and the ceiling its heatmap scales to: one device full. */
function gpuScale(metric: "gpu" | "gpu_memory", gpus: any[]) {
  const util = metric === "gpu";
  return {
    value: (s: any): number | null => (util ? (s.util ?? null) : s.memory == null ? null : Number(s.memory)),
    ceiling: util ? 100 : Math.max(1, ...gpus.map(d => Number(d.total ?? 0))),
  };
}
/** The heatmap line a device's figure reaches, from 0 at the foot, or none at zero. */
function lineOf(v: number | null, ceiling: number, rows: number): number | null {
  const eighths = v === null ? 0 : zigRound((v / ceiling) * rows * 8);
  return eighths ? Math.min(rows, Math.ceil(eighths / 8)) - 1 : null;
}
/** The devices on heatmap `line` of GPU graph `g` at history point `point`. */
function devicesOn(point: any, g: Graph, line: number, gpus: any[]): number[] {
  const { value, ceiling } = gpuScale(g.metric as "gpu" | "gpu_memory", gpus);
  return (point.gpus ?? []).filter((s: any) => lineOf(value(s), ceiling, g.chart.h) === line).map((s: any) => s.index);
}
/** The workspace's total, then a tree of its devices with meters and
 * figures, beside a heatmap of its history in a well of its own: each cell
 * as dense as the share of devices at its level. The dashed border over it is
 * the ceiling: one device full. Under the pointer, the figures are the
 * history's at that point, and the cell at `line` is lit. */
function gpuGraph(
  w: Writer,
  g: Graph,
  work: any,
  metric: "gpu" | "gpu_memory",
  memory_kind: string,
  gpus: any[],
  age: number | null,
  line: number | null,
) {
  const { box: rect, chart } = g,
    util = metric === "gpu";
  box(w, rect, graphTitle(metric, work, memory_kind), faint);
  if (!work.gpu_shown) {
    at(w, rect.x + 2, rect.y + 1, faint, "no use", rect.w - 4);
    return;
  }
  const point = pointAt(work, age),
    shares: any[] = point ? (point.gpus ?? []) : (work.gpu_devices ?? []),
    capacity = (index: number) => Number(gpus.find(d => d.index === index)?.total ?? 0),
    { value, ceiling } = gpuScale(metric, gpus),
    figure = (s: any) => {
      const v = value(s);
      if (v === null) return "";
      if (util) return `${zigRound(v)}%`;
      const size = v / 1024 ** 3;
      return size >= 100 ? `${zigRound(size)}G` : `${fixed(size, 1)}G`;
    },
    known = shares.filter(s => value(s) !== null),
    sum = known.reduce((total, s) => total + value(s)!, 0),
    headline = !known.length ? "" : util ? cpuText(sum) : gib(sum);
  at(w, rect.x + 2, rect.y + 1, point ? past : strong, headline, tree_width);
  // A meter `span` lines tall, filled from its foot.
  const meter = (x: number, foot: number, span: number, s: any) => {
    const v = value(s),
      fraction = v === null ? 0 : util ? v / 100 : v / Math.max(1, capacity(s.index)),
      eighths = v === null ? 0 : Math.max(1, zigRound(fraction * span * 8));
    for (let r = 0; r < span; r++) at(w, x, foot - r, track, glyphs[Math.min(8, sat(eighths, r * 8))], 1);
  };
  const x0 = rect.x + 2,
    lines = rect.h - 3;
  if (shares.length <= lines) {
    // One device a line, its meter taller for lines to spare.
    const span = Math.max(1, Math.floor(lines / Math.max(1, shares.length)));
    shares.forEach((s, d) => {
      const foot = rect.y + 2 + d * span + span - 1,
        label = `${s.index}`,
        mx = x0 + 3 + label.length;
      for (let y = foot - span + 1; y < foot; y++) at(w, x0, y, rule, "│", 1);
      at(w, x0, foot, rule, d === shares.length - 1 ? "└" : "├", 1);
      at(w, x0 + 2, foot, faint, label, label.length);
      meter(mx, foot, span, s);
      at(w, mx + 2, foot, text, figure(s), sat(x0 + tree_width, mx + 2));
    });
  } else {
    // More devices than lines: numbered meters shared out over the lines, cut
    // short where a line runs out of room.
    const per = Math.ceil(shares.length / lines),
      used = Math.ceil(shares.length / per);
    for (let line = 0; line < used; line++) {
      const y = rect.y + 2 + line;
      at(w, x0, y, rule, line === used - 1 ? "└" : "├", 1);
      let x = x0 + 2;
      for (const s of shares.slice(line * per, (line + 1) * per)) {
        const label = `${s.index}`;
        if (x + label.length + 1 > x0 + tree_width) {
          at(w, x0 + tree_width - 1, y, faint, "…", 1);
          break;
        }
        at(w, x, y, faint, label, label.length);
        meter(x + label.length, y, 1, s);
        x += label.length + 2;
      }
    }
  }
  const all: any[] = work.history ?? [],
    history = all.slice(all.length - Math.min(chart.w, all.length)),
    rows = chart.h;
  for (let y = chart.y; y < chart.y + rows; y++) {
    w.write(`\x1b[${y + 1};${chart.x + 1}H${well}`);
    w.splat(" ", chart.w);
  }
  history.forEach((p, i) => {
    const x = chart.x + chart.w - history.length + i,
      here = age !== null && i === history.length - 1 - age,
      base = here ? cursor : well,
      levels = (p.gpus ?? []).map((d: any) => lineOf(value(d), ceiling, rows));
    for (let r = 0; r < rows; r++) {
      const y = chart.y + rows - 1 - r,
        share = levels.filter((level: number | null) => level === r).length / Math.max(1, levels.length),
        ground = here && r === line ? spot : base;
      if (share === 0) {
        if (here) at(w, x, y, ground, " ", 1);
        continue;
      }
      at(w, x, y, ground + density(share), shades[Math.min(3, Math.ceil(share * 4) - 1)], 1);
    }
  });
  at(w, chart.x, rect.y, rule, "┄".repeat(chart.w), chart.w);
  const top = ` ${util ? "100%" : `${zigRound(ceiling / 1024 ** 3)}G`} `,
    newest = all.at(-1),
    span = point && newest ? ` ${spanText(newest.at - point.at)} ago ` : ` ${spanText(chart.w * history_bucket_ms)} `;
  at(w, chart.x + chart.w - top.length, rect.y, faint, top, top.length);
  at(w, chart.x + 1, rect.y, point ? text : faint, span, sat(chart.w, top.length + 2));
}
function statusText(work: any): string {
  if (!work.known) return "Sampling unavailable";
  if (work.partial) return "Partial process coverage";
  if (work.cpu_pressure) return "CPU busy";
  if (work.gpu_shown && work.gpu_attribution === "list") return "GPU use shared out by memory";
  if (work.gpu_shown && work.gpu_attribution === "device") return "GPU use from device totals";
  return "";
}
/** The host's GPUs: their count, mean utilization and memory in use. */
function gpuHostText(gpus: any[]): string {
  if (!gpus.length) return "";
  const rates = gpus.map(g => g.util).filter(u => u != null);
  let line = gpus.length === 1 ? "1 GPU" : `${gpus.length} GPUs`;
  if (rates.length) line += ` ${cpuText(rates.reduce((a, b) => a + b, 0) / rates.length)}`;
  const used = gpus.reduce((sum, g) => sum + Number(g.used ?? 0), 0),
    total = gpus.reduce((sum, g) => sum + Number(g.total ?? 0), 0);
  if (total > 0) line += ` / ${fixed(used / 1024 ** 3, 1)} of ${fixed(total / 1024 ** 3, 0)} GiB`;
  return line;
}

export function draw(
  w: Writer,
  rect: Rect,
  name: string,
  snapshot: any,
  state: State,
  pointer: { x: number; y: number } | null = null,
): void {
  if (state.workspace === null) return;
  const found = (snapshot?.workspaces ?? []).find((item: any) => item.id === state.workspace);
  const work = {
    known: false,
    partial: false,
    count: 0,
    cpu: null,
    memory: null,
    read: null,
    written: null,
    cpu_pressure: false,
    gpu: null,
    gpu_memory: null,
    gpu_shown: false,
    gpu_devices: [],
    gpu_attribution: null,
    processes: [],
    history: [],
    ...(found ?? {}),
    id: state.workspace,
  };
  w.write("\x1b7\x1b]8;;\x1b\\" + text + "\x1b[?25l");
  for (let row = 0; row < rect.h; row++) {
    w.write(`\x1b[${rect.y + row + 1};${rect.x + 1}H`);
    w.splat(" ", rect.w);
  }
  box(w, rect, ` ${name} / resources `, strong);
  const status = statusText(work);
  at(w, rect.x + 2, rect.y + 1, work.cpu_pressure ? warm : text, status, rect.w - 20);
  right(
    w,
    rect.x + rect.w - 16,
    rect.y + 1,
    faint,
    `live / ${Math.floor((snapshot?.interval_ms ?? 2000) / 1000)}s`,
    13,
  );
  const gpu = state.gpus > 0,
    shift = gpuShift(rect, state.gpus),
    gpus: any[] = snapshot?.gpus ?? [],
    memory_kind: string = snapshot?.gpu_memory_kind ?? "",
    hover = pointer ? hoverAt(rect, state.gpus, pointer.x, pointer.y) : null,
    age = hover?.age ?? null,
    all_graphs = graphs(rect, state.gpus),
    hovered = hover && all_graphs.find(g => g.metric === hover.metric),
    // Under the pointer, the table is that point's leaders by the graph's
    // figure; on a heatmap cell, only the processes on the GPUs at its line,
    // so a GPU running behind the rest can be traced.
    point = pointAt(work, age),
    on: number[] = point && hovered && hover.line !== null ? devicesOn(point, hovered, hover.line, gpus) : [],
    leaders: Process[] | null =
      point && hover
        ? (point.processes ?? []).filter(
            (p: Process) => !on.length || (p.gpu_devices ?? []).some(d => on.includes(d.index)),
          )
        : null;
  if (leaders && hover) leaders.sort((a, b) => (less(hover.metric, a, b) ? -1 : less(hover.metric, b, a) ? 1 : 0));
  const sorted = leaders && hover ? hover.metric : state.sort,
    ascending = leaders ? false : state.ascending;
  for (const g of all_graphs) graph(w, g, work, memory_kind, gpus, age, g === hovered ? hover!.line : null);
  let host_line = `HOST ${snapshot?.cores ?? 1} cores`;
  if (snapshot?.host_cpu != null) host_line += ` / ${cpuText(snapshot.host_cpu)} CPU`;
  if ((snapshot?.memory_pressure ?? "unknown") !== "unknown") host_line += ` / memory ${snapshot.memory_pressure}`;
  if (gpus.length) host_line += ` / ${gpuHostText(gpus)}`;
  at(w, rect.x + 2, rect.y + 11 + shift, faint, host_line, rect.w - 4);
  at(w, rect.x + 2, rect.y + 13 + shift, strong, "TOP PROCESSES", 20);
  const header = rect.y + 14 + shift;
  const table = columns(gpu, memory_kind),
    name_width = rect.w - table[0].x - 11;
  // The sorted column's heading and figures are bright, the heading marked
  // with the way they run; the rest recede.
  // Linux PIDs reach seven digits.
  right(w, rect.x + 2, header, faint, "PID", 7);
  at(w, rect.x + 10, header, faint, "PROCESS", name_width);
  for (const c of table)
    if (sorted === c.sort) right(w, rect.x + rect.w - c.x, header, strong, (ascending ? "↑" : "↓") + c.label, c.width);
    else right(w, rect.x + rect.w - c.x, header, faint, c.label, c.width);
  const room = sat(rect.h, 19 + shift),
    count = Math.min(leaders ? leaders.length : state.count, room),
    gpu_sort = sorted === "gpu" || sorted === "gpu_memory";
  const row = (p: Process | undefined, pid: number, y: number) => {
    right(w, rect.x + 2, y, faint, `${pid}`, 7);
    if (!p) return at(w, rect.x + 10, y, faint, "Sample not available", name_width);
    const name = `${p.provider ? adapter(p.provider).glyph + " " : ""}${p.name}`,
      devices: number[] = (p.gpu_devices ?? []).map(d => d.index);
    at(w, rect.x + 10, y, text, name, name_width);
    // Sorted by a GPU figure, each process says which devices it was on.
    if (gpu_sort && devices.length)
      at(
        w,
        rect.x + 11 + displayWidth(name),
        y,
        faint,
        `gpu ${devicesText(devices)}`,
        sat(name_width, displayWidth(name) + 1),
      );
    for (const c of table)
      right(w, rect.x + rect.w - c.x, y, sorted === c.sort ? strong : text, cell(p, c.field), c.width);
  };
  if (leaders) leaders.slice(0, count).forEach((p, i) => row(p, p.pid, header + 1 + i));
  else
    state.order.slice(0, count).forEach((key, i) =>
      row(
        work.processes.find((item: Process) => item.pid === key.pid && String(item.start) === key.start),
        key.pid,
        header + 1 + i,
      ),
    );
  const legend = Provider.all
    .map(adapter)
    .map(a => `${a.glyph} ${a.label}`)
    .join("   ");
  at(w, rect.x + 2, rect.y + rect.h - 3, faint, legend, rect.w - 4);
  at(
    w,
    rect.x + 2,
    rect.y + rect.h - 2,
    faint,
    leaders
      ? `${on.length ? `${count} ${count === 1 ? "process" : "processes"} on gpu ${devicesText(on)}` : `${count} leading processes`} ${spanText((work.history.at(-1)?.at ?? point.at) - point.at)} ago`
      : `${work.count} local processes / ${snapshot?.memory_kind ?? "RSS"}${work.partial ? " / partial" : ""} / ${count} shown`,
    rect.w - 4,
  );
  w.write("\x1b[0m\x1b8\x1b[?25l");
}
