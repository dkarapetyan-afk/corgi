import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Accounts, Login, Signin } from "../adapter";
import { cached } from "../command_line";
import { field, str } from "../common";
import { configDir } from "./integration";

/** Pi keeps credentials for several model providers in each account folder. */
export function credential(root: string) {
  const auth = cached(root, "auth.json"),
    preferred = str(cached(root, "settings.json"), "defaultProvider");
  const names = [...new Set([preferred, ...Object.keys(auth ?? {})])];
  for (const provider of names) {
    const value = field(auth, provider),
      type = str(value, "type");
    if (type === "api_key" && str(value, "key")) return { provider, value, type };
    if (type === "oauth" && str(value, "access") && str(value, "refresh")) return { provider, value, type };
  }
  return null;
}
export function identity(root: string): Login | null {
  const c = credential(root);
  if (!c) return null;
  const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);
  if (c.type === "api_key")
    return { email: `${c.provider} API key`, id: `${c.provider}:key:${hash(str(c.value, "key"))}` };
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(str(c.value, "access").split(".")[1] ?? "", "base64url").toString());
  } catch {}
  const email =
    str(c.value, "email") || str(claims, "email") || str(field(claims, "https://api.openai.com/profile"), "email");
  const workspace =
    str(c.value, "accountId") || str(field(claims, "https://api.openai.com/auth"), "chatgpt_account_id");
  return {
    email: email || `${c.provider} OAuth`,
    id: `${c.provider}:${str(claims, "sub") || email || workspace || hash(str(c.value, "refresh"))}/${workspace}`,
  };
}
export const signin: Signin = {
  started: text => /\S/.test(text),
  step(text) {
    if (/paste.*(code|url)|enter.*(code|url)/i.test(text)) return "code";
    if (/click.*(link|open)|open.*browser/i.test(text) && /https:\/\//.test(text)) return "browser";
    return "method";
  },
  hints: {
    method: "Type /login, then choose a provider and sign in to the account you're adding.",
    browser: "Finish signing in on the provider's page. Return here if Pi asks for a code or URL.",
    code: "Paste the code or URL requested by Pi.",
  },
  ready: root => identity(root) !== null,
  check: root => ["auth", "check", "--provider", credential(root)?.provider ?? ""],
  // Pi's /logout removes its stored credentials; there is no logout CLI.
  logout(root) {
    try {
      unlinkSync(join(root, "auth.json"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  },
  first: [],
  again: null,
};
export const accounts: Accounts = {
  env: "PI_CODING_AGENT_DIR",
  home: configDir,
  prefix: ".pi-",
  identity,
  shared: {
    dirs: ["skills", "prompts", "themes"],
    files: ["models.json", "keybindings.json"],
  },
  signin,
};
