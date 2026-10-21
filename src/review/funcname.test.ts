import { expect, test } from "bun:test";
import * as diff from "./diff";
import * as funcname from "./funcname";

/** The holder of the line marked `>`, searching from just above it. */
function holderOf(source: string, lang: string | null): string | null {
  const lines = source.split("\n");
  const at = lines.findIndex(l => l.startsWith(">"));
  lines[at] = lines[at].slice(1);
  return funcname.holder(lines, lang, at, funcname.depth(lines[at]));
}

test("a method holds its body, not the class or a sibling above", () => {
  const source = [
    "export class Server {",
    "  stop(): void {",
    "    this.closed = true;",
    "  }",
    "  async run(): Promise<void> {",
    "    if (this.ready) {",
    "      this.listen();",
    "    }",
    ">    this.bind();",
    "  }",
    "}",
  ].join("\n");
  expect(holderOf(source, "typescript")).toBe("async run(): Promise<void> {");
});

test("typescript holders: wrapped signatures, keys, arrows and tests", () => {
  expect(
    holderOf("class A {\n  private draw(\n    c: Canvas,\n  ): void {\n>    c.fill();\n  }\n}", "typescript"),
  ).toBe("private draw(");
  expect(holderOf("const x = {\n  act: () => {\n>    go();\n  },\n};", "typescript")).toBe("act: () => {");
  expect(holderOf("export const pick = (n: number) => {\n>  return n;\n};", "typescript")).toBe(
    "export const pick = (n: number) => {",
  );
  expect(holderOf('test("folds", () => {\n  const d = 1;\n>  expect(d).toBe(1);\n});', "typescript")).toBe(
    'test("folds", () => {',
  );
});

test("control flow and continued declarations are passed over", () => {
  const source = [
    "function draw() {",
    "  const a = 1,",
    "    b = 2;",
    "  for (const row of rows) {",
    "    switch (row.kind) {",
    ">      case 1:",
    "    }",
    "  }",
    "}",
  ].join("\n");
  expect(holderOf(source, "typescript")).toBe("function draw() {");
  expect(holderOf("function f() {\n  const a = 1,\n>    b = 2;\n}", "typescript")).toBe("function f() {");
});

test("a top-level change takes git's default: the nearest unindented line", () => {
  expect(holderOf("class A {\n  x = 1;\n}\n/** doc */\n>interface B {", "typescript")).toBe("class A {");
  expect(holderOf("first:\n  a: 1\nsecond:\n>  b: 2", null)).toBe("second:");
});

test("tabs and spaces are measured as Python measures them", () => {
  // At 8 columns a tab, the change sits beside `run`, not inside `helper`.
  const source = "class A {\n\trun() {\n\t\tconst helper = () => {\n>        y();\n\t\t};\n\t}\n}";
  expect(holderOf(source, "typescript")).toBe("class A {");
  expect(funcname.depth("\t  \tx")).toEqual([16, 4]);
  expect(funcname.depth("  \fx")).toEqual([0, 0]);
});

test("other languages", () => {
  expect(holderOf("class A:\n    def run(self):\n        x = 1\n>        y = 2", "python")).toBe("def run(self):");
  expect(holderOf("impl Foo {\n    pub fn bar(&self) {\n>        baz();\n    }\n}", "rust")).toBe(
    "pub fn bar(&self) {",
  );
  expect(holderOf("pub fn main() !void {\n>    try run();\n}", "zig")).toBe("pub fn main() !void {");
  expect(holderOf("# Title\n\n## Usage\n\ntext\n>more", "markdown")).toBe("## Usage");
});

const patch = (lines: string[]) =>
  ["diff --git a/f.ts b/f.ts", "--- a/f.ts", "+++ b/f.ts", "@@ -1,30 +1,30 @@", ...lines, ""].join("\n");

test("a fold names what holds the change after it", () => {
  const body = Array.from({ length: 10 }, (_, i) => `    a${i}();`);
  const d = diff.parse(
    patch([" class A {", "   run() {", ...body.map(l => ` ${l}`), "-    x();", "+    y();", ...body.map(l => ` ${l}`)]),
  ) as diff.FileDiff;
  const folds = d.units.filter(u => u.kind === "fold");
  expect(folds.map(u => funcname.forFold(d, u, "typescript"))).toEqual(["run() {", null]);
});

test("git's header names a fold when a diff driver gives one", () => {
  const body = Array.from({ length: 10 }, (_, i) => `    a${i}();`);
  const d = diff.parse(
    patch([" class A {", "   run() {", ...body.map(l => ` ${l}`), "-    x();", "+    y();", ...body.map(l => ` ${l}`)]),
  ) as diff.FileDiff;
  d.headers = diff.headers("@@ -10,7 +10,7 @@ section Run\n a\n@@ -1 +1 @@\n");
  expect(d.headers).toEqual(new Map([[10, "section Run"]]));
  expect(
    funcname.forFold(
      d,
      d.units.find(u => u.kind === "fold")!,
      "typescript",
    ),
  ).toBe("section Run");
});

test("a declaration in view names its own holder", () => {
  const filler = Array.from({ length: 10 }, (_, i) => `   a${i} = ${i};`);
  const d = diff.parse(
    patch([" class A {", ...filler, "   run() {", "-    x();", "+    y();", "   }", " }"]),
  ) as diff.FileDiff;
  const fold = d.units.find(u => u.kind === "fold")!;
  expect(funcname.forFold(d, fold, "typescript")).toBe("class A {");
});
