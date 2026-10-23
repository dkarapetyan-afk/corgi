//! Remember exact session files, including Pi's per-command --session-dir.
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { atomicWrite } from "../../os";
import { directory as configDirectory } from "./integration";
import { str } from "../common";
export const directory = () => join(configDirectory(), "corgi-history");
export function canonical(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
export const accountKey = (account = "") => canonical(configDirectory(account));
const file = (session: string) => join(directory(), createHash("sha256").update(session).digest("hex") + ".json");
function read(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
export function remember(session: string, transcript: string, account = "") {
  if (!session || !isAbsolute(transcript) || !transcript.endsWith(".jsonl")) return;
  try {
    atomicWrite(file(session), JSON.stringify({ session, transcript, account: accountKey(account) }), 0o600, false);
  } catch {}
}
export function locate(session: string, account = "") {
  const v = read(file(session)),
    transcript = str(v, "transcript");
  return str(v, "session") === session && isAbsolute(transcript) && owner(v) === accountKey(account)
    ? transcript
    : session;
}
const owner = (v: unknown) => accountKey(str(v, "account"));
export function all(): { session: string; transcript: string; account: string }[] {
  try {
    return readdirSync(directory()).flatMap(name => {
      if (!name.endsWith(".json")) return [];
      const v = read(join(directory(), name)),
        session = str(v, "session"),
        transcript = str(v, "transcript");
      return session && isAbsolute(transcript) ? [{ session, transcript, account: owner(v) }] : [];
    });
  } catch {
    return [];
  }
}
export function known(account = "") {
  return all().filter(v => v.account === accountKey(account));
}
export function sessionRoots(account = "") {
  const configured =
    process.env.PI_CODING_AGENT_SESSION_DIR || str(read(join(configDirectory(account), "settings.json")), "sessionDir");
  const expanded = configured.startsWith("~/") ? join(process.env.HOME || "", configured.slice(2)) : configured;
  return [expanded ? resolve(expanded) : join(configDirectory(account), "sessions")];
}
