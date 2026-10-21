import { test, expect } from "bun:test";
import { limits } from "./account";
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
