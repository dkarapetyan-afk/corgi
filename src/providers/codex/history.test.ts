import { test, expect } from "bun:test";
import { tail } from "./history";
const lines = (...v: any[]) => v.map(x => JSON.stringify(x)).join("\n") + "\n";
test("a Codex rollout tail yields the last typed prompt and an abort", () => {
  const message = (text: string) => ({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }),
    t = lines(message("# AGENTS.md instructions"), message("why is it slow?"), {
      type: "event_msg",
      payload: { type: "turn_aborted" },
    });
  expect(tail(t)).toEqual({ last: "why is it slow?", interrupted: true });
  expect(tail(t + lines(message("try again")))).toEqual({
    last: "try again",
    interrupted: false,
  });
});
