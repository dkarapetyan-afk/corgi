import { test, expect } from "bun:test";
import * as json from "./json";
test("json accessors read a missing or mistyped key as the default", () => {
  const v = json.parse('{"s":"x","n":-3,"o":{"s":"y"}}');
  expect(json.str(v, "s")).toBe("x");
  for (const key of ["missing", "n"]) expect(json.str(v, key)).toBe("");
  expect(json.str(null, "s")).toBe("");
  expect(json.str(json.field(v, "o"), "s")).toBe("y");
  expect(json.field(v, "missing")).toBeNull();
});
test("JSON preserves small and wide integer tokens", () => {
  for (const [value, expected] of [
    [0n, 0],
    [42n, 42],
    [-42n, -42],
    [9007199254740993n, 9007199254740993n],
    [18446744073709551615n, 18446744073709551615n],
    [-9223372036854775808n, -9223372036854775808n],
  ] as const) {
    const bytes = json.stringify({ value }),
      raw = json.parse(bytes);
    expect(raw.value).toBe(expected);
    expect(json.stringify(raw)).toBe(bytes);
  }
});
