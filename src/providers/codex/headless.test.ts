import { test, expect } from "bun:test";
import { Codex } from "./headless";
import type { Stdio } from "../stdio";
/** A Codex client reading `lines` as its app server's output, recording what it writes. */
function client(lines: unknown[], summary = false) {
  const written: unknown[] = [];
  const io = {
    exited: false,
    pid: -1,
    read: () => lines.splice(0),
    write: (value: unknown) => written.push(value),
    wait: async () => {},
    close() {},
    adopt() {},
    save: () => ({ state: {}, handles: [] }),
  } as unknown as Stdio;
  const codex = new Codex(io, "/repo", summary ? { instructions: "x", model: null, schema: null } : null);
  codex.ready = true;
  return { codex, written };
}
test("Codex turns name their thread, turn and outcome", () => {
  const { codex } = client([
    { method: "turn/started", params: { threadId: "a", turn: { id: "t" } } },
    { method: "turn/completed", params: { threadId: "a", turn: { id: "t", status: "interrupted" } } },
  ]);
  expect(codex.take()).toEqual([
    { kind: "turn", session: "a", turn: "t", phase: "started" },
    { kind: "turn", session: "a", turn: "t", phase: "ended", outcome: "interrupted" },
  ]);
  expect(codex.active.size).toBe(0);
});
test("Codex requests keep their ID for the answer", () => {
  const { codex, written } = client([
    { id: 42, method: "item/commandExecution/requestApproval", params: { threadId: "a", command: "ls" } },
    { id: 43, method: "future/method", params: { threadId: "a" } },
  ]);
  expect(codex.take()).toEqual([
    {
      kind: "request",
      session: "a",
      id: "42",
      ask: { tool: true, name: "item/commandExecution/requestApproval", summary: "ls" },
    },
    { kind: "request", session: "a", id: "43", ask: { tool: false, name: "future/method", summary: "" } },
  ]);
  codex.send({ kind: "answer", request: "42", allow: true });
  codex.send({ kind: "answer", request: "43", allow: false, message: "no" });
  expect(written).toEqual([
    { id: 42, result: { decision: "accept" } },
    { id: 43, error: { code: -32000, message: "no" } },
  ]);
  expect(() => codex.send({ kind: "answer", request: "42", allow: true })).toThrow("NoRequest");
});
test("Codex children, tools, writes, answers and usage come through as events", () => {
  const { codex } = client([
    { method: "thread/started", params: { thread: { id: "child", parentThreadId: "parent", agentRole: "Explorer" } } },
    { method: "item/started", params: { threadId: "child", turnId: "t", item: { id: "c", type: "commandExecution" } } },
    {
      method: "item/completed",
      params: {
        threadId: "child",
        turnId: "t",
        item: { id: "f", type: "fileChange", status: "completed", changes: [{ path: "a.ts" }] },
      },
    },
    {
      method: "item/completed",
      params: { threadId: "child", turnId: "t", item: { id: "m", type: "agentMessage", text: "done" } },
    },
    {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "child",
        turnId: "t",
        tokenUsage: { total: { inputTokens: 10, cachedInputTokens: 5, outputTokens: 2 }, last: null },
      },
    },
  ]);
  const events = codex.take();
  expect(events[0]).toEqual({
    kind: "conversation",
    session: "child",
    parent: "parent",
    role: "Explorer",
    shown: false,
  });
  expect(events[1]).toEqual({ kind: "tool", session: "child", turn: "t", id: "c", done: false, wrote: [] });
  expect(events[2]).toEqual({ kind: "tool", session: "child", turn: "t", id: "f", done: true, wrote: ["/repo/a.ts"] });
  expect(events[4]).toEqual({ kind: "message", session: "child", text: "done" });
  expect(events[5]).toMatchObject({ kind: "usage", session: "child", turn: "t", total: { last: null } });
  expect((events[5] as any).total.total).toMatchObject({ input: 10n, cached_input: 5n, output: 2n });
});
test("a summary hears only its own thread", () => {
  const { codex } = client(
    [
      { method: "item/completed", params: { threadId: "other", item: { type: "agentMessage", text: "stale" } } },
      { method: "item/completed", params: { threadId: "mine", item: { type: "agentMessage", text: "fresh" } } },
    ],
    true,
  );
  codex.thread = "mine";
  expect(codex.take().filter(e => e.kind === "message")).toEqual([{ kind: "message", session: "mine", text: "fresh" }]);
});
test("a prompt starts a thread in the session's folder, then its turn", () => {
  const lines: unknown[] = [];
  const { codex, written } = client(lines);
  codex.send({ kind: "prompt", text: "hi" });
  expect(written).toEqual([{ id: 1n, method: "thread/start", params: { cwd: "/repo" } }]);
  lines.push({ id: 1, result: { thread: { id: "t" } } });
  expect(codex.take()).toEqual([{ kind: "conversation", session: "t", parent: null, role: null, shown: true }]);
  expect(written[1]).toEqual({
    id: 2n,
    method: "turn/start",
    params: { threadId: "t", input: [{ type: "text", text: "hi" }] },
  });
});
test("prompts wait for the handshake, which a handoff can carry over", () => {
  const lines: unknown[] = [];
  const { codex, written } = client(lines);
  codex.ready = false;
  codex.steps.set("7", { kind: "initialize" });
  codex.send({ kind: "prompt", text: "early", session: "t" });
  expect(written).toEqual([]);
  const restored = Codex.restore(
    JSON.parse(JSON.stringify(codex.save(true), (_, v) => (typeof v === "bigint" ? Number(v) : v))),
    true,
  );
  expect(restored.deferred).toEqual([{ kind: "prompt", text: "early", session: "t" }]);
  expect(restored.steps.get("7")).toEqual({ kind: "initialize" });
});
