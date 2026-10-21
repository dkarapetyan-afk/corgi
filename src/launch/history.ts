import { stat, open } from "node:fs/promises";
import { watch, FSWatcher } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Provider, adapter } from "../providers";
import type { SessionHistory } from "../providers/adapter";
export type Entry = {
  provider: Provider;
  session: string;
  title: string;
  first: string;
  last: string;
  cwd: string;
  branch: string;
  updated_at: number;
  interrupted: boolean;
};
export type History = { pending: boolean; entries: Entry[] };
export const capacity = 1000;
export function clip(text: string, limit: number) {
  const bytes = Buffer.from(text),
    out: number[] = [];
  let space = false;
  for (const ch of bytes) {
    if ([32, 9, 10, 13].includes(ch)) {
      space = out.length > 0;
      continue;
    }
    if (ch < 32 || ch === 127) continue;
    if (out.length + Number(space) >= limit) break;
    if (space) out.push(32);
    space = false;
    out.push(ch);
  }
  let b = Buffer.from(out);
  while (b.length) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch {
      b = b.subarray(0, b.length - 1);
    }
  }
  return "";
}
export const copied = (e: Entry): Entry => ({
  ...e,
  title: clip(e.title, 120),
  first: clip(e.first, 200),
  last: clip(e.last, 200),
  branch: clip(e.branch, 80),
});
export function clone(e: Entry) {
  return { ...e };
}
export function typed(text: string) {
  const s = text.replace(/^[ \n\t]+/, "");
  return (
    !!s &&
    ![
      "<command-",
      "<local-command",
      "<system-reminder",
      "<task-notification",
      "<bash-",
      "Caveat:",
      "[Request interrupted",
      "This session is being continued",
      "/",
      "◯",
      "# AGENTS.md",
      "<environment_context",
      "<user_instructions",
      "<turn_aborted",
      "<user_shell_command",
    ].some(p => s.startsWith(p))
  );
}
export function complete(bytes: string, mid: boolean) {
  const start = mid ? (bytes.indexOf("\n") < 0 ? bytes.length : bytes.indexOf("\n") + 1) : 0,
    end = bytes.lastIndexOf("\n");
  return bytes.slice(start, Math.max(start, end));
}
export const records = (s: string, mid = false) =>
  complete(s, mid)
    .split("\n")
    .flatMap(l => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
export class Cache {
  files = new Map<string, { stamp: string; entry: Entry | null; seen: boolean }>();
  lookup(path: string, s: any) {
    const c = this.files.get(path);
    if (c) c.seen = true;
    return c?.stamp === stamp(s) ? c : null;
  }
  store(path: string, s: any, entry: Entry | null) {
    this.files.set(path, { stamp: stamp(s), entry, seen: true });
    return entry;
  }
  sweep() {
    for (const [p, c] of this.files)
      if (!c.seen) this.files.delete(p);
      else c.seen = false;
  }
}
const stamp = (s: any) => `${s.ino}:${s.size}:${s.mtimeMs}`;
export async function readAt(path: string, offset: number, len: number) {
  const f = await open(path);
  try {
    const b = Buffer.alloc(len),
      { bytesRead } = await f.read(b, 0, len, offset);
    return b.subarray(0, bytesRead).toString();
  } finally {
    await f.close();
  }
}
/** The entry `read` makes of the file at `path`, kept until the file changes. */
export async function cached(cache: Cache, path: string, read: (path: string, s: any) => Promise<Entry | null>) {
  try {
    const s = await stat(path);
    if (!s.isFile()) return null;
    const c = cache.lookup(path, s);
    return c ? c.entry : cache.store(path, s, await read(path, s));
  } catch {
    return null;
  }
}
export async function directory(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
export class Store {
  items = new Map<string, { entry: Entry; revision: bigint }>();
  gone: { provider: Provider; session: string; revision: bigint }[] = [];
  revision = 0n;
  forgot = 0n;
  get(p: Provider, s: string) {
    return this.items.get(p + ":" + s)?.entry ?? null;
  }
  put(e: Entry) {
    const key = e.provider + ":" + e.session;
    if (Buffer.byteLength(key) > 512) return;
    const old = this.items.get(key);
    if (old && JSON.stringify(old.entry) === JSON.stringify(e)) return;
    this.items.set(key, { entry: copied(e), revision: ++this.revision });
  }
  remove(p: Provider, s: string) {
    if (!this.items.delete(p + ":" + s)) return;
    this.revision++;
    if (this.gone.length === 256) this.forgot = this.gone.shift()!.revision;
    this.gone.push({ provider: p, session: s, revision: this.revision });
  }
  replace(found: Entry[], read: Provider[]) {
    const seen = new Set(found.map(e => e.provider + ":" + e.session));
    for (const e of found) this.put(e);
    for (const [key, item] of this.items)
      if (read.includes(item.entry.provider) && !seen.has(key)) this.remove(item.entry.provider, item.entry.session);
  }
}
export type Update = {
  epoch: bigint;
  revision: bigint;
  full: boolean;
  entries: Entry[];
  removed: { provider: Provider; session: string }[];
};
export class Worker {
  store = new Store();
  ready = false;
  /** Where each provider's roots changed since it last looked. */
  changed = new Map<Provider, Set<string>>();
  epoch = randomBytes(8).readBigUInt64LE() | 1n;
  stopping = false;
  histories = new Map<Provider, Promise<SessionHistory | null>>();
  watchers: FSWatcher[] = [];
  timer: ReturnType<typeof setTimeout> | null = null;
  refreshing: Promise<void> | null = null;
  static start() {
    const w = new Worker();
    void w.refresh();
    void w.startWatching();
    return w;
  }
  async stop() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    for (const watcher of this.watchers) watcher.close();
    for (const history of this.histories.values()) void history.then(h => h?.close());
    await this.refreshing;
  }
  /** A provider's history, opened on first use. */
  history(p: Provider) {
    let history = this.histories.get(p);
    if (!history) this.histories.set(p, (history = adapter(p).history?.() ?? Promise.resolve(null)));
    return history;
  }
  snapshot(): History {
    return {
      pending: !this.ready,
      entries: [...this.store.items.values()].map(i => clone(i.entry)).sort((a, b) => b.updated_at - a.updated_at),
    };
  }
  update(epoch: bigint, revision: bigint): Update | null {
    if (!this.ready) return null;
    const full = epoch !== this.epoch || revision < this.store.forgot;
    if (!full && revision === this.store.revision) return null;
    return {
      epoch: this.epoch,
      revision: this.store.revision,
      full,
      entries: [...this.store.items.values()]
        .filter(i => full || i.revision > revision)
        .map(i => clone(i.entry))
        .sort((a, b) => b.updated_at - a.updated_at),
      removed: full
        ? []
        : this.store.gone.filter(g => g.revision > revision).map(({ provider, session }) => ({ provider, session })),
    };
  }
  async startWatching() {
    for (const p of Provider.all) {
      const history = await this.history(p);
      if (this.stopping) return;
      for (const root of history?.roots() ?? [])
        try {
          this.watchers.push(
            watch(root, { recursive: true }, (_event, file) => {
              if (file) {
                const paths = this.changed.get(p) ?? new Set();
                this.changed.set(p, paths.add(join(root, file.toString())));
              }
              if (this.timer) clearTimeout(this.timer);
              this.timer = setTimeout(() => void this.readChanged(), 1000);
            }),
          );
        } catch {}
    }
    if (!this.watchers.length) {
      this.timer = setTimeout(() => {
        void this.refresh();
        void this.startWatching();
      }, 300000);
      this.timer.unref();
    }
  }
  async readChanged() {
    if (this.stopping) return;
    if (this.refreshing) await this.refreshing;
    const changes = [...this.changed];
    this.changed.clear();
    for (const [p, paths] of changes)
      await (await this.history(p))?.changed([...paths], this.store, () => this.stopping);
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.read().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
  async read() {
    const found: Entry[] = [],
      read: Provider[] = [];
    for (const p of Provider.all) {
      const history = await this.history(p);
      if (!history || this.stopping) continue;
      const { sessions, complete } = await history.list(() => this.stopping);
      found.push(...sessions);
      if (complete) read.push(p);
    }
    const kept: Entry[] = [];
    for (const e of found) if (await directory(e.cwd)) kept.push(e);
    this.store.replace(kept.sort((a, b) => b.updated_at - a.updated_at).slice(0, capacity), read);
    this.ready = true;
  }
}
