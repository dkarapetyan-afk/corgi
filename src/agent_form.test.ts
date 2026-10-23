import { expect, test } from "bun:test";
import { Form, row_duration_ms } from "./agent_form";
import type { Agent } from "./agent_manager";
import { Cell } from "./launcher_usage";
import { Rect } from "./layout";
import { Writer } from "./text";
import { Terminal } from "./pane/terminal";

const agent: Agent = {
  provider: "claude",
  account: "/work",
  name: "work",
  label: "Claude Code · work",
  who: "me@acme.com",
  signed_out: false,
  shown: true,
  here: true,
  managed: false,
  usage: Cell.status("—"),
};
const create = () => {
  const form = new Form();
  form.open(agent, { flags: "--verbose", env: [] }, "acme");
  return form;
};
const type = (f: Form, value: string) => {
  for (const byte of Buffer.from(value)) f.key(byte);
};
const draw = (f: Form, width = 82, height = 24, now = 1000) => {
  const w = new Writer(),
    b = new Rect(2, 2, width, height),
    terminal = new Terminal(90, 30);
  try {
    f.draw(w, b, now);
    terminal.feed(w.s);
    return { raw: w.s, lines: terminal.text().split("\n"), b };
  } finally {
    terminal.destroy();
  }
};

test("keyboard edits names, quoted flags and literal environment key/value rows", () => {
  const f = create();
  type(f, "acme");
  f.key(9);
  type(f, '--model "sonnet"');
  f.key(9);
  expect(f.focus.kind).toBe("add");
  f.key(13, 0);
  expect(f.focus).toEqual({ kind: "key", row: 0 });
  type(f, "HTTPS_PROXY");
  f.key(9);
  type(f, "http://localhost:8080/path?q=a=b");
  f.key(9);
  expect(f.focus).toEqual({ kind: "remove", row: 0 });
  f.key(9);
  f.key(13, 50);
  type(f, "EMPTY");
  f.key(9);
  expect(f.key(13)).toBe("save");
  expect(f.label()).toBe("acme");
  expect(f.options()).toEqual({
    flags: '--model "sonnet"',
    env: [
      ["HTTPS_PROXY", "http://localhost:8080/path?q=a=b"],
      ["EMPTY", ""],
    ],
  });
  f.sequence("\x1b[Z");
  expect(f.focus).toEqual({ kind: "key", row: 1 });
  f.key(9);
  f.key(9);
  expect(f.key(13)).toBeNull();
  expect(f.options().env).toHaveLength(1);
  f.sequence("\x1b[Z");
  expect(f.focus.kind).toBe("flags");
});

test("invalid flags and duplicate or incomplete environment rows retain the draft", () => {
  const f = create();
  f.key(9);
  type(f, "--model 'unfinished");
  expect(f.key(13)).toBeNull();
  expect(f.error).toContain("quotes");
  f.open(
    agent,
    {
      flags: "",
      env: [
        ["A", "one"],
        ["A", "two"],
      ],
    },
    "acme",
  );
  expect(f.key(13)).toBeNull();
  expect(f.error).toContain("Duplicate variable: A");
  expect(f.options().env).toEqual([
    ["A", "one"],
    ["A", "two"],
  ]);
  f.open(agent, { flags: "", env: [] }, "acme");
  f.key(9);
  f.key(9);
  f.key(13);
  expect(f.key(13)).toBeNull();
  expect(f.error).toContain("Variable names");
  expect(f.key(27)).toBe("cancel");
});

test("mouse fields, add/remove and buttons share validation with the keyboard", () => {
  const f = create(),
    { b } = draw(f);
  f.click(b, b.x + 3, b.y + 18, 0);
  expect(f.focus).toEqual({ kind: "key", row: 0 });
  type(f, "TOKEN");
  f.click(b, b.x + 27, b.y + 13);
  expect(f.focus).toEqual({ kind: "value", row: 0 });
  for (const byte of Buffer.from("  literal $VALUE 🌍  ")) f.input().pasteByte(byte);
  expect(f.options().env).toEqual([["TOKEN", "  literal $VALUE 🌍  "]]);
  expect(f.click(b, b.x + b.w - 8, b.y + 20)).toBe("save");
  f.click(b, b.x + b.w - 4, b.y + 13);
  expect(f.options().env).toEqual([]);
  expect(f.click(b, b.x + b.w - 18, b.y + 20)).toBe("cancel");
  expect(f.click(b, b.x + b.w - 1, b.y + 20)).toBeNull();
});

test("many variables scroll without moving Add, Save or the focused caret out of a compact form", () => {
  const f = create();
  f.open(agent, { flags: "", env: Array.from({ length: 12 }, (_, i) => [`KEY_${i}`, `value ${i}`]) }, "acme");
  draw(f, 40, 20);
  for (let i = 0; i < 2 + 11 * 3; i++) f.key(9);
  expect(f.focus).toEqual({ kind: "key", row: 11 });
  const { lines, b } = draw(f, 40, 20);
  expect(lines[b.y + 10]).toContain("KEY_9");
  expect(lines[b.y + 12]).toContain("KEY_11");
  expect(lines[b.y + 14]).toContain("+ Add variable");
  expect(lines[b.y + 16]).toContain("[ Save ]");
  expect(f.caret(b).y).toBe(b.y + 12);
  f.click(b, b.x + b.w - 4, b.y + 12);
  expect(f.variables).toHaveLength(11);
  expect(f.focus).toEqual({ kind: "key", row: 10 });
  for (const [i, line] of lines.entries()) if (i < b.y || i >= b.y + b.h) expect(line.trim()).toBe("");
});

test("new variable motion is bounded, fades to rest, and doesn't change button geometry", () => {
  const f = create();
  f.key(9);
  f.key(9);
  f.key(13, 0);
  const start = draw(f, 82, 24, 0),
    middle = draw(f, 82, 24, 100);
  expect(start.raw).not.toBe(middle.raw);
  expect(draw(f, 82, 24, 100).raw).toBe(middle.raw);
  expect(start.lines[start.b.y + 20]).toBe(middle.lines[middle.b.y + 20]);
  expect(f.tick(row_duration_ms)).toBe(true);
  expect(f.tick(row_duration_ms + 1)).toBe(false);
  expect(draw(f, 82, 24, row_duration_ms).raw).not.toContain("▎");
});
