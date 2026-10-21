import { test, expect } from "bun:test";
import { command, empty, holds } from "./rename";
import { Terminal } from "../../pane/terminal";
function screen(t: Terminal, input: string, footer: string) {
  t.feed("\x1b[2J\x1b[H\x1b[1;2m› \x1b[0mearlier prompt\r\n\r\n");
  t.feed(input);
  t.feed("\r\n  gpt · /tmp\r\n  ");
  t.feed(footer);
  t.feed("\x1b[3;3H");
}
test("only Codex's empty input box reads as empty", () => {
  const t = Terminal.create(60, 8);
  try {
    screen(t, "\x1b[1m›\x1b[0m \x1b[2mAsk Codex to do anything\x1b[0m", "\x1b[1m?\x1b[0m for shortcuts");
    expect(empty(t)).toBe(true);
    expect(holds(t, "Ask Codex to do anything")).toBe(false);
    for (const [input, footer] of [
      ["\x1b[1m›\x1b[0m Ask Codex to do anything", ""],
      ["\x1b[1m›\x1b[0m \x1b[2mAsk Codex to do anything\x1b[0m", "\x1b[1m?\x1b[0m / \x1b[1mesc\x1b[0m close"],
      ["\x1b[1;7m› 1. Yes, proceed (y)\x1b[0m", "\x1b[1m?\x1b[0m for shortcuts"],
      ["\x1b[1;2m› \x1b[0m\x1b[2mAsk Codex to do anything\x1b[0m", "\x1b[1m?\x1b[0m for shortcuts"],
    ]) {
      screen(t, input, footer);
      expect(empty(t)).toBe(false);
    }
    screen(t, "\x1b[1m›\x1b[0m \x1b[2mAsk Codex to do anything\x1b[0m", "\x1b[2mreverse-i-search: \x1b[0m");
    t.feed("\x1b[5;21H");
    expect(empty(t)).toBe(false);
    screen(t, "\x1b[1m›\x1b[0m \x1b[2mAsk Codex to do anything\x1b[0m", "\x1b[1m?\x1b[0m for shortcuts");
    t.feed("\x1b]0;[ ! ] Action Required | codex\x07");
    expect(empty(t)).toBe(false);
  } finally {
    t.destroy();
  }
});
test("Codex's input row holds the typed command, cursor after it", () => {
  const t = Terminal.create(60, 8),
    typed = command("corgi ⑂");
  try {
    screen(t, "\x1b[1m›\x1b[0m \x1b[36m/rename\x1b[0m corgi ⑂", "");
    t.feed("\x1b[3;18H");
    expect(holds(t, typed)).toBe(true);
    expect(holds(t, "/rename corgi")).toBe(false);
    t.feed("\x1b[3;5H");
    expect(holds(t, typed)).toBe(false);
  } finally {
    t.destroy();
  }
});
