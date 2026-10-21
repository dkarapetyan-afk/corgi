//! A provider that exists only in tests. Code that assumes every provider is
//! Claude or Codex gives it their answers, which its own tell apart.
import { Provider } from "../../providers";
import type { Adapter } from "../adapter";
import { configHome, Hooks, sharedPrompt } from "../common";
import { ScreenWatcher } from "../watcher";
import * as hooksFile from "../hooks_file";
import * as commandLine from "../command_line";
const events = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"],
  configDir = (env = process.env) => configHome(env, "SIM_HOME", ".sim"),
  settings = () => new hooksFile.File("sim", configDir(), "hooks.json", events),
  hooks = new Hooks();
export const adapter: Adapter = {
  id: "sim",
  label: "Simulated Agent",
  name: "Sim",
  glyph: "§",
  launcher_key: "z",
  command: "sim",
  caps: {
    prompt_turns: true,
    children_at_stop: false,
    follows_cd: true,
    titles_once_loaded: false,
    transcript_tools: false,
  },
  owns: p => p.split("/").at(-1) === "sim",
  inspect: c =>
    commandLine.inspect(c, {
      config_env: "SIM_HOME",
      account_home: ".sim",
      yolo: "--unattended",
      profile_flags: [],
      settings_flags: [],
      credential_env: ["SIM_API_KEY"],
      endpoint_env: [],
      provider_env: [],
      account: () => null,
    }),
  installs: ({ home }) => (home ? [home + "/.local/bin/sim"] : []),
  watch: () => new ScreenWatcher((_title, text) => sharedPrompt(text)),
  hook: v => hooks.decode(v),
  launch: {
    start: s => [
      ...(s.permissions === "bypass" ? ["--unattended"] : []),
      ...(s.model ? ["--model", s.model] : []),
      ...s.args,
    ],
    resume: session => ["--continue", session],
    fork: ({ session }, name) => ({
      args: ["--branch", session, ...(name ? ["--title", name] : [])],
      session: null,
      named: true,
    }),
  },
  inference: {
    model: "sim-small",
    start: () => {
      throw Error("Unsupported");
    },
    restore: () => {
      throw Error("Unsupported");
    },
  },
  integration: {
    directory: () => configDir(),
    install: async () => [settings().install()],
    uninstall: async () => [settings().uninstall().result],
    status: async () => [settings().status()],
    startup: async () => void settings().install(),
    snippet: executable => hooksFile.snippet("sim", events, executable),
  },
};
export const sim = "sim" as Provider;
/** Adds Sim to the registry until the returned function runs. */
export function register(): () => void {
  return Provider.register(adapter);
}
