import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobIn } from "./daemon";
import { adapter } from "./index";
test("a session attaches only to the live background job that holds it", () => {
  const root = mkdtempSync(join(tmpdir(), "corgi-daemon-")),
    directory = join(root, "sessions"),
    prior = process.env.CLAUDE_CONFIG_DIR;
  try {
    mkdirSync(directory);
    for (const [i, record] of [
      { sessionId: "bg", pid: process.pid, kind: "bg", jobId: "19e909c5" },
      { sessionId: "terminal", pid: process.pid, kind: "interactive" },
      { sessionId: "exited", pid: 2147483647, kind: "bg", jobId: "5c926aa7" },
      { sessionId: "no-job", pid: process.pid, kind: "bg" },
      { sessionId: "unsafe", pid: process.pid, kind: "bg", jobId: "a;rm" },
      {
        sessionId: "future",
        pid: process.pid,
        kind: "remote",
        jobId: "0a1b2c3d",
      },
    ].entries())
      writeFileSync(join(directory, `${i + 100}.json`), JSON.stringify(record));
    writeFileSync(join(directory, "7.json"), '{"pid":');
    expect(jobIn(directory, "BG")?.text()).toBe("19e909c5");
    for (const session of ["terminal", "exited", "no-job", "unsafe", "future", "missing"])
      expect(jobIn(directory, session)).toBeNull();
    expect(jobIn("/nonexistent/sessions", "bg")).toBeNull();
    process.env.CLAUDE_CONFIG_DIR = root;
    expect(adapter.launch.attach?.("bg", "")).toEqual(["attach", "19e909c5"]);
    expect(adapter.launch.attach?.("terminal", "")).toBeNull();
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(adapter.launch.attach?.("bg", root)).toEqual(["attach", "19e909c5"]);
  } finally {
    if (prior === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prior;
    rmSync(root, { recursive: true, force: true });
  }
});
