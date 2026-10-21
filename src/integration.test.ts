import { test, expect } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookEvents, install, installedCommand, mergedConfig, removedConfig } from "./integration";
test("hook removal takes out only Corgi's handlers and reports where the rest moved", () => {
  const theirs = { type: "command", command: "herdr-hook session" },
    original = JSON.stringify({ model: "opus", hooks: { SessionStart: [{ hooks: [theirs] }] } }),
    merged = mergedConfig("claude", original)!,
    removal = removedConfig("claude", merged)!;
  expect(JSON.parse(removal.text)).toEqual(JSON.parse(original));
  expect(removal.removed).toContainEqual({ event: "SessionStart", group: 1, handler: 0 });
  expect(removal.moved).toEqual([
    [
      { event: "SessionStart", group: 0, handler: 0 },
      { event: "SessionStart", group: 0, handler: 0 },
    ],
  ]);
  expect(removedConfig("claude", removal.text)).toBeNull();
});
test("hook removal renumbers handlers after Corgi's and drops what it empties", () => {
  const ours = { type: "command", command: installedCommand("codex") },
    theirs = { type: "command", command: "theirs" },
    removal = removedConfig(
      "codex",
      JSON.stringify({
        hooks: { Stop: [{ hooks: [ours] }, { matcher: "x", hooks: [ours, theirs] }], PreToolUse: [{ hooks: [ours] }] },
      }),
    )!;
  expect(JSON.parse(removal.text)).toEqual({ hooks: { Stop: [{ matcher: "x", hooks: [theirs] }] } });
  expect(removal.moved).toEqual([
    [
      { event: "Stop", group: 1, handler: 1 },
      { event: "Stop", group: 0, handler: 0 },
    ],
  ]);
  expect(removedConfig("codex", JSON.stringify({ hooks: { Stop: [{ hooks: [ours] }] } }))!.text).toBe("{}");
  expect(removedConfig("codex", "{}")).toBeNull();
  expect(() => removedConfig("codex", "[]")).toThrow("InvalidHookSettings");
});
test("hook status counts the events that run Corgi's handler", () => {
  const all = mergedConfig("claude", "{}")!,
    some = JSON.parse(all);
  delete some.hooks.Stop;
  expect(hookEvents("claude", all)).toEqual([12, 12]);
  expect(hookEvents("claude", JSON.stringify(some))).toEqual([11, 12]);
  expect(hookEvents("claude", "{}")).toEqual([0, 12]);
});
test("installing leaves hook settings that already have every hook untouched", async () => {
  const directory = mkdtempSync(join(tmpdir(), "corgi-hooks-")),
    settings = join(directory, "settings.json"),
    was = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = directory;
  try {
    const all = JSON.parse(mergedConfig("claude", "{}")!),
      written = JSON.stringify({ theme: "dark", hooks: all.hooks });
    writeFileSync(settings, written);
    expect(await install("claude")).toBe("present");
    expect(readdirSync(directory)).toEqual(["settings.json"]);
    expect(readFileSync(settings, "utf8")).toBe(written);
    delete all.hooks.SubagentStop;
    writeFileSync(settings, JSON.stringify({ theme: "dark", hooks: all.hooks }));
    expect(await install("claude")).toBe("added");
    expect(hookEvents("claude", readFileSync(settings, "utf8"))).toEqual([12, 12]);
  } finally {
    if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = was;
    rmSync(directory, { recursive: true, force: true });
  }
});
test("hook install names Corgi's handlers and leaves ones it added unnamed as they are", () => {
  const added = JSON.parse(mergedConfig("codex", "{}")!);
  expect(added.hooks.Stop).toEqual([
    {
      hooks: [{ type: "command", command: installedCommand("codex"), timeout: 2, statusMessage: "Reporting to Corgi" }],
    },
  ]);
  for (const groups of Object.values<any>(added.hooks)) delete groups[0].hooks[0].statusMessage;
  expect(mergedConfig("codex", JSON.stringify(added))).toBeNull();
});
