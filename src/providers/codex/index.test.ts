import { test, expect } from "bun:test";
import * as codex from "./index";
test("rollout lines decode their envelope and payload kind", () => {
  const rollout = codex.Rollout.decode({
    type: "event_msg",
    timestamp: "t",
    payload: { type: "token_count" },
  });
  expect(rollout.type).toBe("event_msg");
  expect(rollout.timestamp).toBe("t");
  expect(rollout.payloadType()).toBe("token_count");
  const other = codex.Rollout.decode({ type: "compacted", payload: "summary" });
  expect(other.type).toBeNull();
  expect(other.payloadType()).toBeNull();
});
test("plans read as Codex's /status names them", () => {
  for (const [code, label] of [
    ["free", "Free"],
    ["plus", "Plus"],
    ["prolite", "Pro 100"],
    ["pro", "Pro 200"],
    ["promax", "Pro 500"],
    ["team", "Business"],
    ["business", "Enterprise"],
    ["enterprise", "Enterprise"],
    ["edu_plus", "Edu Plus"],
    ["unknown", "Unknown"],
    ["", ""],
  ])
    expect(codex.plan(code).text()).toBe(label);
});
test("file-change evidence uses only completed edits and the latest edit location", () => {
  const change = { type: "fileChange", status: "completed", changes: [{ path: ".worktrees/search/file" }] };
  expect(codex.writes([change], "/repo")).toEqual(["/repo/.worktrees/search/file"]);
  expect(codex.writes([{ ...change, status: "failed" }], "/repo")).toEqual([]);
  expect(codex.writes([change], "")).toEqual([]);
  expect(codex.writes([change, { ...change, changes: [{ path: "/repo/main-file" }] }], "/repo")).toEqual([
    "/repo/main-file",
  ]);
});
test("command locations come from structured absolute cwd, not command text", () => {
  const item = {
    type: "commandExecution",
    status: "completed",
    cwd: "/repo/.worktrees/search",
    command: "cat /repo/.worktrees/other/file",
  };
  expect(codex.commandDirectory(item)).toBe(item.cwd);
  expect(codex.commandDirectory({ ...item, status: "inProgress" })).toBe(item.cwd);
  for (const changed of [
    { status: "failed" },
    { status: "declined" },
    { cwd: "relative" },
    { cwd: "" },
    { type: "fileChange" },
  ])
    expect(codex.commandDirectory({ ...item, ...changed })).toBeNull();
});
