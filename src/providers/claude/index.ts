import path from "node:path";
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { configHome, Hooks, planLabel } from "../common";
import type { Adapter } from "../adapter";
import * as hooksFile from "../hooks_file";
import { Watcher } from "./screen";
import * as daemon from "./daemon";
import * as renaming from "./rename";
import { Claude, stream_json, summaryArgs } from "./headless";
import { transcript } from "./transcript";
import * as usage from "./usage";
import * as conversation from "./conversation";
import { hookOrigin, unnest } from "./process";
export { BlockType, Line, MessageType, TaskNotice, TaskStatus, TranscriptLine } from "./transcript";
import { caps, info, keeping, vocabulary } from "./info";
import * as commandLine from "../command_line";
export function configDir(env = process.env) {
  return configHome(env, vocabulary.config_env, ".claude");
}
export function subagentTranscript(transcript: string, session: string, agent: string) {
  return path.join(path.dirname(transcript), session, "subagents", `agent-${agent}.jsonl`);
}
export function plan(kind: string, tier: string) {
  const code = (s: string) => s.replace(/^default_/, "").replace(/^claude_/, "");
  const named = planLabel(code(kind)),
    refined = planLabel(code(tier));
  return named.len > 0 && refined.text().startsWith(named.text()) ? refined : named;
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
  "Notification",
  "PostToolUseFailure",
  "SubagentStart",
  "SubagentStop",
];
const settings = () => new hooksFile.File("claude", configDir(), "settings.json", events);
const hooks = new Hooks();
export const adapter: Adapter = {
  ...info,
  caps,
  inspect: c => commandLine.inspect(c, vocabulary),
  owns: p =>
    ["claude", "claude-code"].includes(path.basename(p)) ||
    p.includes("/claude/versions/") ||
    p.endsWith("/@anthropic-ai/claude-code/cli.js"),
  installs: ({ home, root }) => [
    ...(home
      ? [".claude/local", ".local/bin", ".bun/bin", ".npm-global/bin", ".volta/bin"].map(dir =>
          path.join(home, dir, "claude"),
        )
      : []),
    ...["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(dir => root + dir + "/claude"),
  ],
  watch: () => new Watcher(),
  hook: v => hooks.decode(v),
  origin: hookOrigin,
  unnest,
  launch: {
    start: s => [
      ...(s.permissions === "bypass" ? [vocabulary.yolo] : []),
      ...(s.model ? ["--model", s.model] : []),
      ...s.args,
    ],
    keep: c => commandLine.keep(c, keeping),
    resume: session => ["--resume", session],
    // Its background daemon holds sessions that `--resume` refuses.
    attach(session) {
      try {
        const job = daemon.jobIn(path.join(configDir(), "sessions"), session);
        return job ? ["attach", job.text()] : null;
      } catch {
        return null;
      }
    },
    fork({ session, transcript }, name) {
      if (session.length !== 36) return null;
      // The fork copies its transcript: nothing to fork until there is one.
      if (transcript)
        try {
          lstatSync(transcript);
        } catch {
          return null;
        }
      const id = randomUUID();
      return {
        args: ["--resume", session, "--fork-session", "--session-id", id, ...(name ? ["--name", name] : [])],
        session: id,
        named: true,
      };
    },
  },
  rename: {
    async channel(session) {
      const peer = await renaming.peerIn(path.join(configDir(), "sessions"), session);
      return peer ? name => renaming.rename(peer, session, name) : null;
    },
  },
  headless: {
    start: at => Claude.start(at, stream_json, null),
    restore: Claude.restore,
  },
  inference: {
    model: "claude-haiku-5-5",
    start: (r, at) => Claude.start({ ...at, cwd: "/tmp" }, summaryArgs(r), { schema: r.schema !== null }),
    restore: Claude.restore,
  },
  launcher: () => import("./launcher").then(m => m.open()),
  history: () => import("./history").then(m => m.open()),
  transcript: {
    ...transcript,
    continuation: (transcript, session) => path.join(path.dirname(transcript), session + ".jsonl"),
    reader: usage.open,
  },
  conversation,
  integration: {
    directory: () => configDir(),
    install: async () => [settings().install()],
    async uninstall() {
      const file = settings(),
        { result } = file.uninstall();
      if (result.outcome === "no_config" || result.outcome === "failed") return [result];
      return [result, ...file.cleanup([file.path + ".corgi-backup"])];
    },
    status: async () => [settings().status()],
    async startup() {
      const hooks = settings().install();
      if (hooks.outcome === "failed") console.error("hook setup:", hooks.error);
    },
    snippet: executable => hooksFile.snippet("claude", events, executable),
  },
};
