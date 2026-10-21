import type { Caps, Info } from "../adapter";
import type { Keeping, Vocabulary } from "../command_line";
import { cached } from "../command_line";
export const info: Info = {
  id: "codex",
  label: "Codex",
  name: "Codex",
  glyph: "†",
  launcher_key: "c",
  command: "codex",
};
export const caps: Caps = {
  prompt_turns: false,
  children_at_stop: false,
  follows_cd: false,
  titles_once_loaded: true,
  transcript_tools: true,
};
/** How its command line chooses a model, an account and its permission checks. */
export const vocabulary: Vocabulary = {
  config_env: "CODEX_HOME",
  account_home: ".codex",
  yolo: "--dangerously-bypass-approvals-and-sandbox",
  profile_flags: ["--profile", "-p"],
  settings_flags: ["--settings", "-c", "--config"],
  credential_env: ["OPENAI_API_KEY"],
  endpoint_env: ["OPENAI_BASE_URL"],
  provider_env: [],
  account(root) {
    const auth = cached(root, "auth.json");
    if (!auth) return null;
    if (auth.OPENAI_API_KEY) return "Profile API key - identity unavailable";
    try {
      const email = JSON.parse(Buffer.from(auth.tokens?.id_token?.split(".")[1] ?? "", "base64url").toString()).email;
      return email ? `${email} (cached)` : null;
    } catch {
      return null;
    }
  },
};
/** What a resume or fork keeps of a typed `codex` command. Approval and
 * sandbox options stay, since its hooks can't tell them apart. */
export const keeping: Keeping = {
  drop: [
    "--model",
    "-m",
    "--dangerously-bypass-approvals-and-sandbox",
    "--yolo",
    "--image",
    "-i",
    "--last",
    "--all",
    "--version",
    "-V",
    "--help",
    "-h",
  ],
  flags: [
    "--dangerously-bypass-approvals-and-sandbox",
    "--yolo",
    "--full-auto",
    "--oss",
    "--search",
    "--no-alt-screen",
    "--last",
    "--all",
    "--version",
    "-V",
    "--help",
    "-h",
  ],
  env: /^(HOME|CODEX_HOME|CODEX_SQLITE_HOME|OPENAI_\w+|AZURE_OPENAI_\w+)$/,
};
