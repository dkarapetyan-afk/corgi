import { expect, test } from "bun:test";
import { read } from "./catalog";

test("OpenCode catalog supplies names, context and base rates without a model table", () => {
  const catalog = read({
    data: [
      {
        providerID: "custom",
        id: "future-model",
        name: "Future Model",
        limit: { context: 128000 },
        cost: [
          { tier: { type: "context", size: 200000 }, input: 9, output: 30 },
          { input: 1.25, output: 5.5 },
        ],
      },
    ],
  });
  const model = catalog.get("custom/future-model")!;
  expect(model.name.text()).toBe("Future Model");
  expect(model.window).toBe(128000n);
  expect(model.price).toEqual({ label: "Future Model", input: 1250n, output: 5500n });
});
test("catalog prices distinguish free, absent, invalid and tier-only entries", () => {
  const costs = [
      [{ input: 0, output: 0 }],
      [],
      undefined,
      [{ input: -1, output: 5 }],
      [{ input: Infinity, output: 5 }],
      [{ input: 1 }],
      [{ tier: { type: "context", size: 200000 }, input: 2, output: 10 }],
    ],
    catalog = read({
      data: costs.map((cost, i) => ({ providerID: "custom", id: "model-" + i, cost })),
    });
  expect([...catalog.values()].map(m => m.price)).toEqual([
    { label: "model-0", input: 0n, output: 0n },
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
});
test("catalog prices remain provider-specific and names cannot inject terminal escapes", () => {
  const catalog = read({
    data: [
      { providerID: "one", id: "same", name: "\x1b[31mSame", cost: [{ input: 1, output: 2 }] },
      { providerID: "two", id: "same", cost: [{ input: 3, output: 4 }] },
    ],
  });
  expect(catalog.get("one/same")?.price?.input).toBe(1000n);
  expect(catalog.get("two/same")?.price?.input).toBe(3000n);
  expect(catalog.get("one/same")?.name.text()).not.toContain("\x1b");
});
