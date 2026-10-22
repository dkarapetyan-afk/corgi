import { expect, test } from "bun:test";
import { amounts, current, percent, restore, type Reading } from "./spend";

const reading: Reading = {
  used_minor: 59,
  limit_minor: 1000000,
  currency: "USD",
  exponent: 2,
  period_start: 1790812800,
  reset_at: 1793491200,
};
test("monthly spend formats reported money without inventing a missing cap", () => {
  expect(amounts(reading)).toBe("$0.59 / $10k");
  expect(amounts({ ...reading, used_minor: 123456, limit_minor: 100000000 })).toBe("$1.2k / $1M");
  expect(amounts({ ...reading, used_minor: 99999, limit_minor: 99999999 })).toBe("$999.99 / $1M");
  expect(percent(reading)).toBeCloseTo(0.0059);
  expect(amounts({ ...reading, limit_minor: null })).toBe("$0.59");
  expect(percent({ ...reading, limit_minor: null })).toBeNull();
  expect(amounts({ ...reading, used_minor: 0, limit_minor: 0 })).toBe("$0 / $0");
  expect(percent({ ...reading, used_minor: 0, limit_minor: 0 })).toBe(0);
  expect(percent({ ...reading, used_minor: 125, limit_minor: 100 })).toBe(125);
  expect(amounts({ ...reading, currency: "JPY", exponent: 0, limit_minor: null })).toBe("¥59");
});
test("spend normalization rejects malformed readings and handles old previews", () => {
  expect(restore(undefined)).toBeNull();
  expect(restore(reading)).toEqual(reading);
  for (const bad of [
    { used_minor: -1 },
    { used_minor: Infinity },
    { used_minor: 2 ** 53 },
    { limit_minor: "100" },
    { currency: null },
    { currency: "$" },
    { exponent: -1 },
    { reset_at: reading.period_start },
    { period_start: 1.5 },
  ])
    expect(restore({ ...reading, ...bad })).toBeNull();
  expect(current(reading, reading.period_start - 1)).toBe(false);
  expect(current(reading, reading.period_start)).toBe(true);
  expect(current(reading, reading.reset_at - 1)).toBe(true);
  expect(current(reading, reading.reset_at)).toBe(false);
});
