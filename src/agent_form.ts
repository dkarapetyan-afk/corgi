//! The per-account launch editor. Geometry is stable while environment rows change.
import type { Agent } from "./agent_manager";
import * as agentOptions from "./agent_options";
import * as palette from "./palette";
import { Dialog, View as DialogView, writeField, printable } from "./name_dialog";
import { Rect } from "./layout";
import { Writer, displayWidth, writeEllipsis, sat } from "./text";
import * as keys from "./keys";
import { milliTimestamp } from "./clock";

export type Focus =
  { kind: "name" | "flags" | "add" | "cancel" | "save" } | { kind: "key" | "value" | "remove"; row: number };
type Variable = { key: Dialog; value: Dialog; added: number | null };
type Result = "save" | "cancel" | null;
const visible_rows = 4;
export const row_duration_ms = 240;
const editor = (text: string) => Dialog.init({ agent_command: 0 }, text);
const at = (x: number, y: number) => `\x1b[${y + 1};${x + 1}H`;

export class Form {
  agent: Agent | null = null;
  name = Dialog.init({ rename: 0 }, "");
  flags = editor("");
  variables: Variable[] = [];
  focus: Focus = { kind: "name" };
  suggestion = "";
  error = "";
  private first = 0;
  private room = visible_rows;

  open(agent: Agent, options: agentOptions.Options, suggestion: string): void {
    this.agent = agent;
    this.name = Dialog.init({ rename: 0 }, agent.name);
    this.flags = editor(options.flags);
    this.variables = options.env.map(([key, value]) => ({ key: editor(key), value: editor(value), added: null }));
    this.focus = { kind: "name" };
    this.suggestion = suggestion;
    this.error = "";
    this.first = 0;
  }
  height(): number {
    return 24;
  }
  input(): Dialog {
    const f = this.focus;
    switch (f.kind) {
      case "flags":
        return this.flags;
      case "key":
        return this.variables[f.row].key;
      case "value":
        return this.variables[f.row].value;
      default:
        return this.name;
    }
  }
  typing(): boolean {
    return ["name", "flags", "key", "value"].includes(this.focus.kind);
  }
  options(): agentOptions.Options {
    return { flags: this.flags.raw(), env: this.variables.map(v => [v.key.raw(), v.value.raw()]) };
  }
  label(): string {
    return this.name.name() || (this.agent?.account ? this.suggestion : "");
  }
  validate(): boolean {
    this.error = agentOptions.problem(this.options()) ?? "";
    if ([this.name, this.flags, ...this.variables.flatMap(v => [v.key, v.value])].some(d => d.overflow))
      this.error = "A field is too long; shorten it before saving.";
    return !this.error;
  }
  tick(now: number): boolean {
    let active = false;
    for (const variable of this.variables) {
      if (variable.added === null) continue;
      active = true;
      if (now - variable.added >= row_duration_ms) variable.added = null;
    }
    return active;
  }
  private stops(): Focus[] {
    return [
      { kind: "name" },
      { kind: "flags" },
      ...this.variables.flatMap((_, row): Focus[] => [
        { kind: "key", row },
        { kind: "value", row },
        { kind: "remove", row },
      ]),
      ...(this.variables.length < agentOptions.max_variables ? [{ kind: "add" } as Focus] : []),
      { kind: "cancel" },
      { kind: "save" },
    ];
  }
  private move(delta: number): void {
    const stops = this.stops(),
      index = stops.findIndex(
        f => f.kind === this.focus.kind && (!("row" in f) || ("row" in this.focus && f.row === this.focus.row)),
      );
    this.focus = stops[(Math.max(0, index) + delta + stops.length) % stops.length];
    this.ensureVisible();
  }
  private ensureVisible(): void {
    if ("row" in this.focus)
      this.first = Math.max(0, Math.min(this.focus.row, Math.max(this.first, this.focus.row - this.room + 1)));
    this.first = Math.min(this.first, Math.max(0, this.variables.length - this.room));
  }
  private add(now: number): void {
    if (this.variables.length >= agentOptions.max_variables) return;
    this.variables.push({ key: editor(""), value: editor(""), added: now });
    this.focus = { kind: "key", row: this.variables.length - 1 };
    this.ensureVisible();
  }
  private remove(row: number): void {
    this.variables.splice(row, 1);
    this.focus = this.variables.length
      ? { kind: "key", row: Math.min(row, this.variables.length - 1) }
      : { kind: "add" };
    this.ensureVisible();
  }
  key(byte: number, now = milliTimestamp()): Result {
    this.error = "";
    switch (byte) {
      case 27:
        return "cancel";
      case 9:
        this.move(1);
        return null;
      case 13:
        switch (this.focus.kind) {
          case "add":
            this.add(now);
            return null;
          case "remove":
            this.remove(this.focus.row);
            return null;
          case "cancel":
            return "cancel";
          default:
            return this.validate() ? "save" : null;
        }
      default:
        if (this.typing()) this.input().key(byte);
        return null;
    }
  }
  sequence(seq: string): void {
    if (keys.parse(seq) === "shift_tab") this.move(-1);
    else if (this.typing()) this.input().sequence(seq);
  }
  private geometry(b: Rect) {
    const x = b.x + 3,
      width = sat(b.w, 6),
      key_width = Math.min(22, Math.floor((width - 5) * 0.4));
    const compact = b.h < this.height();
    this.room = compact ? 3 : visible_rows;
    this.ensureVisible();
    return {
      x,
      width,
      key_width,
      value_x: x + key_width + 2,
      value_width: width - key_width - 5,
      remove_x: b.x + b.w - 4,
      name: compact ? 4 : 5,
      flags: compact ? 6 : 8,
      hint: compact ? 7 : 9,
      environment: compact ? 8 : 11,
      headings: compact ? 9 : 12,
      rows: compact ? 10 : 13,
      count: compact ? 13 : 17,
      add: compact ? 14 : 18,
      note: compact ? 15 : 19,
      actions: compact ? 16 : 20,
      error: compact ? 17 : 21,
      compact,
    };
  }
  private field(
    w: Writer,
    d: Dialog,
    placeholder: string,
    x: number,
    y: number,
    width: number,
    focused: boolean,
  ): void {
    const plain = new palette.Style({ fg: "text", bg: focused ? "selected" : "surface" }).sgr();
    w.write(at(x, y) + plain);
    w.splat(" ", width);
    w.write(at(x, y));
    if (!d.len) {
      w.write(palette.fg(focused ? "muted" : "faint"));
      writeEllipsis(w, placeholder, width);
    } else writeField(w, d, DialogView.scroll(d, width), width, plain, { selecting: focused });
    w.write(new palette.Style({ fg: "text", bg: "surface" }).sgr());
  }
  draw(w: Writer, b: Rect, now: number): void {
    const g = this.geometry(b),
      f = this.focus,
      text = new palette.Style({ fg: "text", bg: "surface" }).sgr(),
      dim = palette.fg("faint"),
      strong = palette.fg("strong"),
      label = (y: number, value: string) => {
        w.write(at(g.x, b.y + y) + text + dim);
        writeEllipsis(w, value, g.width);
      },
      button = (x: number, y: number, value: string, focused: boolean) =>
        w.write(
          at(x, b.y + y) +
            new palette.Style({ fg: focused ? "strong" : "text", bg: focused ? "selected" : "surface" }).sgr() +
            value +
            text,
        );
    w.write(at(g.x, b.y + 2) + text + strong);
    writeEllipsis(w, printable(this.agent?.label ?? ""), g.width);
    if (!g.compact) label(3, printable(this.agent?.who ?? ""));
    label(g.name - 1, "Name");
    this.field(
      w,
      this.name,
      this.agent?.account ? this.suggestion : "Agent default",
      g.x,
      b.y + g.name,
      g.width,
      f.kind === "name",
    );
    label(g.flags - 1, "Extra flags");
    this.field(w, this.flags, "e.g. --model sonnet --verbose", g.x, b.y + g.flags, g.width, f.kind === "flags");
    label(g.hint, "Appended to Corgi's launch command. Quotes supported.");
    label(g.environment, "Environment");
    label(g.headings, "Variable");
    w.write(at(g.value_x, b.y + g.headings) + dim + "Value");
    if (!this.variables.length) label(g.rows, "No overrides; inherits your environment.");
    for (let i = this.first; i < Math.min(this.variables.length, this.first + this.room); i++) {
      const variable = this.variables[i],
        y = b.y + g.rows + i - this.first;
      this.field(w, variable.key, "VARIABLE", g.x, y, g.key_width, f.kind === "key" && f.row === i);
      this.field(w, variable.value, "(empty)", g.value_x, y, g.value_width, f.kind === "value" && f.row === i);
      button(g.remove_x, y - b.y, "×", f.kind === "remove" && f.row === i);
      if (variable.added !== null) {
        const t = Math.min(1, Math.max(0, (now - variable.added) / row_duration_ms)),
          color = palette.mix(palette.colors.accent, palette.colors.line, Math.round(100 * (1 - (1 - t) ** 3)));
        w.write(at(g.x - 1, y) + palette.fgRgb(color) + "▎" + text);
      }
    }
    if (this.variables.length > this.room)
      label(
        g.count,
        `${this.first + 1}–${Math.min(this.first + this.room, this.variables.length)} of ${this.variables.length} · tab to scroll`,
      );
    if (this.variables.length < agentOptions.max_variables) button(g.x, g.add, "+ Add variable", f.kind === "add");
    label(g.note, "Across workspaces · new launches only");
    button(b.x + b.w - 22, g.actions, "[ Cancel ]", f.kind === "cancel");
    button(b.x + b.w - 10, g.actions, "[ Save ]", f.kind === "save");
    if (this.error) {
      w.write(at(g.x, b.y + g.error) + palette.fg("hot"));
      writeEllipsis(w, this.error, g.width);
    }
  }
  caret(b: Rect): { x: number; y: number } {
    const g = this.geometry(b),
      f = this.focus,
      variable = f.kind === "key" || f.kind === "value",
      x = f.kind === "value" ? g.value_x : g.x,
      width = f.kind === "key" ? g.key_width : f.kind === "value" ? g.value_width : g.width,
      d = this.input(),
      offset = DialogView.scroll(d, width),
      y = b.y + (variable && "row" in f ? g.rows + f.row - this.first : f.kind === "flags" ? g.flags : g.name);
    return { x: x + Math.min(sat(width, 1), displayWidth(d.bytes(offset, d.cursor))), y };
  }
  click(b: Rect, x: number, y: number, now = milliTimestamp()): Result {
    const g = this.geometry(b),
      row = y - b.y;
    if (x < g.x || x >= b.x + b.w - 2) return null;
    if (row === g.actions && x >= b.x + b.w - 10 && x < b.x + b.w - 2) return this.validate() ? "save" : null;
    if (row === g.actions && x >= b.x + b.w - 22 && x < b.x + b.w - 12) return "cancel";
    if (row === g.add && x < g.x + 14) {
      this.add(now);
      return null;
    }
    if (row === g.name) this.focus = { kind: "name" };
    else if (row === g.flags) this.focus = { kind: "flags" };
    else if (row >= g.rows && row < g.rows + this.room && this.variables[row - g.rows + this.first]) {
      const index = row - g.rows + this.first;
      if (x === g.remove_x) {
        this.remove(index);
        return null;
      }
      if (x < g.x + g.key_width) this.focus = { kind: "key", row: index };
      else if (x >= g.value_x && x < g.value_x + g.value_width) this.focus = { kind: "value", row: index };
      else return null;
    } else return null;
    const width = this.focus.kind === "key" ? g.key_width : this.focus.kind === "value" ? g.value_width : g.width,
      start = this.focus.kind === "value" ? g.value_x : g.x,
      d = this.input();
    d.position(d.byteAtColumn(DialogView.scroll(d, width), x - start));
    return null;
  }
}
