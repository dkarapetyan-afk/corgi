import { test, expect } from "bun:test";
import { attribute, Hold, Sampler, hold_ms, type Device, type Lookup, type Source } from "./gpu";

const device = (index: number, fields: Partial<Device> = {}): Device => ({
  vendor: "nvidia",
  index,
  name: "GPU",
  minor: index,
  mig: false,
  util: 0,
  used: 0n,
  total: 48n << 30n,
  processes: [],
  samples: [],
  ...fields,
});
/** Workspace PIDs 10–19 hold the devices open; 500 is another user's job. */
const lookup = (fields: Partial<Lookup> = {}): Lookup => ({
  ours: new Set([10, 11, 12]),
  exists: pid => pid < 1000,
  holds: pid => pid !== 12,
  holders: () => [10, 11],
  ...fields,
});

test("per-process figures sum across GPUs like CPU percent", () => {
  const { usage, modes } = attribute(
    [
      device(0, { processes: [{ pid: 10, memory: 4n << 30n }], samples: [{ pid: 10, util: 70 }] }),
      device(1, {
        processes: [
          { pid: 10, memory: 4n << 30n },
          { pid: 11, memory: 12n << 30n },
          { pid: 500, memory: 1n << 30n },
        ],
        samples: [
          { pid: 10, util: 60 },
          { pid: 500, util: 30 },
        ],
      }),
    ],
    lookup(),
  );
  expect(modes).toEqual(["process", "process"]);
  expect(usage.get(10)).toEqual({
    util: 130,
    memory: 8n << 30n,
    devices: [
      { index: 0, util: 70, memory: 4n << 30n },
      { index: 1, util: 60, memory: 4n << 30n },
    ],
  });
  // Listed without a new sample: idle, still holding memory.
  expect(usage.get(11)).toEqual({ util: 0, memory: 12n << 30n, devices: [{ index: 1, util: 0, memory: 12n << 30n }] });
  expect(usage.has(500)).toBe(false);
});

test("a PID reused by a process without the device open isn't credited", () => {
  const { usage, modes } = attribute(
    [
      device(0, {
        processes: [
          { pid: 10, memory: 1n },
          { pid: 12, memory: 2n },
        ],
        samples: [
          { pid: 10, util: 10 },
          { pid: 12, util: 50 },
        ],
      }),
    ],
    lookup(),
  );
  expect(modes).toEqual(["process"]);
  expect([...usage]).toEqual([[10, { util: 10, memory: 1n, devices: [{ index: 0, util: 10, memory: 1n }] }]]);
});

test("samples from another PID namespace fall back to device utilization shared by memory", () => {
  const { usage, modes } = attribute(
    [
      device(0, {
        util: 90,
        processes: [
          { pid: 10, memory: 3n << 30n },
          { pid: 11, memory: 1n << 30n },
        ],
        samples: [{ pid: 48211, util: 90 }],
      }),
    ],
    lookup(),
  );
  expect(modes).toEqual(["list"]);
  expect(usage.get(10)?.util).toBeCloseTo(67.5);
  expect(usage.get(11)?.util).toBeCloseTo(22.5);
  expect(usage.get(11)?.memory).toBe(1n << 30n);
});

test("MIG slices report memory only", () => {
  const { usage, modes } = attribute(
    [device(0, { mig: true, util: null, processes: [{ pid: 10, memory: 5n }], samples: null })],
    lookup(),
  );
  expect(modes).toEqual(["list"]);
  expect(usage.get(10)).toEqual({ util: null, memory: 5n, devices: [{ index: 0, util: null, memory: 5n }] });
});

test("lists from another PID namespace give device totals to the processes holding it open", () => {
  const { usage, modes } = attribute(
    [
      device(0, {
        util: 80,
        used: 10n << 30n,
        processes: [{ pid: 48211, memory: 10n << 30n }],
        samples: [{ pid: 48211, util: 80 }],
      }),
    ],
    lookup(),
  );
  expect(modes).toEqual(["device"]);
  const half = { util: 40, memory: 5n << 30n };
  expect(usage.get(10)).toEqual({ ...half, devices: [{ index: 0, ...half }] });
  expect(usage.get(11)).toEqual({ ...half, devices: [{ index: 0, ...half }] });
});

test("a process that exits between the driver's read and ours doesn't discredit the list", () => {
  const { usage, modes } = attribute(
    [
      device(0, {
        processes: [
          { pid: 10, memory: 1n },
          { pid: 4000, memory: 2n },
        ],
        samples: [
          { pid: 10, util: 20 },
          { pid: 4000, util: 5 },
        ],
      }),
    ],
    lookup(),
  );
  expect(modes).toEqual(["process"]);
  expect(usage.get(10)?.util).toBe(20);
});

test("GPU figures show from first use and hide after a quiet hold", () => {
  const hold = new Hold();
  expect(hold.update(false, 0)).toBe(false);
  expect(hold.update(true, 1000)).toBe(true);
  expect(hold.update(false, 1000 + hold_ms - 1)).toBe(true);
  expect(hold.update(true, 1000 + hold_ms)).toBe(true);
  expect(hold.update(false, 1000 + 2 * hold_ms - 1)).toBe(true);
  expect(hold.update(false, 1000 + 2 * hold_ms)).toBe(false);
});

test("a source that won't open is tried once until released", () => {
  let opens = 0,
    closes = 0;
  const source: Source = { vendor: "nvidia", memory_kind: "VRAM", read: () => [device(0)], close: () => closes++ };
  const missing = new Sampler(() => (opens++, null));
  expect(missing.read()).toBeNull();
  expect(missing.read()).toBeNull();
  expect(opens).toBe(1);
  const present = new Sampler(() => source);
  expect(present.read()?.devices).toHaveLength(1);
  present.close();
  expect(closes).toBe(1);
  const broken = new Sampler(() => {
    throw Error("dlopen failed");
  });
  expect(broken.read()).toBeNull();
});
