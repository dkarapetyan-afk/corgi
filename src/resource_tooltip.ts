//! Viewer-local resource card: three framed graphs and a stable mini top.
//! Pointing at a graph's history shows that point's figures and leaders.
//! Mirrors resource_tooltip.zig.
import { Style, derived } from "./palette";
import { Provider, adapter } from "./providers";
import { Rect } from "./layout";
import { cpuText, ioText } from "./trackers/resources";
import { Writer, displayWidth, writeClipped, directoryLabel, sat, zigRound } from "./text";

// Each write sets a whole style, so bold never leaks into the next.
let text: string, faint: string, rule: string, strong: string, warm: string, live: string, past: string, lit: string;
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
  // The history column under the pointer.
  lit = new Style({ fg: "accent", bg: "selected" }).sgr();
});

export type Sort = "cpu" | "memory" | "io";

export function geometry(cols: number, rows: number, side: number, anchor: number): Rect | null {
  if (cols < 68 || rows < 22) return null;
  const w = Math.min(82, cols - 2);
  const h = Math.min(24, rows - 2);
  return new Rect(Math.min(side, cols - w - 1), Math.min(anchor, rows - h - 1), w, h);
}
/** The graphs, each with the cells that chart its history. */
function graphs(rect: Rect): { metric: Sort; box: Rect; chart: Rect }[] {
  const gw = Math.floor((rect.w - 6) / 3);
  return (["cpu", "memory", "io"] as Sort[]).map((metric, i) => {
    const box = new Rect(rect.x + 2 + i * (gw + 1), rect.y + 3, gw, 7);
    return { metric, box, chart: new Rect(box.x + 2, box.y + 3, box.w - 4, box.h - 4) };
  });
}
/** The graph whose history the pointer is over, and how many points back from the newest. */
export function hoverAt(rect: Rect, x: number, y: number): { metric: Sort; age: number } | null {
  for (const { metric, box, chart } of graphs(rect))
    if (x >= chart.x && x < chart.x + chart.w && y > box.y && y < box.y + box.h - 1)
      return { metric, age: chart.x + chart.w - 1 - x };
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
}
function metricValue(sort: Sort, p: Process): number | null {
  switch (sort) {
    case "cpu":
      return p.cpu ?? null;
    case "memory":
      return Number(p.memory ?? 0);
    case "io":
      return p.read != null && p.written != null ? Number(p.read) + Number(p.written) : null;
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
  constructor(fields: Partial<State> = {}) {
    Object.assign(this, fields);
  }
  update(work: { id: number; processes?: Process[] }, freeze: boolean): void {
    if (this.workspace !== work.id) {
      this.workspace = work.id;
      this.count = 0;
      this.sort = "cpu";
      this.ascending = false;
      this.frozen = false;
    }
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
    const sort = sortAt(rect, x, y);
    if (sort === null) return;
    this.ascending = sort === this.sort && !this.ascending;
    this.sort = sort;
    this.frozen = false;
  }
}
/** The sortable column header under a cell, from "CPU %" through "W MB/s".
 * Both disk columns sort by I/O. */
export function sortAt(rect: Rect, x: number, y: number): Sort | null {
  if (y !== rect.y + 14 || x < rect.x + rect.w - 32 || x >= rect.x + rect.w - 2) return null;
  if (x >= rect.x + rect.w - 17) return "io";
  if (x >= rect.x + rect.w - 24) return "memory";
  return "cpu";
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
/** The history point `age` back from the newest, or none for now. */
function pointAt(work: any, age: number | null): any {
  return age === null ? null : ((work.history ?? []).at(-1 - age) ?? null);
}
/** How long `ms` is, to the second or the minute. */
function spanText(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
}
/** Under the pointer, the figure is the history's at that point and its column is lit. */
function graph(w: Writer, g: { metric: Sort; box: Rect; chart: Rect }, work: any, age: number | null): void {
  const { metric, box: rect, chart } = g;
  const read = u64(work.read);
  const written = u64(work.written);
  const total = read !== null && written !== null ? read + written : null;
  const shown = (source: any, io: bigint | null) =>
    metric === "cpu"
      ? cpuText(source.cpu ?? null)
      : metric === "memory"
        ? source.memory != null
          ? `${fixed(Number(source.memory) / (1024 * 1024 * 1024), 2)} GiB`
          : ""
        : ioText(io);
  if (shown(work, total).length === 0) return;
  box(w, rect, metric === "cpu" ? " cpu " : metric === "memory" ? " memory " : " disk I/O ", faint);
  const point = pointAt(work, age);
  at(
    w,
    rect.x + 2,
    rect.y + 1,
    point ? past : strong,
    point ? shown(point, u64(point.io)) : shown(work, total),
    rect.w - 4,
  );
  const width = chart.w;
  const all: any[] = work.history ?? [];
  const history = all.slice(all.length - Math.min(width, all.length));
  let ceiling = metric === "cpu" ? 100 : 1;
  for (const point of history) {
    const v = sample(point, metric);
    if (v !== null) ceiling = Math.max(ceiling, v);
  }
  const rows = chart.h;
  const glyphs = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  history.forEach((point, i) => {
    const v = sample(point, metric),
      here = age !== null && i === history.length - 1 - age;
    if (v === null && !here) return;
    const eighths = v === null ? 0 : zigRound((v / ceiling) * (rows * 8));
    for (let row = 0; row < rows; row++) {
      const fill = Math.min(8, sat(eighths, row * 8));
      at(w, chart.x + width - history.length + i, chart.y + rows - 1 - row, here ? lit : live, glyphs[fill], 1);
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
  }
}
function statusText(work: any): string {
  if (!work.known) return "Sampling unavailable";
  if (work.partial) return "Partial process coverage";
  if (work.cpu_pressure) return "CPU busy";
  return "";
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
  const hover = pointer ? hoverAt(rect, pointer.x, pointer.y) : null,
    age = hover?.age ?? null,
    // Under the pointer, the table is that point's leaders by the graph's figure.
    point = pointAt(work, age),
    leaders: Process[] | null = point && hover ? [...(point.processes ?? [])] : null;
  if (leaders && hover) leaders.sort((a, b) => (less(hover.metric, a, b) ? -1 : less(hover.metric, b, a) ? 1 : 0));
  const sorted = leaders && hover ? hover.metric : state.sort,
    ascending = leaders ? false : state.ascending;
  for (const g of graphs(rect)) graph(w, g, work, age);
  let host_line = `HOST ${snapshot?.cores ?? 1} cores`;
  if (snapshot?.host_cpu != null) host_line += ` / ${cpuText(snapshot.host_cpu)} CPU`;
  if ((snapshot?.memory_pressure ?? "unknown") !== "unknown") host_line += ` / memory ${snapshot.memory_pressure}`;
  at(w, rect.x + 2, rect.y + 11, faint, host_line, rect.w - 4);
  at(w, rect.x + 2, rect.y + 13, strong, "TOP PROCESSES", 20);
  const header = rect.y + 14;
  // The sorted column's heading and figures are bright, the heading marked
  // with the way they run; the rest recede.
  const cpu = sorted === "cpu" ? strong : text;
  const memory = sorted === "memory" ? strong : text;
  const io = sorted === "io" ? strong : text;
  const heading = (x: number, sort: Sort, label: string, width: number) =>
    sorted === sort
      ? right(w, x, header, strong, (ascending ? "↑" : "↓") + label, width)
      : right(w, x, header, faint, label, width);
  // Linux PIDs reach seven digits.
  right(w, rect.x + 2, header, faint, "PID", 7);
  at(w, rect.x + 10, header, faint, "PROCESS", rect.w - 43);
  heading(rect.x + rect.w - 32, "cpu", "CPU %", 7);
  heading(rect.x + rect.w - 24, "memory", "GiB", 6);
  heading(rect.x + rect.w - 17, "io", "R MB/s", 7);
  heading(rect.x + rect.w - 9, "io", "W MB/s", 7);
  const count = Math.min(leaders ? leaders.length : state.count, sat(rect.h, 19));
  const row = (p: Process | undefined, pid: number, y: number) => {
    right(w, rect.x + 2, y, faint, `${pid}`, 7);
    if (p) {
      at(w, rect.x + 10, y, text, `${p.provider ? adapter(p.provider).glyph + " " : ""}${p.name}`, rect.w - 43);
      right(w, rect.x + rect.w - 32, y, cpu, p.cpu != null ? fixed(p.cpu, 1) : "", 7);
      right(w, rect.x + rect.w - 24, y, memory, fixed(Number(p.memory ?? 0) / (1024 * 1024 * 1024), 2), 6);
      right(w, rect.x + rect.w - 17, y, io, p.read != null ? fixed(Number(p.read) / 1000000, 1) : "", 7);
      right(w, rect.x + rect.w - 9, y, io, p.written != null ? fixed(Number(p.written) / 1000000, 1) : "", 7);
    } else at(w, rect.x + 10, y, faint, "Sample not available", rect.w - 43);
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
      ? `${count} leading processes ${spanText((work.history.at(-1)?.at ?? point.at) - point.at)} ago`
      : `${work.count} local processes / ${snapshot?.memory_kind ?? "RSS"}${work.partial ? " / partial" : ""} / ${count} shown`,
    rect.w - 4,
  );
  w.write("\x1b[0m\x1b8\x1b[?25l");
}
