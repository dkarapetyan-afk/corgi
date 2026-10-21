import { realpathSync, statSync } from "node:fs";
import { Connection } from "./rpc";
import { stringify } from "./json";
import { logicalKey } from "./keys";
import helpText from "../assets/cli-help.txt" with { type: "text" };
import skill from "../assets/corgi-skill.md" with { type: "text" };
export const help = helpText;
const groups = new Set(["tab", "pane", "workspace", "current", "list", "focus", "--skill"]);
const nested = new Set(["tab", "pane", "workspace"]);
const flags = new Set(["json", "clear", "stdin", "enter", "new-tab", "left", "right", "up", "down"]);
const options = new Set([
  ...flags,
  "viewer",
  "workspace",
  "name",
  "command",
  "cwd",
  "before",
  "after",
  "width",
  "height",
  "lines",
  "left-of",
  "right-of",
  "above",
  "below",
]);
const actions = new Set([
  "list",
  "current",
  "focus",
  "tab.new",
  "tab.rename",
  "tab.move",
  "tab.merge",
  "tab.close",
  "pane.split",
  "pane.move",
  "pane.swap",
  "pane.resize",
  "pane.close",
  "pane.read",
  "pane.send",
  "pane.keys",
  "workspace.new",
  "workspace.edit",
  "workspace.close",
  "workspace.switch",
]);
export function handles(args: string[]): boolean {
  return groups.has(args[0]);
}
/** Whether a command line asks for help: `--help` or `-h` before any `--`. */
export function asksHelp(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--") return false;
    if (arg === "--help" || arg === "-h") return true;
  }
  return false;
}
/** The lines of a help text that show the command a line names, matched by
 * its longest run of leading words: `pane split 3` finds `corgi pane split`. */
