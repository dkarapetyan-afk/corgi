//! NVIDIA readings from NVML, the driver's libnvidia-ml.so.1, loaded in the
//! resources Worker. Calls may block, so nothing else may import this.
import { dlopen, ptr, FFIType, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import type * as gpu from "./gpu";

const library = "libnvidia-ml.so.1";
const success = 0,
  not_found = 6,
  insufficient_size = 7;
const not_available = (1n << 64n) - 1n;
const symbols = {
  init: [["nvmlInit_v2", "nvmlInit"], [], FFIType.i32],
  shutdown: [["nvmlShutdown"], [], FFIType.i32],
  count: [["nvmlDeviceGetCount_v2", "nvmlDeviceGetCount"], ["ptr"], FFIType.i32],
  handle: [["nvmlDeviceGetHandleByIndex_v2", "nvmlDeviceGetHandleByIndex"], ["u32", "ptr"], FFIType.i32],
  name: [["nvmlDeviceGetName"], ["ptr", "ptr", "u32"], FFIType.i32],
  minor: [["nvmlDeviceGetMinorNumber"], ["ptr", "ptr"], FFIType.i32],
  mig: [["nvmlDeviceGetMigMode"], ["ptr", "ptr", "ptr"], FFIType.i32],
  memory_v2: [["nvmlDeviceGetMemoryInfo_v2"], ["ptr", "ptr"], FFIType.i32],
  memory: [["nvmlDeviceGetMemoryInfo"], ["ptr", "ptr"], FFIType.i32],
  rates: [["nvmlDeviceGetUtilizationRates"], ["ptr", "ptr"], FFIType.i32],
  samples: [["nvmlDeviceGetProcessUtilization"], ["ptr", "ptr", "ptr", "u64"], FFIType.i32],
  compute: [
    [
      "nvmlDeviceGetComputeRunningProcesses_v3",
      "nvmlDeviceGetComputeRunningProcesses_v2",
      "nvmlDeviceGetComputeRunningProcesses",
    ],
    ["ptr", "ptr", "ptr"],
    FFIType.i32,
  ],
  graphics: [
    [
      "nvmlDeviceGetGraphicsRunningProcesses_v3",
      "nvmlDeviceGetGraphicsRunningProcesses_v2",
      "nvmlDeviceGetGraphicsRunningProcesses",
    ],
    ["ptr", "ptr", "ptr"],
    FFIType.i32,
  ],
  mps: [
    [
      "nvmlDeviceGetMPSComputeRunningProcesses_v3",
      "nvmlDeviceGetMPSComputeRunningProcesses_v2",
      "nvmlDeviceGetMPSComputeRunningProcesses",
    ],
    ["ptr", "ptr", "ptr"],
    FFIType.i32,
  ],
} as const;
type Name = keyof typeof symbols;
type Call = (...args: any[]) => number;
// Process info v1 is {pid, used}; v2 and v3 add two u32 instance ids.
const process_size = (name: string) => (/_v[23]$/.test(name) ? 24 : 16);

class Nvml implements gpu.Source {
  readonly vendor = "nvidia";
  readonly memory_kind = "VRAM";
  private handles: { close(): void }[] = [];
  private calls = new Map<Name, Call>();
  private sizes = new Map<Name, number>();
  private devices: { handle: Pointer; index: number; name: string; minor: number | null; mig: boolean }[] = [];
  private seen = new Map<number, bigint>();
  /** Binds the newest of each symbol's names; a missing one stays unbound. */
  bind() {
    for (const [key, [names, args, returns]] of Object.entries(symbols) as [Name, (typeof symbols)[Name]][])
      for (const name of names)
        try {
          const lib = dlopen(library, { [name]: { args: [...args], returns } });
          this.handles.push(lib);
          this.calls.set(key, lib.symbols[name] as Call);
          this.sizes.set(key, process_size(name));
          break;
        } catch {}
    for (const key of ["init", "count", "handle"] as Name[]) if (!this.calls.has(key)) return false;
    return true;
  }
  call(key: Name, ...args: unknown[]): number {
    const f = this.calls.get(key);
    return f ? f(...args) : -1;
  }
  open(): boolean {
    if (this.call("init") !== success) return false;
    const count = new Uint32Array(1);
    if (this.call("count", ptr(count)) !== success) return false;
    for (let index = 0; index < count[0]; index++) {
      const out = new BigUint64Array(1);
      if (this.call("handle", index, ptr(out)) !== success) continue;
      const handle = Number(out[0]) as Pointer;
      const name = new Uint8Array(96),
        minor = new Uint32Array(1),
        mode = new Uint32Array(2);
      this.devices.push({
        handle,
        index,
        name:
          this.call("name", handle, ptr(name), name.length) === success
            ? Buffer.from(name.subarray(0, Math.max(0, name.indexOf(0)))).toString()
            : "NVIDIA GPU",
        minor: this.call("minor", handle, ptr(minor)) === success ? minor[0] : null,
        mig: this.call("mig", handle, ptr(mode), ptr(mode.subarray(1))) === success && mode[0] === 1,
      });
    }
    return true;
  }
  read(): gpu.Device[] {
    return this.devices.map(d => ({
      vendor: this.vendor,
      index: d.index,
      name: d.name,
      minor: d.minor,
      mig: d.mig,
      ...this.memory(d.handle),
      util: this.rates(d.handle),
      processes: this.processes(d.handle),
      // MIG instances have no per-process utilization.
      samples: d.mig ? null : this.samples(d),
    }));
  }
  private memory(handle: Pointer) {
    // v2 leaves the driver's reserve out of `used`.
    const v2 = new DataView(new ArrayBuffer(40));
    v2.setUint32(0, 40 | (2 << 24), true);
    if (this.call("memory_v2", handle, ptr(v2)) === success)
      return { total: v2.getBigUint64(8, true), used: v2.getBigUint64(32, true) };
    const v1 = new BigUint64Array(3);
    if (this.call("memory", handle, ptr(v1)) === success) return { total: v1[0], used: v1[2] };
    return { total: null, used: null };
  }
  private rates(handle: Pointer) {
    const rates = new Uint32Array(2);
    return this.call("rates", handle, ptr(rates)) === success ? rates[0] : null;
  }
  /** Compute, graphics and MPS clients, one entry per PID; null when no list can be read. */
  private processes(handle: Pointer): gpu.Listed[] | null {
    const found = new Map<number, bigint | null>();
    let read = false;
    for (const key of ["compute", "graphics", "mps"] as Name[]) {
      if (!this.calls.has(key)) continue;
      const size = this.sizes.get(key)!;
      let count = new Uint32Array(1),
        status = this.call(key, handle, ptr(count), null),
        buffer = new DataView(new ArrayBuffer(8));
      // Processes can start between the two calls.
      for (let attempt = 0; status === insufficient_size && attempt < 3; attempt++) {
        count[0] += 4;
        buffer = new DataView(new ArrayBuffer(count[0] * size));
        status = this.call(key, handle, ptr(count), ptr(buffer));
      }
      if (status !== success) continue;
      read = true;
      for (let i = 0; i < count[0]; i++) {
        const pid = buffer.getUint32(i * size, true),
          used = buffer.getBigUint64(i * size + 8, true),
          memory = used === not_available ? null : used,
          previous = found.get(pid);
        found.set(pid, previous == null ? memory : memory === null ? previous : previous > memory ? previous : memory);
      }
    }
    return read ? [...found].map(([pid, memory]) => ({ pid, memory })) : null;
  }
  /** Each PID's SM utilization over the samples since the last read, averaged. */
  private samples(d: { handle: Pointer; index: number }): gpu.Sampled[] | null {
    if (!this.calls.has("samples")) return null;
    const last = this.seen.get(d.index) ?? 0n,
      count = new Uint32Array(1);
    let status = this.call("samples", d.handle, null, ptr(count), last),
      buffer = new DataView(new ArrayBuffer(8));
    if (status === not_found || (status === success && count[0] === 0)) return [];
    // Some drivers answer a null buffer with the count and success.
    if (status === success) status = insufficient_size;
    for (let attempt = 0; status === insufficient_size && attempt < 3; attempt++) {
      count[0] += 8;
      buffer = new DataView(new ArrayBuffer(count[0] * 32));
      status = this.call("samples", d.handle, ptr(buffer), ptr(count), last);
    }
    if (status === not_found) return [];
    if (status !== success) return null;
    const sums = new Map<number, { total: number; n: number }>();
    let newest = last;
    for (let i = 0; i < count[0]; i++) {
      const at = buffer.getBigUint64(i * 32 + 8, true),
        sm = buffer.getUint32(i * 32 + 16, true);
      // NVML occasionally reports more than 100%.
      if (at <= last || sm > 100) continue;
      if (at > newest) newest = at;
      const pid = buffer.getUint32(i * 32, true),
        sum = sums.get(pid) ?? { total: 0, n: 0 };
      sum.total += sm;
      sum.n++;
      sums.set(pid, sum);
    }
    this.seen.set(d.index, newest);
    return [...sums].map(([pid, s]) => ({ pid, util: s.total / s.n }));
  }
  close() {
    if (this.calls.has("init")) this.call("shutdown");
    for (const h of this.handles) h.close();
    this.handles = [];
    this.calls.clear();
    this.devices = [];
  }
}

/** NVML when the driver is present and initializes, else null. */
export function open(): gpu.Source | null {
  if (process.platform !== "linux" || !existsSync("/dev/nvidiactl")) return null;
  const nvml = new Nvml();
  if (nvml.bind() && nvml.open()) return nvml;
  nvml.close();
  return null;
}
