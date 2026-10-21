//! Codex's past sessions, listed by its app server and brought up to date
//! from the tails of their rollouts.
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { SessionHistory } from "../adapter";
import { Cache, cached, copied, directory, readAt, records, typed, type Entry } from "../../launch/history";
import { configDir } from "./index";
import * as appServer from "./app_server";
/** The last prompt a rollout's tail shows the user typing, and whether the turn after it was aborted. */
export function tail(text: string, mid = false) {
  let last = "",
    interrupted = false;
  for (const v of records(text, mid)) {
    if (v.payload?.type === "turn_aborted") interrupted = true;
    else if (v.type === "response_item" && v.payload?.type === "message" && v.payload?.role === "user") {
      const t = (v.payload.content ?? []).map((p: any) => p.text ?? "").join(" ");
      if (typed(t)) {
        last = t;
        interrupted = false;
      }
    }
  }
  return { last, interrupted };
}
async function read(path: string, s: any): Promise<Entry | null> {
  let span = 65536;
  for (;;) {
    const start = Math.max(0, s.size - span),
      t = tail(await readAt(path, start, s.size - start), start > 0);
    if (!t.last && start > 0 && span < 2 * 1024 * 1024) {
      span *= 2;
      continue;
    }
    return copied({
      provider: "codex",
      session: "",
      title: "",
      first: "",
      cwd: "",
      branch: "",
      updated_at: 0,
      ...t,
    });
  }
}
/** A thread as `thread/list` reports it. */
function thread(item: any): Entry {
  return {
    provider: "codex",
    session: item.id,
    title: item.name ?? "",
    first: item.preview,
    last: item.preview,
    cwd: item.cwd,
    branch: item.gitInfo?.branch ?? "",
    updated_at: item.updatedAt ?? 0,
    interrupted: false,
  };
}
export function open(): SessionHistory {
  const server = new appServer.AppServer(5000),
    cache = new Cache(),
    rollouts = new Map<string, string>();
  return {
    roots: () => [configDir()],
    async list(stopping) {
      const sessions: Entry[] = [];
      try {
        let cursor: string | null = null;
        for (let page = 0; page < 10 && !stopping(); page++) {
          const reply = await appServer.threads(server, cursor, { load: stopping }),
            result = reply.result;
          for (const item of result.data ?? []) {
            if (!item.id || !item.preview || !item.cwd) continue;
            const e = thread(item);
            if (item.path && isAbsolute(item.path)) {
              rollouts.set(item.path, item.id);
              const summary = await cached(cache, item.path, read);
              if (summary) {
                e.last = summary.last || e.last;
                e.interrupted = summary.interrupted;
              }
            }
            sessions.push(copied(e));
          }
          cursor = result.nextCursor;
          if (!cursor) break;
        }
        return { sessions, complete: true };
      } catch {
        return { sessions, complete: false };
      } finally {
        cache.sweep();
      }
    },
    async changed(paths, store, stopping) {
      let relist = false;
      for (const path of paths) {
        const session = rollouts.get(path);
        if (session) {
          const old = store.get("codex", session);
          if (!old) {
            relist = true;
            continue;
          }
          try {
            const metadata = await stat(path),
              summary = await cached(cache, path, read);
            if (summary)
              store.put({
                ...old,
                last: summary.last || old.last,
                interrupted: summary.interrupted,
                updated_at: Math.max(old.updated_at, Math.floor(metadata.mtimeMs / 1000)),
              });
          } catch {
            store.remove("codex", session);
          }
        } else if (path.endsWith("session_index.jsonl") || path.includes("/sessions/")) relist = true;
      }
      if (!relist) return;
      try {
        for (const item of (await appServer.threads(server, null, { load: stopping })).result?.data ?? []) {
          if (!item.id || !item.preview || !item.cwd) continue;
          const summary = item.path ? await cached(cache, item.path, read) : null;
          if (item.path) rollouts.set(item.path, item.id);
          const e = thread(item);
          e.last = summary?.last || item.preview;
          e.interrupted = summary?.interrupted ?? false;
          if (await directory(e.cwd)) store.put(e);
        }
      } catch {}
    },
    close: () => server.close(),
  };
}
