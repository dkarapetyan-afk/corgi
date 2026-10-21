import { test, expect } from "bun:test";
import { claudeProcess } from "./process";
test("a retitled Claude process is still Claude", () => {
  const info = { exe: "/usr/bin/node", argv: ["claude bg-spare"] };
  expect(claudeProcess(info)).toBe(true);
  info.argv[0] = "node";
  expect(claudeProcess(info)).toBe(false);
  info.exe = "/opt/claude/bin/claude";
  expect(claudeProcess(info)).toBe(true);
});
