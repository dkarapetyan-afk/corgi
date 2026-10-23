import { test, expect, spyOn } from "bun:test";
import { applyUsage, Client, defaultModel, limits } from "./account";
import { vocabulary } from "./info";
import * as discovery from "../../discovery";
import * as log from "../../log";
import { timestampMs } from "../common";
import { Info } from "../../usage/account";
import { Text } from "../../providers";
import { Control } from "./control";
import { Quit } from "../../subprocess";
test("account lookup logs failures per account, ignores cancellation, and reports recovery once", async () => {
  const resolve = spyOn(discovery, "resolve").mockRejectedValue(Error("ProviderNotFound")),
    output = spyOn(process.stderr, "write").mockImplementation(() => true),
    first = new Client({ [vocabulary.config_env]: "/one" }),
    second = new Client({ [vocabulary.config_env]: "/two" });
  log.configure("serve", {});
  try {
    await expect(first.read()).rejects.toThrow("ProviderNotFound");
    await expect(first.read()).rejects.toThrow("ProviderNotFound");
    await expect(second.read()).rejects.toThrow("ProviderNotFound");
    expect(output).toHaveBeenCalledTimes(2);
    expect(String(output.mock.calls[0][0])).toContain('"account":"/one"');
    expect(String(output.mock.calls[1][0])).toContain('"account":"/two"');
    resolve.mockRejectedValueOnce(Error("Cancelled"));
    await expect(first.read()).rejects.toThrow("Cancelled");
    await expect(first.read()).rejects.toThrow("ProviderNotFound");
    expect(output).toHaveBeenCalledTimes(2);
    resolve.mockResolvedValue("/fake/claude");
    first.next_auth = Infinity;
    await first.read();
    await first.read();
    expect(output).toHaveBeenCalledTimes(3);
    expect(String(output.mock.calls[2][0])).toContain("Executable resolution recovered");
    resolve.mockRejectedValue(Error("ProviderNotFound"));
    await expect(first.read()).rejects.toThrow("ProviderNotFound");
    expect(output).toHaveBeenCalledTimes(4);
  } finally {
    first.close();
    second.close();
    resolve.mockRestore();
    output.mockRestore();
    log.configure("test");
  }
});
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

test("Claude model discovery reads auth and initialization without sending any model prompt", async () => {
  const quit = new Quit(),
    client = new Client({ CLAUDE_CONFIG_DIR: "/claude/nvidia" }),
    info = Object.assign(new Info(), { signed_in: true, limits: "metered" }),
    catalog = [{ value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku 5.5" }],
    executable = spyOn(discovery, "resolve").mockResolvedValue("/fake/claude"),
    auth = spyOn(client as any, "auth").mockResolvedValue({ account: info, d: {} }),
    ready = spyOn(Control.prototype, "ready").mockResolvedValue({ models: catalog }),
    request = spyOn(Control.prototype, "request");
  try {
    expect(await client.models(quit)).toEqual({ info, models: catalog });
    expect(auth).toHaveBeenCalledWith("/fake/claude", quit);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(client.session?.env.CLAUDE_CONFIG_DIR).toBe("/claude/nvidia");
  } finally {
    client.close();
    executable.mockRestore();
    auth.mockRestore();
    ready.mockRestore();
    request.mockRestore();
  }
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
