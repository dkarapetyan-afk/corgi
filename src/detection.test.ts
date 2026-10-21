import { Terminal, closeReadiness } from "./pane/terminal";
import { n, ptr } from "./native_bridge";
import { test, expect } from "bun:test";
import { identify, backgroundJob, Tracker, interruptKey, type Job } from "./detection";
import { Agent } from "./agents";
import { adapter } from "./providers";
import { screen as claudeScreen, interrupted } from "./providers/claude/screen";
/** A tick of a pane's detection: follow its process, then show what its watcher confirms. */
function look(tracker: Tracker, agent: Agent, job: Job | null, title: string, text: string, watched: boolean) {
  const speaks = tracker.update(agent, job);
  if (!job) return false;
  const seen = adapter(job.provider)
    .watch("")
    .read({ id: 1, title, text: () => text }, tracker, null, 0);
  return !!seen.shown && speaks && tracker.show(agent, seen.shown, watched);
}
test("identify actual executables and scripts, not arguments or shell text", () => {
  for (const args of [
    ["/usr/bin/codex"],
    ["bun", "/a/node_modules/@openai/codex/bin/codex.js"],
    ["python3", "/tmp/codex"],
    ["/Frameworks/Python", "/tmp/codex"],
  ])
    expect(identify(args)).toBe("codex");
  expect(identify(["bun", "run", "--bun", "/a/node_modules/@anthropic-ai/claude-code/cli.js"])).toBe("claude");
  expect(identify(["/Users/a/.local/share/claude/versions/2.1.282", "--session-id", "x"])).toBe("claude");
  for (const args of [
    ["sh", "-c", "codex"],
    ["node", "-e", "codex"],
    ["bun", "-e", "codex"],
    ["vim", "codex"],
  ])
    expect(identify(args)).toBeNull();
});
test("claude interrupts need a stable idle title without an interrupt hint", () => {
  const tracker = new Tracker(),
    idle = "> \n  ? for shortcuts",
    delay = 1500000;
  expect(interrupted(claudeScreen("✳ Task", idle), tracker, 100)).toBe(false);
  expect(interrupted(claudeScreen("⠋ Task", idle), tracker, 100 + delay)).toBe(false);
  expect(interrupted(claudeScreen("✳ Task", "✻ Working (esc to interrupt)"), tracker, 200 + delay)).toBe(false);
  expect(interrupted(claudeScreen("✳ Task", idle), tracker, 300 + delay)).toBe(false);
  expect(interrupted(claudeScreen("✳ Task", idle), tracker, 299 + 2 * delay)).toBe(false);
  expect(interrupted(claudeScreen("✳ Task", idle), tracker, 300 + 2 * delay)).toBe(true);
});
test("an interrupt key shortens the stable idle wait", () => {
  let tracker = new Tracker();
  const idle = "> \n  ? for shortcuts";
  tracker.observeInput("\x1b", 1000);
  expect(interrupted(claudeScreen("⠋ Task", "✻ Working (esc to interrupt)"), tracker, 1100)).toBe(false);
  expect(interrupted(claudeScreen("✳ Task", idle), tracker, 1200)).toBe(false);
  expect(interrupted(claudeScreen("✳ Task", idle), tracker, 251200)).toBe(true);
  tracker = new Tracker();
  tracker.observeInput("\x03", 1000);
  const late = 5001001;
  expect(interrupted(claudeScreen("✳ Task", idle), tracker, late)).toBe(false);
  expect(interrupted(claudeScreen("✳ Task", idle), tracker, late + 250000)).toBe(false);
});
test("recognize interrupt keys in legacy and Kitty encodings", () => {
  for (const input of ["\x1b", "\x03", "\x1b[27u", "\x1b[27;1u", "\x1b[27;1:1u", "\x1b[99;5u", "a\x1b[27u"])
    expect(interruptKey(input)).toBe(true);
  for (const input of ["", "a", "\x1b[A", "\x1bb", "\x1b[27;5;97~", "\x1b[270u", "\x1b[99u"])
    expect(interruptKey(input)).toBe(false);
});
test("fallback debounces attention, yields to hooks, and clears exited agents", () => {
  const tracker = new Tracker(),
    agent = new Agent(),
    job = { pid: 123, provider: "claude" as const };
  for (let i = 0; i < 2; i++) expect(look(tracker, agent, job, "⠋ Task", "", false)).toBe(false);
  expect(agent.state).toBe("initializing");
  for (let i = 0; i < 4; i++) look(tracker, agent, job, "⠋ Starting", "Initializing (esc to interrupt)", false);
  expect(agent.state).toBe("initializing");
  for (let i = 0; i < 3; i++) look(tracker, agent, job, "✳ Ready", "", false);
  for (let i = 0; i < 3; i++) look(tracker, agent, job, "⠋ Loading", "", false);
  expect(agent.state).toBe("idle");
  for (let i = 0; i < 2; i++) look(tracker, agent, job, "⠋ Task", "Working (esc to interrupt)", false);
  expect(agent.state).toBe("working");
  for (let i = 0; i < 3; i++) expect(look(tracker, agent, job, "✳ Task", "", false)).toBe(false);
  expect(agent.attention).toBe("none");
  agent.last_seq = 1n;
  agent.state = "blocked";
  for (let i = 0; i < 4; i++) look(tracker, agent, job, "⠋ Task", "", false);
  expect(agent.state).toBe("blocked");
  look(tracker, agent, null, "", "", false);
  expect(agent.provider).toBe("claude");
  look(tracker, agent, null, "", "", false);
  expect(agent.provider).toBeNull();
  expect(agent.last_seq).toBe(0n);
});
test("Codex fallback tracks tools without a lifecycle state transition", () => {
  const tracker = new Tracker(),
    agent = new Agent(),
    job = { pid: 123, provider: "codex" as const };
  for (let i = 0; i < 3; i++) look(tracker, agent, job, "", "› ", true);
  const working = "• Working (20s • esc to interrupt)\n› Ask Codex to do anything";
  for (let i = 0; i < 2; i++) look(tracker, agent, job, "", working, true);
  expect(agent.state).toBe("working");
  expect(agent.tool_active).toBe(false);
  for (const screen of [
    "• Working (20s • esc to interrupt) · 1 background terminal running\n› Ask Codex to do anything",
    "• Working (20s • esc to interrupt) · 3 background t…\n› Ask Codex to do anything",
    "• Waiting for background terminal (20s • esc to interrupt)\n› Ask Codex to do anything",
  ]) {
    look(tracker, agent, job, "", screen, true);
    expect(agent.tool_active).toBe(true);
    look(tracker, agent, job, "", working, true);
    expect(agent.tool_active).toBe(false);
  }
  const tool = "• Working (20s • esc to interrupt) · 1 background t…";
  look(tracker, agent, job, "", tool, true);
  for (let i = 0; i < 3; i++) look(tracker, agent, job, "", "› ", true);
  expect(agent.tool_active).toBe(false);
  agent.last_seq = 1n;
  agent.state = "working";
  for (let i = 0; i < 3; i++) look(tracker, agent, job, "", tool, true);
  expect(agent.tool_active).toBe(false);
});

test("a detached process is a background job and a terminal's foreground is not", async () => {
  const detached = Bun.spawn([process.execPath, "-e", "await Bun.sleep(60000)"], {
    detached: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const terminal = new Terminal(80, 24);
  try {
    await terminal.spawn("/tmp", "", 1, process.execPath, "printf x; sleep 60");
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (!backgroundJob(detached.pid) || n.probe_foreground(terminal.fd) <= 0))
      await Bun.sleep(10);
    expect(backgroundJob(detached.pid)).toBe(true);
    expect(backgroundJob(terminal.pid)).toBe(false);
    const members = new Int32Array(128);
    const count = n.probe_group_pids(detached.pid, ptr(members), members.length);
    expect(count).toBeGreaterThan(0);
    expect(Array.from(members.subarray(0, count))).toContain(detached.pid);
    if (process.platform === "linux") expect(n.probe_group_pids(-1, ptr(members), members.length)).toBeLessThan(0);
  } finally {
    detached.kill();
    await detached.exited;
    terminal.destroy();
    closeReadiness();
  }
});
