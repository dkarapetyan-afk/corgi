import { test, expect } from "bun:test";
import { lookup, equivalent } from "./prices";
test("model ids match their base model and family aliases", () => {
  for (const [model, cost] of [
    ["claude-opus-5-5[1m]", 4000n],
    ["claude-opus-5", 5000n],
    ["claude-haiku-4-5-20251001", 1000n],
    ["claude-haiku-5-5", 100n],
    ["haiku", 100n],
    ["claude-opus-4-7", 5000n],
    ["claude-opus-4-20250514", 15000n],
    ["gpt-6.1-sol", 2000n],
    ["gpt-6.1-sol-20260601", 2000n],
  ] as const)
    expect(lookup(model)?.input).toBe(cost);
  expect(lookup("gpt-6-luna")?.label).toBe("luna");
  expect(lookup("opus")?.label).toBe("opus");
  for (const model of ["claude-opus-55", "gpt-6.1-sol2", "gpt-6.2-sol", "codex-auto-review", ""])
    expect(lookup(model)).toBeNull();
});
test("GPT-6.1 Sol usage converts to Astra-equivalent tokens", () => {
  const sol = lookup("gpt-6.1-sol")!,
    astra = lookup("gpt-6-astra")!;
  expect(sol).toEqual({ label: "sol", input: 2000n, output: 10000n });
  expect(equivalent(sol, astra, 5000n, 1000n)).toBe(1200n);
});
test("equivalent tokens rescale input and output separately", () => {
  const opus = lookup("claude-opus-5")!,
    haiku = lookup("claude-haiku-4-5")!;
  expect(equivalent(haiku, opus, 5000n, 1000n)).toBe(1200n);
  expect(equivalent(opus, opus, 5000n, 1000n)).toBe(6000n);
});
