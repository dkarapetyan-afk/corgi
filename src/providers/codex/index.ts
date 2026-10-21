import { appBundles, configHome, str, Hooks, Text, planLabel } from "../common";
import type { Adapter } from "../adapter";
import * as hooksFile from "../hooks_file";
import * as integration from "./integration";
import { Codex } from "./headless";
import { toolless } from "./app_server";
import { transcript } from "./transcript";
import * as usage from "./usage";
import * as observer from "./observer";
export { EventKind, Method, Rollout, RolloutKind } from "./transcript";
export { ItemType, commandDirectory, writes } from "./headless";
import { screen, Watcher } from "./screen";
import * as renaming from "./rename";
export { screen };
import { caps, info, keeping, vocabulary } from "./info";
import * as commandLine from "../command_line";
import { existsSync, realpathSync } from "node:fs";
import path, { join } from "node:path";
export function configDir(env = process.env) {
  return configHome(env, vocabulary.config_env, ".codex");
}
/** The thread a terminal title names, as Codex's titles spell its ID. */
export function titleSession(title: string) {
  let found: Text | null = null;
  for (const word of title.split(/[ |\t]+/)) {
    const s = word.length === 36 ? word : word.length === 32 && word.endsWith("...") ? word.slice(0, 29) : "";
    if (!s || !/^([\da-f]{8})-([\da-f]{4})-([\da-f]{4})-([\da-f]{4})-([\da-f]{5}|[\da-f]{12})$/i.test(s)) continue;
    if (found) return null;
    found = new Text(s);
  }
  return found;
}
export function plan(code: string) {
  const names: Record<string, string> = {
    prolite: "Pro 100",
    pro: "Pro 200",
    promax: "Pro 500",
    team: "Business",
    self_serve_business_usage_based: "Business",
    self_serve_business_prolite: "Business Premium",
    business: "Enterprise",
    ent26: "Enterprise",
    enterprise_cbp_usage_based: "Enterprise",
    enterprise_cbp_automation: "Enterprise (Automation)",
  };
  return names[code] ? new Text(names[code]) : planLabel(code);
}
/** The hook events Corgi listens to. */
export const events = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Stop",
  "SessionEnd",
  "PreCompact",
  "Interrupt",
  "PostCompact",
];
const settings = () => new hooksFile.File("codex", configDir(), "hooks.json", events);
async function title(directory: string) {
  try {
    return await integration.installTitle(directory);
  } catch (error) {
    return hooksFile.failed("title", join(directory, "config.toml"), error);
  }
}
const hooks = new Hooks();
export const adapter: Adapter = {
  ...info,
  caps,
  inspect: c => commandLine.inspect(c, vocabulary),
  owns: p => path.basename(p) === "codex" || p.endsWith("/@openai/codex/bin/codex.js"),
  installs: at => [
    ...(at.home
      ? [".local/bin", ".bun/bin", ".npm-global/bin", ".volta/bin", ".cargo/bin"].map(dir =>
          join(at.home!, dir, "codex"),
        )
      : []),
    ...["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(dir => at.root + dir + "/codex"),
    ...appBundles(["Codex.app", "ChatGPT.app"], "codex", at),
  ],
  // Other tools are called codex too.
  version(stdout) {
    const line = stdout.trim();
    return line.startsWith("codex-cli ") && /^\d/.test(line.slice("codex-cli ".length));
  },
  watch: () => new Watcher(),
  hook(v) {
    const hook = hooks.decode(v);
    // A Codex permission hook doesn't mean a prompt shows: its screen says when one does.
    if (hook?.kind === "permission") hook.confirm = "screen";
    return hook;
  },
  // Its tools and subagents inherit the pane's environment, but their
  // sessions mustn't take over the pane's conversation.
  origin(event) {
    const parent = process.env.CODEX_THREAD_ID;
    return parent && parent !== str(event, "session_id") ? null : { pid: 0, background: false };
  },
  unnest: env => {
    delete env.CODEX_THREAD_ID;
  },
  titleSession,
  launch: {
    start: s => [
      // Its hooks report a run that never asks as bypassing permissions,
      // sandboxed or not, so approval and sandbox options it kept win.
      ...(s.permissions === "bypass" &&
      !s.args.some(w => /^(-a|--ask-for-approval|-s|--sandbox|--full-auto)(=|$)/.test(w))
        ? [vocabulary.yolo]
        : []),
      ...(s.model ? ["--model", s.model] : []),
      ...s.args,
    ],
    keep: c => commandLine.keep(c, keeping),
    resume: session => ["resume", session],
    fork: ({ session }) => (session.length === 36 ? { args: ["fork", session], session: null, named: false } : null),
  },
  rename: {
    channel: async (session, connected) =>
      session.length === 36 && connected
        ? name => renaming.rename(join(configDir(), "app-server-control/app-server-control.sock"), session, name)
        : null,
    typed: { command: renaming.command, empty: renaming.empty, holds: renaming.holds },
  },
  headless: {
    start: at => Codex.start(at, null),
    restore: Codex.restore,
  },
  inference: {
    model: "gpt-6-luna",
    start: (r, at) => Codex.start(at, r, toolless),
    restore: Codex.restore,
    renew: (c, r) => c instanceof Codex && c.renew(r),
  },
  launcher: () => import("./launcher").then(m => m.open()),
  history: () => import("./history").then(m => m.open()),
  transcript: { ...transcript, reader: () => usage.open(() => join(configDir(), "session_index.jsonl")) },
  observer: () => observer.Worker.start(),
  integration: {
    directory: () => configDir(),
    async install() {
      const file = settings(),
        hooks = file.install();
      if (hooks.outcome === "no_config" || hooks.outcome === "failed") return [hooks];
      if (hooks.outcome === "added") hooks.note = "; trust them in /hooks";
      return [hooks, await title(file.directory)];
    },
    async uninstall() {
      const file = settings(),
        { result, removal } = file.uninstall();
      if (result.outcome === "no_config" || result.outcome === "failed") return [result];
      const config = await integration.uninstallConfig(file.directory, removal),
        backups = [file.path + ".corgi-backup"];
      // A failed edit keeps the backup that tells a retry what to restore.
      if (!config.some(r => r.outcome === "failed")) backups.push(join(file.directory, "config.toml.corgi-backup"));
      return [result, ...config, ...file.cleanup(backups)];
    },
    async status() {
      const file = settings(),
        hooks = file.status();
      if (hooks.outcome === "no_config") return [hooks];
      if (hooks.events?.[0]) {
        const files = [file.path, ...(existsSync(file.path) ? [realpathSync(file.path)] : [])];
        Object.assign(hooks, await integration.trust(file.command, files));
      }
      return [hooks, integration.titleStatus(file.directory)];
    },
    async startup(handoff) {
      const file = settings(),
        hooks = file.install();
      if (hooks.outcome === "failed") console.error("hook setup:", hooks.error);
      if (!handoff)
        void title(file.directory).then(r => r.outcome === "failed" && console.error("Codex title setup:", r.error));
    },
    snippet: executable => hooksFile.snippet("codex", events, executable),
  },
};
