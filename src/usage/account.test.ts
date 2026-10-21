import { test, expect } from "bun:test";
import { Window, resetCountdown, used, windows } from "./account";
import { readAccount as claudeAccount } from "../providers/claude/account";
import { account as codexAccount } from "../providers/codex/account";
test("signed out and API accounts do not borrow subscription details", () => {
  const out = claudeAccount({
    loggedIn: false,
    email: "old@example.com",
    subscriptionType: "max",
    accessToken: "secret",
  });
  expect(out.account.text()).toBe("Not signed in");
  expect(out.plan.text()).toBe("");
  const api = codexAccount({
    type: "apiKey",
    planType: "pro",
    email: "old@example.com",
  });
  expect(api.account.text()).toBe("API key");
  expect(api.plan.text()).toBe("API");
  expect(api.limits).toBe("metered");
  for (const authMethod of ["api_key", "api_key_helper", "third_party"]) {
    const claude = claudeAccount({ loggedIn: true, authMethod });
    expect(claude.signed_in).toBe(true);
    expect(claude.limits).toBe("metered");
  }
});
test("reset countdown rounds up and belongs to its window", () => {
  for (const [at, label] of [
    [99, "now"],
    [101, "1m"],
    [8200, "2h 15m"],
    [273700, "3d 4h"],
  ] as const)
    expect(resetCountdown(at, 100)).toBe(label);
  expect(new Window({ used: 48 }).countdown(100)).toBeNull();
});
test("a window's use counts only as a percent", () => {
  expect([used(12.4), used(0), used(100)]).toEqual([12, 0, 100]);
  expect([used(-1), used(101), used(NaN), used("12")]).toEqual([null, null, null, null]);
  expect(windows([null, null])).toBe("none");
});
