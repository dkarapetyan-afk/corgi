import { test, expect } from "bun:test";
import { transcript } from "./transcript";
import { Agent } from "../../agents";
import { Result } from "../../usage/worker";
import { Text } from "../common";
test("rollout names wait five seconds after protocol metadata, on the daemon clock", () => {
  const agent = new Agent(),
    r = new Result();
  agent.provider = "codex";
  r.name = new Text("Rollout name");
  const applied = 50000000;
  agent.metadata_at = applied;
  transcript.fallback(r, agent, applied + 5000000);
  expect(agent.name.len).toBe(0);
  transcript.fallback(r, agent, applied + 5000001);
  expect(agent.name.text()).toBe("Rollout name");
});
test("a rollout belongs to the thread its first record names", () => {
  const meta = { type: "session_meta", payload: { id: "thread" } };
  expect(() => transcript.verify?.(meta, "thread")).not.toThrow();
  expect(() => transcript.verify?.(meta, "other")).toThrow("WrongSession");
  expect(() => transcript.verify?.(null, "thread")).toThrow("NoIdentity");
});
