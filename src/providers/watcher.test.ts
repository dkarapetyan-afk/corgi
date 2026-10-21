import { test, expect } from "bun:test";
import { adapter } from "../providers";
import { Tracker, PromptWatch } from "../detection";
import type { Known } from "./adapter";
const hook = { session: "s" } as any;
const showing = (session: string) => (session === "s" ? 7 : null);
function known(fields: Partial<Known> = {}): Known {
  return {
    state: "working",
    authoritative: true,
    pending_stop: false,
    permission_review: false,
    prompt: new PromptWatch(),
    ...fields,
  };
}
test("a Claude hook goes to the pane it came from and may make it show its session", () => {
  const watcher = adapter("claude").watch("");
  expect(watcher.route(hook, 3, showing)).toEqual({ pane: 3, binds: true });
  expect(watcher.route(hook, null, showing)).toBeNull();
});
test("a Codex hook goes to the pane that shows its session, whichever pane sent it", () => {
  const watcher = adapter("codex").watch("");
  expect(watcher.route(hook, 3, showing)).toEqual({ pane: 7, binds: false });
  expect(watcher.route({ session: "other" } as any, 3, showing)).toEqual({ pane: 3, binds: false });
});
test("Claude's screen ends a turn its hooks never interrupt once it idles long enough", () => {
  const watcher = adapter("claude").watch(""),
    memory = new Tracker(),
    idle = { id: 1, title: "✳ Task", text: () => "> \n  ? for shortcuts" };
  expect(watcher.read(idle, memory, known(), 100).interrupted).toBe(false);
  expect(watcher.read(idle, memory, known(), 100 + 1500000).interrupted).toBe(true);
  expect(memory.idle_since).toBe(0);
  // A stop still waiting on confirmation is no interrupt.
  expect(watcher.read(idle, memory, known({ pending_stop: true }), 100 + 3000000).interrupted).toBe(false);
});
test("Codex's screen confirms a permission prompt and shows a compaction", () => {
  const watcher = adapter("codex").watch(""),
    memory = new Tracker(),
    prompt = { id: 1, title: "Action Required", text: () => "" },
    compacting = { id: 1, title: "", text: () => "• Compacting context (2s • esc to interrupt)" };
  expect(watcher.read(prompt, memory, known({ permission_review: true }), 0).prompt).toBe(true);
  expect(watcher.read(prompt, memory, known(), 0).prompt).toBeNull();
  expect(watcher.read(compacting, memory, known(), 0).compacting).toBe(true);
  expect(watcher.read(compacting, memory, known(), 0).interrupted).toBe(false);
});
