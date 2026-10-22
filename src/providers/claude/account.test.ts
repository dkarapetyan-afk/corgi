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

test("Enterprise usage reads monthly spend without quota windows or session estimates", () => {
  const info = new Info();
  const reply = {
    rate_limits_available: true,
    subscription_type: "enterprise",
    session: { total_cost_usd: 999 },
    rate_limits: {
      five_hour: null,
      seven_day: null,
      extra_usage: {
        is_enabled: true,
        used_credits: 59,
        monthly_limit: 1000000,
        currency: "USD",
        decimal_places: 2,
      },
    },
  };
  const now = Date.parse("2026-10-22T12:00:00Z") / 1000;
  applyUsage(info, reply, now);
  expect(info.limits).toBe("metered");
  expect(info.plan.text()).toBe("Enterprise");
  expect(info.spend).toEqual({
    used_minor: 59,
    limit_minor: 1000000,
    currency: "USD",
    exponent: 2,
    period_start: Date.parse("2026-10-01T00:00:00Z") / 1000,
    reset_at: Date.parse("2026-11-01T00:00:00Z") / 1000,
  });
  for (const [at, start, end] of [
    ["2028-02-29T23:59:59Z", "2028-02-01", "2028-03-01"],
    ["2026-12-31T23:59:59Z", "2026-12-01", "2027-01-01"],
    ["2027-01-01T00:00:00Z", "2027-01-01", "2027-02-01"],
  ]) {
    applyUsage(info, reply, Date.parse(at) / 1000);
    expect([info.spend?.period_start, info.spend?.reset_at]).toEqual([
      Date.parse(start) / 1000,
      Date.parse(end) / 1000,
    ]);
  }
});

test("Claude monthly spend keeps missing and zero limits distinct and clears disabled spend", () => {
  const info = new Info();
  const extra = { is_enabled: true, used_credits: 0, monthly_limit: null as number | null, currency: "JPY" };
  const reply = { rate_limits_available: true, rate_limits: { extra_usage: extra } };
  applyUsage(info, reply);
  expect(info.spend?.limit_minor).toBeNull();
  expect(info.spend?.exponent).toBe(0);
  extra.monthly_limit = 0;
  applyUsage(info, reply);
  expect(info.spend?.limit_minor).toBe(0);
  extra.is_enabled = false;
  applyUsage(info, reply);
  expect(info.spend).toBeNull();
  expect(info.limits).toBe("metered");
  extra.is_enabled = true;
  extra.used_credits = -1;
  expect(() => applyUsage(info, reply)).toThrow("InvalidUsage");
  applyUsage(info, { ...reply, rate_limits: { ...reply.rate_limits, five_hour: { utilization: 5 } } });
  expect(typeof info.limits).toBe("object");
  expect(info.spend).toBeNull();
});
