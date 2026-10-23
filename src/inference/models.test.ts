import { expect, test } from "bun:test";
import { Option, Selection, automatic, compare, options } from "./models";
const option = (model: string, subscription: boolean, input_cost: number | null, output_cost = input_cost) =>
  Object.assign(new Option(), { model, subscription, input_cost, output_cost });
test("subscription models precede paid APIs, then known summary prices sort cheapest first", () => {
  const models = [
    option("expensive", true, 5),
    option("api-free", false, 0),
    option("unknown", true, null),
    option("cheap", true, 0.1),
    option("api-paid", false, 0.01),
  ].sort(compare);
  expect(models.map(m => m.model)).toEqual(["cheap", "expensive", "unknown", "api-free", "api-paid"]);
});
test("cost uses an input-heavy estimate, with deterministic account and model ties", () => {
  const a = option("a", false, 1, 2),
    b = option("b", false, 0.5, 3);
  expect([a, b].sort(compare)[0]).toBe(b);
  expect(compare(a, { ...a, account: "/other" })).not.toBe(0);
});
test("wire and saved model selections normalize defaults and reject malformed IDs", () => {
  expect(Selection.parse(undefined)).toEqual(new Selection());
  expect(Selection.parse({ provider: "pi", model: "bad\nmodel", account: "" })).toEqual(new Selection());
  const selected = { provider: "pi" as const, model: "anthropic/haiku", account: "/private/pi" };
  expect(Selection.parse(selected)).toEqual(selected);
  expect(
    options([
      { ...selected, name: "Haiku", subscription: true },
      { ...selected, provider: "unknown", name: "Bad" },
    ]),
  ).toHaveLength(1);
  expect(options([{ ...selected, name: "Haiku" }])[0].ready).toBeNull();
  expect(options([{ ...selected, name: "Haiku", ready: false }])[0].ready).toBe(false);
  expect(options([{ ...selected, name: "Haiku" }])[0].plan).toBe("");
  expect(options([{ ...selected, name: "Haiku", plan: "Pro 500\x1b" }])[0].plan).toBe("Pro 500");
});

test("Auto chooses the cheapest checked subscription, never failed or untested access", () => {
  const failed = Object.assign(option("github/cheap", true, 0.1), { ready: false }),
    untested = option("unknown/cheap", true, 0),
    active = Object.assign(option("openai/luna", true, 1), { ready: true }),
    expensive = Object.assign(option("openai/sol", true, 5), { ready: true }),
    api = Object.assign(option("api/free", false, 0), { ready: true });
  const ranked = [failed, untested, expensive, api, active].sort(compare);
  expect(automatic(ranked)).toBe(active);
  expect(automatic([failed, untested])).toBeUndefined();
  expect(automatic([untested])).toBe(untested);
  expect(automatic([])).toBeUndefined();
});
