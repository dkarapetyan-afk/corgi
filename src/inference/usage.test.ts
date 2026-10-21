import { test, expect } from "bun:test";
import { System, Tracker } from "./usage";
import { Tokens } from "../usage/live";

test("system usage counts fresh Codex threads once and each Claude result once", () => {
  const tracker = new Tracker();
  const system = new System();
  const total = {
    kind: "usage" as const,
    session: "owned",
    turn: "t",
    total: { total: new Tokens({ input: 100n, cached_input: 60n, output: 20n }), last: null },
  };
  tracker.ingest(total, system, 1);
  tracker.ingest(total, system, 2);
  expect(system.meter.value.tokens.total()).toBe(120n);
  const part = {
    kind: "usage" as const,
    session: "",
    turn: "",
    part: { id: "result-1", tokens: new Tokens({ input: 60n, cached_input: 30n, output: 5n }) },
  };
  tracker.ingest(part, system, 4);
  tracker.ingest(part, system, 5);
  expect(system.meter.value.tokens.total()).toBe(185n);
  expect(system.meter.value.tokens.cached_input).toBe(90n);
});
