import { test, expect } from "bun:test";
import {
  Process,
  Work,
  Snapshot,
  fromJSON,
  Alarm,
  delta,
  owner,
  leaders,
  record,
  standouts,
  history_bucket_ms,
  history_capacity,
  type Point,
  type Reading,
  type Root,
} from "./resources";
import * as json from "../json";
test("resource snapshots restore concrete integers after JSON transport", () => {
  const snapshot = new Snapshot(),
    work = new Work(1),
    process = new Process(2, 9007199254740993n, "worker");
  snapshot.host_memory = 4096n;
  work.memory = 512n;
  work.read = 0n;
  process.memory = 256n;
  process.written = 1n;
  work.processes.push(process);
  work.history.push({ at: 10, samples: 1, cpu: 0, memory: 512n, io: 0n, processes: [] });
  work.history.push({ at: 11, samples: 3, cpu: 0, memory: 512n, io: 0n, processes: [process] });
  snapshot.workspaces.push(work);
  const bytes = json.stringify(snapshot),
    restored = fromJSON(json.parse(bytes));
  expect(restored).toEqual(snapshot);
  expect(restored.workspace(1).processes[0].start).toBe(9007199254740993n);
  expect(restored.workspace(1).read).toBe(0n);
  expect(restored.workspace(1).written).toBeNull();
  expect(json.stringify(restored)).toBe(bytes);
  expect(fromJSON(null)).toEqual(new Snapshot());
});
test("new process baselines preserve established workspace rates", () => {
  const established = Object.assign(new Process(1, 1n, "worker"), {
      cpu: 45,
      memory: 100n,
      read: 200n,
      written: 0n,
    }),
    newcomer = Object.assign(new Process(2, 2n, "child"), { memory: 50n });
  for (const first of [false, true]) {
    const w = new Work(1);
    w.add(first ? newcomer : established);
    w.add(first ? established : newcomer);
    expect([w.cpu, w.memory, w.read, w.written]).toEqual([45, 150n, 200n, 0n]);
  }
  const fresh = new Work(1);
  fresh.add(newcomer);
  expect([fresh.cpu, fresh.read, fresh.written, fresh.memory]).toEqual([null, null, null, 50n]);
});
test("deltas ignore PID reuse, reassignment, first samples and counter resets", () => {
  const old: Reading = {
      pid: 4,
      workspace: 1,
      identity_start: 8n,
      at: 1000,
      value: {
        start: 9n,
        cpu_ns: 100n,
        memory: 10n,
        read: 100n,
        written: 200n,
      },
    },
    next: Reading = {
      ...old,
      at: 3000,
      value: { ...old.value, cpu_ns: 4000000100n, read: 2100n },
    };
  expect(delta(old, next)).toMatchObject({ cpu: 200, read: 1000n });
  expect(delta(null, next).cpu).toBeNull();
  expect(delta(old, { ...next, value: { ...next.value, start: 10n } }).cpu).toBeNull();
  expect(delta(old, { ...next, workspace: 2 }).cpu).toBeNull();
  expect(delta(old, { ...next, value: { ...next.value, read: 1n } }).read).toBeNull();
});
test("pressure requires sustained evidence and clears with hysteresis", () => {
  const a = new Alarm();
  expect(a.update(true, false, 0)).toBe(false);
  expect(a.update(false, true, 9000)).toBe(false);
  expect(a.update(true, false, 10000)).toBe(false);
  expect(a.update(true, false, 20000)).toBe(true);
  expect(a.update(false, true, 21000)).toBe(true);
  expect(a.update(false, true, 50999)).toBe(true);
  expect(a.update(false, true, 51000)).toBe(false);
});
test("ownership chooses the nearest root and bounds ancestry cycles", () => {
  const inventory = [
      { pid: 10, parent: 1, start: 1n, name: "" },
      { pid: 11, parent: 10, start: 2n, name: "" },
      { pid: 12, parent: 11, start: 3n, name: "" },
      { pid: 20, parent: 21, start: 4n, name: "" },
      { pid: 21, parent: 20, start: 5n, name: "" },
    ],
    index = new Map(inventory.map((p, i) => [p.pid, i])),
    roots: Root[] = [
      {
        key: 0,
        pid: 10,
        start: 1n,
        workspace: 1,
        agent_pid: 0,
        provider: null,
      },
      {
        key: 0,
        pid: 11,
        start: 2n,
        workspace: 2,
        agent_pid: 0,
        provider: null,
      },
    ];
  expect(owner(12, inventory, index, roots)?.workspace).toBe(2);
  expect(owner(20, inventory, index, roots)).toBeNull();
  inventory[1].start = 99n;
  expect(owner(12, inventory, index, roots)).toBeNull();
});
test("bounded process details retain leaders for every resource", () => {
  const list = Array.from({ length: 100 }, (_, i) =>
      Object.assign(new Process(i + 1, 1n, "fixture"), {
        cpu: i,
        memory: BigInt(100 - i),
        read: i === 50 ? 1000000n : 0n,
        written: 0n,
      }),
    ),
    selected = leaders(list);
  expect(selected.length).toBeLessThanOrEqual(64);
  for (const pid of [100, 1, 51]) expect(selected.some(p => p.pid === pid)).toBe(true);
});

test("history keeps a point per bucket: rates averaged, memory at its peak", () => {
  const point = (at: number, cpu: number, memory: bigint, io: bigint): Point => ({
    at,
    samples: 1,
    cpu,
    memory,
    io,
    processes: [],
  });
  let history: Point[] = [];
  history = record(history, point(0, 10, 100n, 10n));
  history = record(history, point(1000, 30, 50n, 20n));
  history = record(history, point(history_bucket_ms - 1, 20, 70n, 30n));
  expect(history).toEqual([{ at: 0, samples: 3, cpu: 20, memory: 100n, io: 20n, processes: [] }]);
  history = record(history, point(history_bucket_ms, 0, 0n, 0n));
  expect(history.map(p => p.at)).toEqual([0, history_bucket_ms]);
  for (let at = 2; at <= history_capacity + 1; at++)
    history = record(history, point(at * history_bucket_ms, 0, 0n, 0n));
  expect(history).toHaveLength(history_capacity);
});

test("history points keep the processes leading each figure", () => {
  const proc = (pid: number, fields: Partial<Process>) =>
    Object.assign(new Process(pid, BigInt(pid), `p${pid}`), fields);
  // Six busy on CPU, one writing, and one idle that leads nothing.
  const cpu = Array.from({ length: 6 }, (_, i) => proc(i + 1, { cpu: 10 + i }));
  const kept = standouts([...cpu, proc(100, { read: 0n, written: 5n }), proc(200, {})]).map(p => p.pid);
  expect(kept).toEqual([2, 3, 4, 5, 6, 100]);
  // A bucket averages each leader's rates over its readings and keeps its peak memory.
  const first: Point = {
      at: 0,
      samples: 1,
      cpu: 0,
      memory: 0n,
      io: 0n,
      processes: [proc(1, { cpu: 40, memory: 9n, read: 4n, written: 0n })],
    },
    second: Point = { ...first, at: 1000, processes: [proc(1, { cpu: 20, memory: 3n, read: 0n, written: 2n })] };
  const [merged] = record([first], second);
  expect(merged.processes[0]).toMatchObject({ cpu: 30, memory: 9n, read: 2n, written: 1n });
});
