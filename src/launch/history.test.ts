import { test, expect } from "bun:test";
import { clip, Worker, type Entry } from "./history";
test("clip keeps one line within its byte limit at a UTF-8 boundary", () => {
  const out = clip("  a\tb\n\nc\x1b é", 7);
  expect(out.slice(0, 6)).toBe("a b c ");
  expect(Buffer.byteLength(out)).toBeLessThanOrEqual(7);
});
test("a viewer gets everything once, then only what changed, and everything from another daemon", () => {
  const w = new Worker();
  w.epoch = 5n;
  w.ready = true;
  const first: Entry = {
      provider: "claude",
      session: "a",
      title: "First",
      first: "",
      last: "",
      cwd: "/w",
      branch: "",
      updated_at: 1,
      interrupted: false,
    },
    second = {
      ...first,
      provider: "codex" as const,
      session: "b",
      title: "Second",
      updated_at: 2,
    };
  w.store.replace([first, second], ["claude", "codex"]);
  const full = w.update(0n, 0n)!;
  expect(full.full).toBe(true);
  expect(full.entries[0].title).toBe("Second");
  expect(w.update(full.epoch, full.revision)).toBeNull();
  w.store.put(first);
  expect(w.update(full.epoch, full.revision)).toBeNull();
  w.store.put({ ...first, last: "one more thing", updated_at: 9 });
  w.store.remove("codex", "b");
  const delta = w.update(full.epoch, full.revision)!;
  expect(delta.full).toBe(false);
  expect(delta.entries[0].last).toBe("one more thing");
  expect(delta.removed[0].session).toBe("b");
  expect(w.update(4n, delta.revision)!.full).toBe(true);
  w.store.put(second);
  w.store.replace([], ["claude"]);
  expect(w.store.get("codex", "b")).not.toBeNull();
  expect(w.store.get("claude", "a")).toBeNull();
  w.stop();
});
