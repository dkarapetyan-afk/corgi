import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Provider, adapter } from "./providers";
import type { IntegrationStepResult } from "./providers/adapter";
import { atomicWrite } from "./os";
import * as discovery from "./discovery";
import * as rpc from "./rpc";
export async function hook(provider: Provider, path: string): Promise<void> {
  const id = Number(process.env.CORGI_PANE);
  if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) return;
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const b = Buffer.from(chunk);
    size += b.length;
    if (size > 1024 * 1024) return;
    parts.push(b);
  }
  let event: any;
  try {
    event = JSON.parse(Buffer.concat(parts).toString());
  } catch {
    return;
  }
  const a = adapter(provider),
    origin = a.origin ? a.origin(event) : { pid: 0, background: false };
  if (!origin) return;
  try {
    await rpc.request(path, "hook", {
      provider,
      event,
      pane: id,
      seq: Date.now() * 1000,
      background: origin.background,
      pid: origin.pid,
    });
  } catch {}
}
export async function launch(provider: Provider, args: string[], _executable: string): Promise<never> {
  if (process.env.CORGI_PANE === undefined) throw Error("LaunchInsideCorgi");
  // Like execvp: a bare name (Claude, or an override) is looked up on PATH.
  const binary = await discovery.resolve(provider),
    path = binary.includes("/") ? binary : discovery.onPath(binary);
  if (path === null) throw Error("ProviderNotFound");
  process.execve!(path, [binary, ...args], process.env as Record<string, string>);
  throw Error("ExecFailed");
}
/** Config directories the user uninstalled Corgi from, which startup leaves
 * alone. It sits under the base state directory, so temporary and named
 * environments, which share the providers' configs, see it too. */
function removalsPath() {
  const e = process.env;
  return join(e.CORGI_ENV_BASE ?? e.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "corgi", "integrations.json");
}
function removals(): string[] {
  try {
    const value = JSON.parse(readFileSync(removalsPath(), "utf8")).uninstalled;
    return Array.isArray(value) ? value.filter(v => typeof v === "string") : [];
  } catch {
    return [];
  }
}
export function uninstalled(provider: Provider): boolean {
  return removals().includes(adapter(provider).integration.directory());
}
function remember(provider: Provider, gone: boolean) {
  const directory = adapter(provider).integration.directory(),
    saved = removals();
  if (saved.includes(directory) === gone) return;
  const next = saved.filter(d => d !== directory),
    text = JSON.stringify({ uninstalled: gone ? [...next, directory] : next }, null, 2) + "\n";
  atomicWrite(removalsPath(), text, 0o600, false);
}
/** Adds what each provider needs at daemon start, unless the user took it out. */
export async function startup(handoff: boolean) {
  for (const provider of Provider.all)
    try {
      if (!uninstalled(provider)) await adapter(provider).integration.startup(handoff);
    } catch (error) {
      console.error("hook setup:", error);
    }
}
type Op = "status" | "install" | "uninstall";
type Line = { provider: Provider } & (IntegrationStepResult | { item: "startup"; path: string; outcome: "off" });
async function steps(provider: Provider, op: Op): Promise<Line[]> {
  const { integration } = adapter(provider);
  if (op !== "status") remember(provider, op === "uninstall");
  const results = await integration[op](),
    lines: Line[] = results.map(result => ({ provider, ...result }));
  if (op === "status" && uninstalled(provider))
    lines.push({ provider, item: "startup", outcome: "off", path: adapter(provider).integration.directory() });
  return lines;
}
function describe(line: Line, home: string, op: Op): string {
  const at = home && line.path.startsWith(home + "/") ? "~" + line.path.slice(home.length) : line.path;
  if (line.outcome === "off") return "off, so Corgi won't add them when it starts";
  const what = line.subject ? line.subject + " " : "",
    note = line.note ?? "";
  switch (line.outcome) {
    case "added":
      return `${what}added to ${at}${note}`;
    case "present":
      return (op === "status" ? `${what}in ${at}` : `${what}already in ${at}`) + note;
    case "partial":
      return `${what}in ${at}; \`corgi integration install\` adds the rest`;
    case "removed":
      return (line.item === "backup" ? `deleted ${at}` : `${what}removed from ${at}`) + note;
    case "absent":
      return op === "status" && !what ? `not in ${at}` : `${what ? "no " + what : "none "}in ${at}`;
    case "no_config":
      return `${op === "status" ? "" : "skipped, "}no ${at}`;
    case "failed":
      return `failed in ${at}: ${line.error}`;
  }
}
function mark(line: Line, op: Op): string {
  if (line.outcome === "failed" || line.outcome === "partial" || ("todo" in line && line.todo)) return "✗";
  return line.outcome === (op === "status" ? "present" : "added") || line.outcome === "removed" ? "✓" : "·";
}
export const help = `Usage: corgi integration COMMAND [${Provider.all.join("|")}]

  status      show what Corgi has added to each agent's settings
  install     add what each agent needs to report to Corgi
  uninstall   remove everything Corgi added; startup won't add it back

Without an agent, a command covers ${Provider.all.map(p => adapter(p).label).join(" and ")}.
`;
/** `corgi integration status|install|uninstall [PROVIDER]`: one line per
 * thing Corgi adds. False when any step failed. */
export async function command(op: Op, only: Provider | null): Promise<boolean> {
  const lines: Line[] = [];
  for (const provider of only ? [only] : Provider.all) lines.push(...(await steps(provider, op)));
  const label = (p: Provider) => adapter(p).label,
    labels = Math.max(...lines.map(l => label(l.provider).length)),
    items = Math.max(...lines.map(l => l.item.length)),
    home = process.env.HOME ?? "";
  for (const line of lines)
    process.stdout.write(
      `${mark(line, op)} ${label(line.provider).padEnd(labels)}  ${line.item.padEnd(items)}  ${describe(line, home, op)}\n`,
    );
  if (op === "uninstall")
    process.stdout.write("Corgi won't add them back when it starts; `corgi integration install` does.\n");
  else if (op === "install" && lines.some(l => l.item === "hooks" && l.outcome === "added"))
    process.stdout.write("Agents started from now on report to Corgi; restart running ones.\n");
  return !lines.some(l => l.outcome === "failed");
}
