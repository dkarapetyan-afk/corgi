import { expect, test } from "bun:test";
import * as options from "./agent_options";

test("extra flags are literal shell-style words with quotes and escaped spaces", () => {
  expect(options.args(' --model sonnet --add-dir "two words" --label=it\\ works ')).toEqual([
    "--model",
    "sonnet",
    "--add-dir",
    "two words",
    "--label=it works",
  ]);
  expect(options.args(`--value '' --literal '$HOME; echo hi'`)).toEqual(["--value", "", "--literal", "$HOME; echo hi"]);
  expect(options.args("  ")).toEqual([]);
});

test.each([
  ["unfinished quote", `--model 'opus`],
  ["compound command", "--verbose; touch /tmp/oops"],
  ["pipeline", "--x | cat"],
  ["unfinished escape", "--x " + String.fromCharCode(92)],
  ["C1 control", "--x\u009b31m"],
  ["expansion", "$(whoami)"],
  ["conditional", "--x && true"],
  ["NUL", "--x\0oops"],
  ["newline", "--x\n--y"],
  ["too long", "x".repeat(2049)],
])("invalid extra flags are rejected rather than partially applied: %s", (_name, flags) => {
  expect(() => options.args(flags)).toThrow("InvalidAgentFlags");
  expect(options.problem({ flags, env: [] })).not.toBeNull();
});

test("environment overrides are validated, preserving literal and empty values", () => {
  expect(
    options.problem({
      flags: "",
      env: [
        ["API_KEY", "$literal = value"],
        ["EMPTY", ""],
        ["_NAME2", "🌍"],
      ],
    }),
  ).toBeNull();
  for (const env of [
    [["2BAD", "v"]],
    [["BAD-NAME", "v"]],
    [["", "v"]],
    [
      ["A", "x"],
      ["A", "y"],
    ],
    [["A", "a\0b"]],
    [["A", "a\nb"]],
    [["A", "a\x1bb"]],
    [["A", "x".repeat(2049)]],
  ] as [string, string][][])
    expect(options.problem({ flags: "", env })).not.toBeNull();
  expect(options.problem({ flags: "", env: Array.from({ length: 65 }, (_, i) => [`V${i}`, ""]) })).not.toBeNull();
});

test("saved launch settings are normalized once and copied", () => {
  const source: options.Options = { flags: "--verbose", env: [["A", "hello"]] };
  const parsed = options.read(source);
  expect(parsed).toEqual(source);
  source.env[0][1] = "changed";
  expect(parsed?.env[0][1]).toBe("hello");
  for (const value of [
    null,
    {},
    { flags: 1, env: [] },
    { flags: "", env: ["oops"] },
    { flags: "", env: [["A", 1]] },
    { flags: "'", env: [] },
  ])
    expect(options.read(value)).toBeNull();
});
