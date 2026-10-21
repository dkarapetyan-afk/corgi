import { test, expect } from "bun:test";
import { answered, composer, screen } from "./screen";
import { PromptWatch } from "../../detection";
const line = "─".repeat(40);
const screens = {
  idle: `⏺ Done.\n\n${line}\n❯ \n${line}\n  ⏸ manual mode on · ? for shortcuts · ← 2 agents`,
  typed: `${line}\n❯ a long reply that\n  wraps\n${line}\n  ⏸ manual mode on`,
  working: `✢ Honking… (1s · thinking)\n${line}\n❯ \n${line}\n  ⏸ manual mode on · esc to interrupt · ← 2 agents`,
  permission: `⏺ Sleeping\n${line}\n Bash command\n\n   sleep 25\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. Yes, and always allow\n   3. No\n\n Esc to cancel · Tab to amend`,
  question: `${line}\n ☐ Color\n\nPick a color\n\n❯ 1. Red\n  2. Blue\n  3. Type something.\n${line}\n  4. Chat about this\n\nEnter to select · ↑/↓ to navigate · Esc to cancel`,
  question_last: `${line}\n ☐ Color\n\nPick a color\n\n  1. Red\n  2. Blue\n  3. Type something.\n${line}\n❯ 4. Chat about this\n\nEnter to select · ↑/↓ to navigate · Esc to cancel`,
};
test("Claude's screen reads its title and the prompts it shares with Codex", () => {
  expect(screen("✳ Task", "> ")).toBe("idle");
  expect(screen("⠋ Task", screens.working)).toBe("working");
  expect(screen("⠋ Task", "Enter to confirm · Esc to cancel")).toBe("blocked");
  // Only Codex's screen says it is compacting.
  expect(screen("⠋ Task", "• Compacting context (esc to interrupt)")).toBe("working");
  expect(screen("⠋ Task", "")).toBeNull();
});
test("Claude's prompts cover its composer", () => {
  for (const text of [screens.idle, screens.typed, screens.working]) expect(composer(text)).toBe("open");
  for (const text of [screens.permission, screens.question, screens.question_last, ""])
    expect(composer(text)).toBe("covered");
  expect(composer(`${line}\n❯ make\n${line}\n  enter to select · esc to cancel`)).toBe("unknown");
});
test("a hook-reported Claude block ends once its prompt was seen and answered", () => {
  const tracker = new PromptWatch();
  for (const text of [
    screens.working,
    screens.permission,
    screens.working,
    screens.working,
    screens.permission,
    screens.permission,
    screens.working,
  ])
    expect(answered(tracker, true, text)).toBeNull();
  expect(answered(tracker, true, screens.working)).toBe("working");
  for (let i = 0; i < 2; i++) expect(answered(tracker, true, screens.question)).toBeNull();
  expect(answered(tracker, true, screens.typed)).toBeNull();
  expect(answered(tracker, true, screens.idle)).toBe("idle");
  for (let i = 0; i < 2; i++) answered(tracker, true, screens.question);
  expect(answered(tracker, false, "")).toBeNull();
  for (let i = 0; i < 3; i++) expect(answered(tracker, true, screens.idle)).toBeNull();
});
