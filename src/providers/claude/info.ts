import type { Caps, Info } from "../adapter";
import type { Keeping, Vocabulary } from "../command_line";
import { cached } from "../command_line";
export const info: Info = {
  id: "claude",
  label: "Claude Code",
  name: "Claude",
  glyph: "*",
  launcher_key: "l",
  command: "claude",
};
export const caps: Caps = {
  prompt_turns: true,
  children_at_stop: true,
  follows_cd: true,
  titles_once_loaded: false,
  transcript_tools: false,
};
/** How its command line chooses a model, an account and its permission checks. */
export const vocabulary: Vocabulary = {
  config_env: "CLAUDE_CONFIG_DIR",
  account_home: ".",
  model_env: "ANTHROPIC_MODEL",
  yolo: "--dangerously-skip-permissions",
  profile_flags: ["--profile"],
  settings_flags: ["--settings"],
  credential_env: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  oauth_env: "CLAUDE_CODE_OAUTH_TOKEN",
  endpoint_env: ["ANTHROPIC_BASE_URL"],
  provider_env: [
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
    "CLAUDE_CODE_USE_MANTLE",
    "CLAUDE_CODE_USE_GATEWAY",
  ],
  account(root) {
    const email = cached(root, ".claude.json")?.oauthAccount?.emailAddress;
    return email ? `${email} (cached)` : null;
  },
};
/** What a resume or fork keeps of a typed `claude` command. */
export const keeping: Keeping = {
  drop: [
    "--resume",
    "-r",
    "--continue",
    "-c",
    "--session-id",
    "--fork-session",
    "--name",
    "-n",
    "--model",
    "--permission-mode",
    "--dangerously-skip-permissions",
    "--print",
    "-p",
    "--output-format",
    "--input-format",
    "--version",
    "-v",
    "--help",
    "-h",
  ],
  flags: [
    "--continue",
    "-c",
    "--fork-session",
    "--dangerously-skip-permissions",
    "--allow-dangerously-skip-permissions",
    "--print",
    "-p",
    "--verbose",
    "--ide",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--include-partial-messages",
    "--replay-user-messages",
    "--chrome",
    "--no-chrome",
    "--safe-mode",
    "--mcp-debug",
    "--disable-slash-commands",
    "--version",
    "-v",
    "--help",
    "-h",
  ],
  env: /^(HOME|CLAUDE_CONFIG_DIR|ANTHROPIC_(?!MODEL$)\w+|CLAUDE_CODE_(?!ENTRYPOINT$|SESSION_KIND$)\w+|AWS_\w+|CLOUD_ML_REGION|VERTEX_\w+|DISABLE_\w+|MCP_\w+|MAX_THINKING_TOKENS)$/,
};
