import { createHash } from "node:crypto";
import { mkdirSync, openSync, readFileSync, writeSync, ftruncateSync, fsyncSync, closeSync } from "node:fs";
import { join } from "node:path";
import { flock } from "../native_bridge";
import { Info, expired, restoreLimits, usage_max_age } from "./account";
import { Text } from "../providers/common";
import { parse, stringify } from "../json";
import * as spend from "./spend";
/** Seconds a folder waits after its read failed. Another folder signed in
 * to the same account may try meanwhile. */
export const cooldown = 300;
export class State {
  info = new Info();
  update(fresh: Info, now: number) {
    const previous = this.info;
    this.info = Object.assign(new Info(), fresh);
    if (fresh.limits !== "none") this.info.usage_fetched_at = now;
    else if (fresh.signed_in === true && previous.limits !== "none") {
      this.info.limits = previous.limits;
      this.info.spend = previous.spend;
      this.info.usage_fetched_at = previous.usage_fetched_at;
    }
  }
  display(now: number) {
    const result = Object.assign(new Info(), this.info);
    if (
      (typeof result.limits === "object" || result.spend !== null) &&
      expired(result.usage_fetched_at, now) &&
      !result.usage_error.len
    )
      result.usage_error = new Text(
        result.usage_fetched_at <= 0 ? "fetch time unknown" : `last success ${usage_max_age / 60}m+ ago`,
      );
    return result;
  }
  failed(reason: string) {
    this.info.usage_error = new Text(reason);
  }
}
function lock(fd: number, operation: number) {
  return flock(fd, operation !== 8);
}

function restoreState(value: any) {
  const state = new State();
  state.info = Object.assign(new Info(), value.info ?? {});
  for (const key of ["account", "plan", "usage_error"] as const)
    state.info[key] = new Text(typeof value.info?.[key] === "string" ? value.info[key] : "");
  state.info.limits = restoreLimits(value.info?.limits ?? "none");
  state.info.spend = spend.restore(value.info?.spend);
  return state;
}
export function Locked<T extends object>(
  make: () => T,
  dir: string,
  restore: (value: any) => T = v => Object.assign(make(), v),
) {
  return class LockedFile {
    constructor(
      public file: number,
      public state: T,
    ) {}
    static async open(kind: string, identity: string, stopping: any = false) {
      if (!process.env.HOME) throw Error("NoHome");
      const root = process.env.XDG_STATE_HOME
        ? join(process.env.XDG_STATE_HOME, "corgi", dir)
        : join(process.env.HOME, ".local", "state", "corgi", dir);
      mkdirSync(root, { recursive: true });
      const digest = createHash("sha256").update(identity).digest("hex");
      const fd = openSync(join(root, `${kind}-${digest}.json`), "a+", 0o600),
        deadline = Date.now() + 10000;
      try {
        while (!lock(fd, 2 | 4)) {
          if (stopping === true || stopping?.aborted || stopping?.load?.() || Date.now() >= deadline)
            throw Error("CacheBusy");
          await Bun.sleep(10);
        }
        let state = make();
        const bytes = readFileSync(fd);
        if (bytes.length > 16384) throw Error("StreamTooLong");
        if (bytes.length)
          try {
            state = restore(parse(bytes.toString()));
          } catch {}
        return new LockedFile(fd, state);
      } catch (error) {
        closeSync(fd);
        throw error;
      }
    }
    save() {
      const bytes = Buffer.from(stringify(this.state));
      ftruncateSync(this.file, 0);
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(this.file, bytes, offset, bytes.length - offset, offset);
      fsyncSync(this.file);
    }
    close() {
      lock(this.file, 8);
      closeSync(this.file);
    }
  };
}
export const Cache = Locked(() => new State(), "account-previews", restoreState);
