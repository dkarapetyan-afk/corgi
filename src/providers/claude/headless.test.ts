import { test, expect } from "bun:test";
import { Claude } from "./headless";
import type { Stdio } from "../stdio";
/** A Claude client reading `lines` as its output, recording what it writes. */
function client(lines: unknown[], summary: { schema: boolean } | null = null) {
  const written: unknown[] = [];
  const io = {
    exited: false,
    pid: -1,
    read: () => lines.splice(0),
    write: (value: unknown) => written.push(value),
    wait: async () => {},
    close() {},
    adopt() {},
  } as unknown as Stdio;
  return { claude: new Claude(io, summary, !summary), written };
}
const usage = { input_tokens: 10, cache_read_input_tokens: 30, cache_creation_input_tokens: 20, output_tokens: 5 };
test("Claude's stream names its session, turns, tools, usage and messages", () => {
  const { claude } = client([
    { type: "system", subtype: "init", session_id: "a" },
    {
      type: "assistant",
      session_id: "a",
      message: { id: "m1", usage, content: [{ type: "tool_use", id: "x", name: "Bash", input: {} }] },
    },
    { type: "user", session_id: "a", message: { content: [{ type: "tool_result", tool_use_id: "x" }] } },
    { type: "assistant", session_id: "a", message: { id: "m2", content: [{ type: "text", text: "done" }] } },
    { type: "result", session_id: "a", subtype: "success" },
    { type: "result", session_id: "a", subtype: "error_during_execution", is_error: true },
  ]);
  const events = claude.take();
  expect(events.map(e => e.kind)).toEqual(["conversation", "turn", "usage", "tool", "tool", "message", "turn", "turn"]);
  expect(events[2]).toMatchObject({ kind: "usage", part: { id: "m1", tokens: { input: 60n, cached_input: 30n } } });
  expect(events[5]).toEqual({ kind: "message", session: "a", text: "done" });
  expect(events[6]).toEqual({ kind: "turn", session: "a", turn: "", phase: "ended", outcome: "completed" });
  expect(events[7]).toMatchObject({ outcome: "failed" });
});
test("Claude's tool requests are answered with the input they asked about", () => {
  const input = { command: "rm -rf build" };
  const { claude, written } = client([
    { type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input } },
    { type: "control_request", request_id: "r2", request: { subtype: "can_use_tool", tool_name: "Edit", input: {} } },
  ]);
  expect(claude.take()).toEqual([
    { kind: "request", session: "", id: "r1", ask: { tool: true, name: "Bash", summary: "rm -rf build" } },
    { kind: "request", session: "", id: "r2", ask: { tool: true, name: "Edit", summary: "" } },
  ]);
  claude.send({ kind: "answer", request: "r1", allow: true });
  claude.send({ kind: "answer", request: "r2", allow: false });
  expect(written).toEqual([
    {
      type: "control_response",
      response: { subtype: "success", request_id: "r1", response: { behavior: "allow", updatedInput: input } },
    },
    {
      type: "control_response",
      response: { subtype: "success", request_id: "r2", response: { behavior: "deny", message: "Denied" } },
    },
  ]);
});
test("a summary waits for its handshake and answers with its result", () => {
  const { claude, written } = client(
    [
      { type: "control_response", response: { subtype: "success", request_id: "corgi-initialize" } },
      { type: "assistant", message: { id: "m", usage, content: [{ type: "text", text: "thinking" }] } },
      { type: "result", subtype: "success", result: "plain", structured_output: { label: "x" }, usage },
    ],
    { schema: true },
  );
  expect(claude.ready).toBe(false);
  const events = claude.take();
  expect(claude.ready).toBe(true);
  expect(events.filter(e => e.kind === "message")).toEqual([{ kind: "message", session: "", text: '{"label":"x"}' }]);
  expect(events.filter(e => e.kind === "usage")).toHaveLength(1);
  claude.send({ kind: "prompt", text: "go" });
  expect(written).toEqual([{ type: "user", message: { role: "user", content: "go" } }]);
});
