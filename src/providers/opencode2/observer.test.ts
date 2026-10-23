import { expect, spyOn, test } from "bun:test";
import { API } from "./api";
import { Worker, snapshot } from "./observer";
import { Text } from "../common";
const request = (session: string, actor: number) => ({
  pane: 0,
  pid: 0,
  actor,
  prefix: new Text(session),
  generation: 0n,
  title_revision: 0n,
});
function worker() {
  const out = new Worker();
  out.requests = [request("ses_parent", 1), request("ses_other", 2)];
  out.parents.set("ses_child", "ses_parent");
  out.api = new API("unused");
  out.live = true;
  out.swept = Date.now();
  return out;
}
test("compaction follows the live context record, not cancelled or historical compactions", async () => {
  let messages: Record<string, unknown>[] = [];
  const mock = spyOn(API.prototype, "call").mockImplementation(async (_method, path) => {
    if (path === "/api/session/ses_parent") return { data: { id: "ses_parent" } };
    return { data: path.endsWith("/context") ? messages : [] };
  });
  const read = (active = true) =>
    snapshot(new API("unused"), request("ses_parent", 1), active ? { ses_parent: { type: "running" } } : {});
  try {
    messages = [{ type: "compaction", status: "failed", error: { name: "AbortError" } }];
    expect((await read()).compacting).toBe(false);
    messages.push({ type: "compaction", status: "running", reason: "manual", summary: "" });
    expect((await read()).compacting).toBe(true);
    expect((await read(false)).compacting).toBe(false);
    messages.push({ type: "idle", outcome: "interrupted" });
    expect((await read()).compacting).toBe(false);
    messages = [{ type: "compaction", status: "running", reason: "auto", summary: "" }];
    expect((await read()).compacting).toBe(true);
    messages[0].status = "completed";
    expect((await read()).compacting).toBe(false);
    messages.push({ type: "assistant", content: [] });
    expect((await read()).compacting).toBe(false);
  } finally {
    mock.mockRestore();
  }
});
test("events mark the conversation they touch, and a subagent's parent", () => {
  const w = worker();
  try {
    w.observe({ type: "session.reasoning.delta", data: { sessionID: "ses_parent" } });
    w.observe({ type: "session.tool.called", data: { sessionID: "ses_unknown" } });
    expect([...w.due]).toEqual([]);
    w.observe({ type: "permission.asked", data: { id: "per_1", sessionID: "ses_child" } });
    expect([...w.due]).toEqual(["ses_parent"]);
    w.due.clear();
    w.observe({ type: "session.created", data: { sessionID: "ses_new", parentID: "ses_other" } });
    w.observe({ type: "form.created", data: { form: { id: "frm_1", sessionID: "ses_other" } } });
    expect([...w.due]).toEqual(["ses_other"]);
  } finally {
    w.stop();
  }
});
test("with the stream up, only sessions an event touched are fetched again", async () => {
  const fetched: string[] = [],
    mock = spyOn(API.prototype, "call").mockImplementation(async (_method, path) => {
      const session = /^\/api\/session\/(ses_\w+)$/.exec(path)?.[1];
      if (session) {
        fetched.push(session);
        return { data: { id: session } };
      }
      if (path.endsWith("/context"))
        return {
          data: [
            { type: "user", id: "msg_user", text: "Fix it" },
            {
              type: "assistant",
              content: [
                {
                  type: "tool",
                  id: "tool_tests",
                  name: "shell",
                  state: { status: "running", input: { command: "bun test src/providers/opencode2" } },
                },
              ],
            },
          ],
        };
      return { data: path === "/api/session/active" ? {} : [] };
    });
  const w = worker();
  try {
    await w.run();
    expect(fetched).toEqual([]);
    w.observe({ type: "session.execution.started", data: { sessionID: "ses_other" } });
    await w.run();
    expect(fetched).toEqual(["ses_other"]);
    const results = w.take();
    expect(results.map(s => s.request.actor)).toEqual([2]);
    expect(results[0].evidence.text()).toContain("shell: bun test src/providers/opencode2");
    w.live = false;
    w.swept = 0;
    await w.run();
    expect(fetched).toEqual(["ses_other", "ses_parent", "ses_other"]);
  } finally {
    w.stop();
    mock.mockRestore();
  }
});
