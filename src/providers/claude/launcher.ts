//! What the launcher shows about Claude Code: its account and usage through
//! its control channel, and the model its settings choose.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Launcher } from "../adapter";
import { Client } from "./account";
import { configDir } from "./index";
import { vocabulary } from "./info";
function readModel(root: string, relative: string): string | null {
  try {
    const file = join(root, relative),
      s = statSync(file);
    if (!s.isFile() || s.size > 1024 * 1024) return null;
    const model = JSON.parse(readFileSync(file, "utf8"))?.model;
    return typeof model === "string" && model ? model : null;
  } catch {
    return null;
  }
}
/** The model Claude Code's settings choose in `cwd`, and the setting that won. */
export function settingsModel(cwd: string, env = process.env) {
  let chosen = { model: "", source: "Account default / provider selection" };
  const read = (root: string, relative: string, source: string) => {
    const model = readModel(root, relative);
    if (model) chosen = { model, source };
  };
  try {
    read(configDir(env), "settings.json", "User settings");
  } catch {}
  read(cwd, ".claude/settings.json", "Project settings (if trusted)");
  read(cwd, ".claude/settings.local.json", "Local settings (if trusted)");
  if (env.ANTHROPIC_MODEL) chosen = { model: env.ANTHROPIC_MODEL, source: "ANTHROPIC_MODEL" };
  read("/Library/Application Support/ClaudeCode", "managed-settings.json", "Managed settings");
  return chosen;
}
export function open(account: string): Launcher {
  const env = account ? { ...process.env, [vocabulary.config_env]: account } : process.env,
    client = new Client(env);
  return {
    account: quit => client.preview(quit, quit),
    async model(cwd) {
      const chosen = settingsModel(cwd, env);
      if (chosen.model || !client.default_model.len) return chosen;
      return { model: client.default_model.text(), source: "Claude Code default" };
    },
    close: () => client.close(),
  };
}
