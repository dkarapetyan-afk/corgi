import { test, expect } from "bun:test";
import { applyUsage, defaultModel, limits } from "./account";
import { timestampMs } from "../common";
import { Info } from "../../usage/account";
import { Text } from "../../providers";
test("Claude control usage preserves login on unsupported or malformed quota data", () => {
  const info = new Info();
  info.signed_in = true;
  info.account = new Text("account@example.com");
  expect(() => applyUsage(info, null)).toThrow("InvalidUsage");
  expect(() => applyUsage(info, { rate_limits_available: false })).toThrow("UsageUnavailable");
  expect(info.signed_in).toBe(true);
  expect(info.account.text()).toBe("account@example.com");
  expect(info.limits).toBe("none");
  applyUsage(info, {
    rate_limits_available: true,
    subscription_type: "pro",
    rate_limits: {
      five_hour: { utilization: 0 },
      seven_day: { utilization: 33 },
    },
  });
  expect(typeof info.limits).toBe("object");
  if (typeof info.limits === "object") {
    expect(info.limits.windows[0]?.used).toBe(0);
    expect(info.limits.windows[1]?.used).toBe(33);
  }
});

test("Claude limits read fixed windows and ISO resets with offsets", () => {
  const c = limits({
    five_hour: { utilization: 12.4, resets_at: "2026-09-24T12:00:00.000000+00:00" },
    seven_day: { utilization: 48, resets_at: "2026-09-27T18:00:00+02:00" },
  });
  if (typeof c !== "object") throw Error("no windows");
  const now = timestampMs("2026-09-24T10:00:00Z")! / 1000;
  expect(c.windows.map(w => [w?.label(), w?.used, w?.countdown(now)])).toEqual([
    ["5h", 12, "2h"],
    ["7d", 48, "3d 6h"],
  ]);
  const bad = limits({ five_hour: { utilization: 5, resets_at: "2026-09-24T12:00:00+24:00" } });
  if (typeof bad !== "object") throw Error("no windows");
  expect([bad.windows[0]?.used, bad.windows[0]?.reset_at, bad.windows[1]]).toEqual([5, null, null]);
  expect(limits(null)).toBe("none");
});
test("Claude initialize names the default model", () => {
  expect(
    defaultModel({
      models: [
        { value: "opus", resolvedModel: "claude-opus-5-5" },
        { value: "default", resolvedModel: "claude-sonnet-5-5" },
      ],
    }),
  ).toBe("claude-sonnet-5-5");
  expect(defaultModel(null)).toBe("");
});