export function usage(text: string, args: string[]): string[] {
  const end = args.findIndex(arg => arg.startsWith("-")),
    words = end === -1 ? args : args.slice(0, end);
  for (let n = words.length; n > 0; n--) {
    const prefix = ["corgi", ...words.slice(0, n)].join(" "),
      lines = text.split("\n").filter(line => {
        const shown = line.trimStart();
        return shown.startsWith(prefix) && [undefined, " ", "|"].includes(shown[prefix.length]);
      });
    if (lines.length) return lines;
  }
  return [];
}
export function id(value: string): number {
  if (!/^\+?\d+$/.test(value)) throw Error("InvalidCharacter");
  const n = Number(value);
  if (n > 0xffffffff) throw Error("Overflow");
  if (!n) throw Error("Usage");
  return n;
}
/** The real path of a directory, relative to this process's cwd. */
export function directory(value: string): string {
  let path: string;
  try {
    path = realpathSync(value);
  } catch {
    throw Error("FileNotFound");
  }
  if (!statSync(path).isDirectory()) throw Error("NotDir");
  return path;
}
class Args {
  options = new Map<string, string>();
  positional: string[] = [];
  constructor(values: string[]) {
    let literal = false;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!literal && v === "--") literal = true;
      else if (!literal && v.startsWith("--")) {
        const name = v.slice(2);
        if (!options.has(name) || this.options.has(name)) throw Error("Usage");
        if (!flags.has(name) && ++i === values.length) throw Error("Usage");
        this.options.set(name, flags.has(name) ? "" : values[i]);
      } else this.positional.push(v);
    }
  }
  option(name: string): string | null {
    const value = this.options.get(name);
    this.options.delete(name);
    return value ?? null;
  }
  flag(name: string): boolean {
    return this.option(name) !== null;
  }
  required(name: string): string {
    const v = this.option(name);
    if (v === null) throw Error("Usage");
    return v;
  }
  next(): string {
    const v = this.positional.shift();
    if (v === undefined) throw Error("Usage");
    return v;
  }
  end(): void {
    if (this.options.size || this.positional.length) throw Error("Usage");
  }
  directory(value: string): string {
    return directory(value);
  }
  cwd(): string {
    const path = this.option("cwd");
    return path === null ? "" : this.directory(path);
  }
  direction(): string {
    for (const d of ["left", "right", "up", "down"]) if (this.flag(d)) return d;
    throw Error("Usage");
  }
  beside(): object {
    for (const [flag, direction] of [
      ["left-of", "left"],
      ["right-of", "right"],
      ["above", "up"],
      ["below", "down"],
    ]) {
      const other = this.option(flag);
      if (other !== null) return { other: id(other), direction };
    }
    throw Error("Usage");
  }
}
export async function parse(words: string[], caller = 0, input?: () => Promise<string>): Promise<any> {
  const group = words[0];
  if (!groups.has(group)) throw Error("Usage");
  let start = nested.has(group) ? 2 : 1;
  const raw = nested.has(group) ? `${group}.${words[1]}` : group;
  const action = raw === "workspace.list" ? "list" : raw;
  if (!actions.has(action)) throw Error("Usage");
  let current = false,
    target = 0;
  if (!["list", "current", "tab.new", "workspace.new"].includes(action)) {
    if (start === words.length) throw Error("Usage");
    current = words[start] === "current";
    if (current && group === "workspace") throw Error("Usage");
    if (current && !caller) throw Error("NoCallerPane");
    target = current ? caller : id(words[start]);
    start++;
  }
  const args = new Args(words.slice(start)),
    json = args.flag("json");
  const viewer =
    action === "focus"
      ? id(args.required("viewer"))
      : action === "workspace.switch"
        ? args.options.has("viewer")
          ? id(args.required("viewer"))
          : null
        : null;
  let command: Record<string, any> | null = null;
  const set = (op: string, payload: any) => {
    command = { [op]: payload };
  };
  switch (action) {
    case "list":
    case "current":
    case "focus":
    case "workspace.switch":
      break;
    case "tab.new":
      set("pane.create", {
        workspace: args.options.has("workspace") ? id(args.required("workspace")) : 0,
        title: args.option("name") ?? "",
        cwd: args.cwd(),
        command: args.option("command"),
      });
      break;
    case "workspace.new":
      set("workspace.create", { name: args.next(), cwd: args.directory(args.option("cwd") ?? ".") });
      break;
    case "workspace.close":
      set(action, { target });
      break;
    case "workspace.edit":
      set(action, {
        target,
        name: args.flag("clear") ? "" : args.option("name"),
        cwd: args.options.has("cwd") ? args.directory(args.required("cwd")) : null,
      });
      break;
    case "tab.rename":
      set(action, { target, name: args.flag("clear") ? "" : args.next() });
      break;
    case "tab.close":
    case "pane.close":
      set(action, { target });
      break;
    case "pane.swap":
      set(action, { target, other: id(args.next()) });
      break;
    case "pane.split":
      set(action, { target, direction: args.direction(), cwd: args.cwd(), command: args.option("command") });
      break;
    case "tab.merge":
      set(action, { target, ...args.beside() });
      break;
    case "tab.move":
      set(action, {
        target,
        destination: args.options.has("before")
          ? { before: id(args.required("before")) }
          : args.options.has("after")
            ? { after: id(args.required("after")) }
            : { workspace: id(args.required("workspace")) },
      });
      break;
    case "pane.move":
      set(action, {
        target,
        destination: args.flag("new-tab") ? { new_tab: args.option("name") ?? "" } : { beside: args.beside() },
      });
      break;
    case "pane.resize": {
      const width = args.option("width"),
        value = width ?? args.required("height");
      if (!/^\d+%$/.test(value)) throw Error("Usage");
      const percent = Number(value.slice(0, -1));
      if (percent < 10 || percent > 90) throw Error("Usage");
      set(action, { target, axis: width === null ? "vertical" : "horizontal", ratio: percent * 10 });
      break;
    }
    case "pane.read": {
      const value = args.option("lines") ?? "100";
      if (!/^\d+$/.test(value)) throw Error("InvalidCharacter");
      const lines = Number(value);
      if (!lines || lines > 10000) throw Error("Usage");
      set(action, { target, lines });
      break;
    }
    case "pane.send": {
      let text: string;
      if (args.flag("stdin")) {
        text = await (input ? input() : Bun.stdin.text());
        if (Buffer.byteLength(text) > 1024 * 1024) throw Error("StreamTooLong");
      } else text = args.next();
      set(action, { target, text, enter: args.flag("enter") });
      break;
    }
    case "pane.keys":
      if (!args.positional.length) throw Error("Usage");
      for (const key of args.positional) logicalKey(key);
      set(action, { target, text: args.positional.join(" ") });
      args.positional = [];
      break;
  }
  args.end();
  if (action === "current" && !caller) throw Error("NoCallerPane");
  const created = (command as Record<string, any> | null)?.["pane.create"];
  if (created?.workspace === 0 && !caller) throw Error("MissingWorkspace");
  return { action, target, current, json, viewer, command };
}
/** A tab's split tree from the layout's node array, in words: `3 left of (4
 * above 5)`. */
export function layout(nodes: any[], index: number, nested = false): string {
  const node = nodes[index];
  if (!node) return "";
  if ("pane" in node) return String(node.pane);
  const first = layout(nodes, node.split.first, true),
    second = layout(nodes, node.split.second, true);
  if (!first || !second) return first || second;
  const text = `${first} ${node.split.axis === "horizontal" ? "left of" : "above"} ${second}`;
  return nested ? `(${text})` : text;
}
/** The pane IDs of a tab's split tree, left to right and top to bottom. */
function panes(nodes: any[], index: number): number[] {
  const node = nodes[index];
  if (!node) return [];
  if ("pane" in node) return [node.pane];
  return [...panes(nodes, node.split.first), ...panes(nodes, node.split.second)];
}
const quote = (name: string) => (name ? " " + JSON.stringify(name) : "");
/** `corgi list` as an outline: workspaces, their tabs and panes, then viewers.
 * A pane shows its cwd only where it differs from its workspace's. */
