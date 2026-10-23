import { test, expect } from "bun:test";
import { Pi, summaryArgs } from "./headless";
import type { Stdio } from "../stdio";
function client() {
  const lines: unknown[] = [],
    written: unknown[] = [];
  const io = {
    exited: false,
    pid: -1,
    read: () => lines.splice(0),
    write: (v: unknown) => written.push(v),
    save: () => ({ state: {}, handles: [] }),
  } as unknown as Stdio;
  const c = new Pi(io, "/tmp");
  lines.push({ type: "response", id: "corgi-state", success: true, data: { sessionId: "s" } });
  c.take();
  return { c, lines, written, io };
}
test("Pi waits through retries and queued runs until settlement", () => {
  const { c, lines } = client();
  lines.push(
    { type: "agent_start" },
    { type: "message_end", message: { role: "assistant", stopReason: "error" } },
    { type: "agent_end", willRetry: true },
    { type: "agent_start" },
  );
  expect(c.take().filter(e => e.kind === "turn")).toHaveLength(1);
  const turn = c.turn;
  lines.push(
    {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "done" }],
        usage: { input: 2, output: 3, cacheRead: 5, cacheWrite: 7 },
      },
    },
    { type: "agent_end" },
  );
  const events = c.take();
  expect(events).toContainEqual({ kind: "message", session: "s", text: "done" });
  expect(events.find(e => e.kind === "usage")).toMatchObject({
    part: { tokens: { input: 14n, cached_input: 5n, output: 3n } },
  });
  expect(events.some(e => e.kind === "turn")).toBe(false);
  lines.push({ type: "agent_settled" }, { type: "agent_settled" });
  expect(c.take()).toEqual([{ kind: "turn", session: "s", turn, phase: "ended", outcome: "completed" }]);
});
test("Pi stops queued work and reports interruptions on 1.0 and later", () => {
  for (const settled of [{ type: "agent_settled" }, { type: "agent_settled", aborted: true }]) {
    const { c, lines, written } = client();
    lines.push({ type: "agent_start" });
    c.take();
    c.send({ kind: "interrupt", session: "s" });
    expect(written.map((v: any) => v.type)).toEqual(["clear_queue"]);
    lines.push({ type: "response", id: (written[0] as any).id, success: true });
    c.take();
    expect(written.map((v: any) => v.type)).toEqual(["clear_queue", "abort"]);
    lines.push(settled);
    expect(c.take()[0]).toMatchObject({ outcome: "interrupted" });
  }
});
test("Pi's error and truncated final answers fail at settlement", () => {
  for (const stopReason of ["error", "length", "aborted"]) {
    const { c, lines } = client();
    lines.push(
      { type: "agent_start" },
      { type: "message_end", message: { role: "assistant", stopReason } },
      { type: "agent_settled" },
    );
    expect(c.take().at(-1)).toMatchObject({ outcome: stopReason === "aborted" ? "interrupted" : "failed" });
  }
});
test("Pi dialogs validate answers and ignore notifications", () => {
  const { c, lines, written } = client();
  lines.push(
    { type: "extension_ui_request", id: "a", method: "notify" },
    { type: "extension_ui_request", id: "b", method: "confirm", title: "Continue?" },
    { type: "extension_ui_request", id: "c", method: "select", options: ["one", "two"] },
  );
  expect(c.take().map(e => e.kind)).toEqual(["request", "request"]);
  c.send({ kind: "answer", request: "b", allow: false });
  expect(written[0]).toEqual({ type: "extension_ui_response", id: "b", confirmed: false });
  expect(() => c.send({ kind: "answer", request: "c", allow: true })).toThrow("AnswerRequired");
  expect(() => c.send({ kind: "answer", request: "c", allow: true, message: "wrong" })).toThrow("InvalidAnswer");
  c.send({ kind: "answer", request: "c", allow: true, message: "two" });
  expect(written[1]).toEqual({ type: "extension_ui_response", id: "c", value: "two" });
  expect(() => c.send({ kind: "answer", request: "c", allow: true, message: "two" })).toThrow("NoRequest");
});
test("Pi rejects wrong sessions and RPC failures", () => {
  const { c, lines } = client();
  expect(() => c.send({ kind: "prompt", session: "other", text: "x" })).toThrow("WrongSession");
  lines.push({ type: "response", success: false, error: "no model" });
  expect(() => c.take()).toThrow("PiRejected");
});
test("Pi tool writes survive a handoff state and failed writes stay unreported", () => {
  const { c, lines } = client();
  lines.push(
    { type: "agent_start" },
    { type: "tool_execution_start", toolCallId: "w", toolName: "write", args: { path: "out" } },
  );
  c.take();
  const restored = Pi.restore(c.save(false), false);
  expect(restored.writes.get("w")).toEqual(["/tmp/out"]);
  lines.push({ type: "tool_execution_end", toolCallId: "w", isError: true });
  expect(c.take()[0]).toMatchObject({ wrote: [] });
});
test("Pi summaries disable discovered code, context and tools", () => {
  const args = summaryArgs({ instructions: "hello", model: "openai-codex/gpt-6-luna", schema: '{"type":"object"}' });
  for (const flag of [
    "--no-session",
    "--no-extensions",
    "--no-tools",
    "--no-context-files",
    "--no-skills",
    "--no-approve",
  ])
    expect(args).toContain(flag);
});
test("Pi serializes prompt acceptance before clearing its queue", () => {
  const { c, lines, written } = client();
  c.send({ kind: "prompt", text: "queued" });
  c.send({ kind: "interrupt" });
  expect(written.map((v: any) => v.type)).toEqual(["prompt"]);
  lines.push({
    type: "response",
    id: (written[0] as any).id,
    command: "prompt",
    success: true,
    data: { disposition: "queued" },
  });
  c.take();
  expect(written.map((v: any) => v.type)).toEqual(["prompt", "clear_queue"]);
  lines.push({ type: "response", id: (written[1] as any).id, success: true });
  c.take();
  expect(written.map((v: any) => v.type)).toEqual(["prompt", "clear_queue", "abort"]);
});
test("Pi closes expired dialogs and cancels a dialog before interrupting its command", () => {
  const { c, lines, written } = client();
  lines.push({ type: "extension_ui_request", id: "expired", method: "confirm", timeout: 0 });
  expect(c.take().map(e => e.kind)).toEqual(["request", "request_closed"]);
  lines.push({ type: "extension_ui_request", id: "open", method: "input" });
  c.take();
  c.send({ kind: "interrupt" });
  expect(written[0]).toEqual({ type: "extension_ui_response", id: "open", cancelled: true });
  expect(c.take()).toContainEqual({ kind: "request_closed", id: "open", session: "s", running: false });
});
