import { test, expect } from "bun:test";
import { limits, monthlySpend } from "./account";
import { amounts } from "../../usage/spend";
test("Codex limits keep zero use, reported durations and unix resets", () => {
  const c = limits({
    primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 8200 },
    secondary: { usedPercent: 63, windowDurationMins: 10080, resetsAt: 273700 },
  });
  if (typeof c !== "object") throw Error("no windows");
  expect(c.windows.map(w => [w?.label(), w?.used, w?.countdown(100)])).toEqual([
    ["5h", 0, "2h 15m"],
    ["7d", 63, "3d 4h"],
  ]);
  const missing = limits({ primary: { usedPercent: 12 } });
  if (typeof missing !== "object") throw Error("no windows");
  expect([missing.windows[0]?.minutes, missing.windows[0]?.reset_at, missing.windows[1]]).toEqual([null, null, null]);
  expect(limits(null)).toBe("none");
});
test("Codex's monthly credit limit reads as spend for the month before its reset", () => {
  // As a Business workspace reported it, with no quota windows.
  const reading = monthlySpend({
    limit: "250000",
    used: "388.20340502262115",
    remainingPercent: 100,
    resetsAt: 1793491200,
  });
  expect(reading).toEqual({
    used_minor: 38820,
    limit_minor: 25000000,
    currency: null,
    exponent: 2,
    period_start: Date.UTC(2026, 9, 1) / 1000,
    reset_at: Date.UTC(2026, 10, 1) / 1000,
  });
  expect(amounts(reading!)).toBe("⛁388 / ⛁250k");
  for (const [reset, start] of [
    [Date.UTC(2027, 2, 31, 7), Date.UTC(2027, 1, 28, 7)],
    [Date.UTC(2027, 0, 15), Date.UTC(2026, 11, 15)],
  ])
    expect(monthlySpend({ limit: "1", used: "0", resetsAt: reset / 1000 })?.period_start).toBe(start / 1000);
  for (const bad of [null, { limit: "250000", used: "-1", resetsAt: 1793491200 }, { used: "1", resetsAt: 1793491200 }])
    expect(monthlySpend(bad)).toBeNull();
  expect(monthlySpend({ limit: "250000", used: "1", resetsAt: "1793491200" })).toBeNull();
});