export function list(reply: any): string {
  const out: string[] = [],
    byId = new Map<number, any>((reply.result?.panes ?? []).map((p: any) => [p.id, p]));
  for (const w of reply.result?.workspaces ?? []) {
    out.push(`workspace ${w.id}${quote(w.name)} ${w.cwd}`);
    for (const t of w.model?.tabs ?? []) {
      const ids = panes(w.model.nodes, t.root);
      out.push(`  tab ${t.id}${quote(t.title)}${ids.length > 1 ? ": " + layout(w.model.nodes, t.root) : ""}`);
      for (const id of ids) {
        const p = byId.get(id);
        if (p) out.push(`    pane ${id}${quote(p.name)}${p.cwd && p.cwd !== w.cwd ? " " + p.cwd : ""}${pane(p)}`);
      }
    }
  }
  for (const v of reply.viewers ?? []) out.push(`viewer ${v.id}: workspace ${v.workspace}, pane ${v.pane}`);
  return out.join("\n") + "\n";
}
function pane(p: any): string {
  const a = p.agent,
    exited = p.exited ? " exited" : "";
  if (!a?.provider) return exited;
  const attention = a.attention && a.attention !== "none" ? ", " + a.attention.replace("_", " ") : "",
    activity = a.activity || a.recent_activity;
  return `${exited} ${a.provider} ${a.state}${attention}${quote(a.name)}${activity ? ` (${activity})` : ""}`;
}
/** A reply other than `list` and `pane read`, in words. */
export function words(reply: any): string {
  if ("queued" in reply) return `queued for viewer ${reply.viewer}\n`;
  const r = reply.result ?? {};
  if (r.closed_panes?.length) return `closed pane ${r.closed_panes.join(", ")}\n`;
  if (r.pane) return `pane ${r.pane} (tab ${r.tab}, workspace ${r.workspace})\n`;
  return "ok\n";
}
/** `pane read` text for a reader that asked for `lines` lines, given up to one
 * more: the extra line only says that earlier output exists. Agent mode trims
 * line ends, shortens rules and keeps one blank line in a row. */
export function read(text: string, lines: number, agent = false): string {
  let all = text.split("\n");
  const more = all.length > lines;
  if (more) all = all.slice(-lines);
  if (agent)
    all = all
      .map(line => line.trimEnd().replace(/[─━═]{4,}/g, m => m.slice(0, 3)))
      .filter((line, i, kept) => line || kept[i - 1] !== "");
  const shown = all.join("\n"),
    header = more ? `[corgi: last ${lines} lines shown; --lines N reads more]\n` : "";
  return header + shown + (shown ? "\n" : "");
}
/** Runs a control command and prints its reply in words, or with `--json` as
 * the daemon sent it. */
export async function run(path: string, args: string[], agent = false): Promise<void> {
  const group = args[0];
  if (group === "--skill") {
    if (args.length !== 1) throw Error("Usage");
    process.stdout.write(skill);
    return;
  }
  if ((nested.has(group) && args.length === 1) || asksHelp(args.slice(1))) {
    process.stdout.write(help);
    return;
  }
  const caller = Number(process.env.CORGI_PANE) || 0,
    inv = await parse(args, caller),
    conn = new Connection(path);
  const reading = inv.json ? null : inv.command?.["pane.read"],
    lines = reading?.lines;
  if (reading) reading.lines = Math.min(lines + 1, 10000);
  try {
    if ((inv.current && group === "tab") || (inv.action === "tab.new" && caller)) {
      const { result } = await conn.call("session.locate", { pane: caller });
      const [op, q] = Object.entries(inv.command)[0] as [string, any];
      if (op === "pane.create") {
        q.workspace ||= result.workspace;
        if (q.workspace === result.workspace) q.from = caller;
      } else q.target = result.tab;
    }
    const reply = inv.command
      ? await conn.call("session.command", { command: inv.command })
      : inv.action === "list"
        ? await conn.call("session.list")
        : inv.action === "current"
          ? await conn.call("session.locate", { pane: caller })
          : inv.action === "workspace.switch"
            ? await conn.call("workspace.switch", { workspace: inv.target, viewer: inv.viewer })
            : await conn.call("focus", { pane: inv.target, viewer: inv.viewer });
    if (inv.json) process.stdout.write(stringify(reply) + "\n");
    else if (reading && "result" in reply && "text" in reply.result && typeof reply.result.text === "string")
      process.stdout.write(read(reply.result.text, lines, agent));
    else process.stdout.write(inv.action === "list" ? list(reply) : words(reply));
  } finally {
    conn.close();
  }
}
/** Writes a failed command line's error, as JSON when it asked for `--json`;
 * a usage error lists the command's help lines. */
export function failure(code: string, status = 1, args: string[] = []): void {
  const lines = code === "Usage" ? usage(help, args).map(line => line.trim()) : [],
    end = args.indexOf("--");
  if ((end === -1 ? args : args.slice(0, end)).includes("--json"))
    process.stderr.write(stringify({ ok: false, err: code, ...(lines.length ? { usage: lines } : {}) }) + "\n");
  else if (lines.length) process.stderr.write(`corgi: usage:\n${lines.map(line => "  " + line).join("\n")}\n`);
  else process.stderr.write(`corgi: ${code}\n`);
  process.exitCode = status;
}
