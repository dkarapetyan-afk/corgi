//! GPU readings shared by every vendor: what a source reports per device, and
//! how those reports become per-process figures for workspace processes.
//! Sources live beside this file (gpu_nvidia.ts) and load only in the Worker.

export type Vendor = "nvidia";
/** A process the driver lists on a device, with the memory it holds there. */
export type Listed = { pid: number; memory: bigint | null };
/** A process's utilization on a device since the previous read, in percent. */
export type Sampled = { pid: number; util: number };
export type Device = {
  vendor: Vendor;
  index: number;
  name: string;
  /** The minor number of its `/dev/nvidia<N>` file, when known. */
  minor: number | null;
  mig: boolean;
  util: number | null;
  used: bigint | null;
  total: bigint | null;
  /** Null when the driver can't list processes. */
  processes: Listed[] | null;
  /** Null when the device has no per-process utilization. */
  samples: Sampled[] | null;
};
export interface Source {
  readonly vendor: Vendor;
  /** How the memory figure is labeled. */
  readonly memory_kind: string;
  read(): Device[];
  close(): void;
}
/** A device as the snapshot shows it. */
export type Gpu = {
  index: number;
  name: string;
  util: number | null;
  used: bigint | null;
  total: bigint | null;
};
/** Figures on one device. */
export type Share = { index: number; util: number | null; memory: bigint | null };
/** A process's figures summed over every device it uses, and on each. */
export type Usage = { util: number | null; memory: bigint | null; devices: Share[] };
/** How a device's figures reached processes, from the most exact: the driver's
 * per-process numbers, its process list with device-wide utilization, or only
 * device-wide numbers given to the processes holding the device open. */
export type Attribution = "process" | "list" | "device";

/** Where a PID the driver reports stands in our process table. */
export type Standing = "ours" | "foreign" | "stale";
export interface Lookup {
  /** Workspace processes, by PID. */
  ours: Set<number>;
  /** Whether the PID exists here; false for another PID namespace's. */
  exists(pid: number): boolean;
  /** Whether the process holds a GPU device file open. */
  holds(pid: number): boolean;
  /** Workspace processes holding this device's file open. */
  holders(device: Device): number[];
}
export function standing(pid: number, lookup: Lookup): Standing {
  if (lookup.ours.has(pid)) return lookup.holds(pid) ? "ours" : "stale";
  return lookup.exists(pid) ? "foreign" : "stale";
}
/** A list from another PID namespace names none of our PIDs. Entries that went
 * stale between the driver's read and ours don't discredit the rest. */
function trusted(pids: number[], lookup: Lookup) {
  return !pids.length || pids.some(pid => standing(pid, lookup) !== "stale");
}
function add(usage: Map<number, Usage>, pid: number, device: Device, util: number | null, memory: bigint | null) {
  const u = usage.get(pid) ?? { util: null, memory: null, devices: [] };
  usage.set(pid, u);
  for (const share of [u, find(u.devices, device.index)]) {
    if (util !== null) share.util = (share.util ?? 0) + util;
    if (memory !== null) share.memory = (share.memory ?? 0n) + memory;
  }
}
/** The share for device `index`, added in index order when missing. */
export function find(shares: Share[], index: number): Share {
  let share = shares.find(s => s.index === index);
  if (!share) {
    share = { index, util: null, memory: null };
    shares.push(share);
    shares.sort((a, b) => a.index - b.index);
  }
  return share;
}
/** Per-process GPU usage for workspace processes, and how each device was read. */
export function attribute(devices: Device[], lookup: Lookup) {
  const usage = new Map<number, Usage>(),
    modes: Attribution[] = [];
  for (const device of devices) {
    const listed = device.processes,
      samples = device.samples;
    if (
      listed &&
      trusted(
        listed.map(p => p.pid),
        lookup,
      )
    ) {
      const mine = listed.filter(p => standing(p.pid, lookup) === "ours");
      if (
        samples &&
        trusted(
          samples.map(s => s.pid),
          lookup,
        )
      ) {
        modes.push("process");
        for (const p of mine) {
          const s = samples.find(s => s.pid === p.pid);
          add(usage, p.pid, device, s ? s.util : 0, p.memory);
        }
        // A process can be sampled before it is listed.
        for (const s of samples)
          if (!mine.some(p => p.pid === s.pid) && standing(s.pid, lookup) === "ours")
            add(usage, s.pid, device, s.util, null);
        continue;
      }
      // Utilization only device-wide: share it by memory held among the
      // processes listed. Exact only when they have the device to themselves.
      modes.push("list");
      const sharing = listed.filter(p => standing(p.pid, lookup) !== "stale"),
        held = sharing.reduce((sum, p) => sum + (p.memory ?? 0n), 0n),
        util = device.mig ? null : device.util;
      for (const p of mine)
        add(
          usage,
          p.pid,
          device,
          util === null ? null : held > 0n ? (util * Number(p.memory ?? 0n)) / Number(held) : util / sharing.length,
          p.memory,
        );
      continue;
    }
    // Nothing the driver names is ours to see: split the device's numbers
    // between the processes holding it open.
    modes.push("device");
    const holders = lookup.holders(device);
    for (const pid of holders)
      add(
        usage,
        pid,
        device,
        device.util === null ? null : device.util / holders.length,
        device.used === null ? null : device.used / BigInt(holders.length),
      );
  }
  return { usage, modes };
}
export function gpus(devices: Device[]): Gpu[] {
  return devices.map(d => ({ index: d.index, name: d.name, util: d.util, used: d.used, total: d.total }));
}

/** GPU figures show from a workspace's first use and stay until it has
 * gone this long without, so a pause between jobs doesn't reflow the row. */
export const hold_ms = 30000;
export class Hold {
  since: number | null = null;
  update(used: boolean, now: number) {
    if (used) this.since = now;
    else if (this.since !== null && now - this.since >= hold_ms) this.since = null;
    return this.since !== null;
  }
}

/** Opens a source on first use, once; `close` releases it until the next read. */
export class Sampler {
  private source: Source | null = null;
  private opened = false;
  /** Processes seen holding a GPU file open, by PID, with their start times. */
  held = new Map<number, bigint>();
  constructor(private open: () => Source | null) {}
  read(): { source: Source; devices: Device[] } | null {
    if (!this.opened) {
      this.opened = true;
      try {
        this.source = this.open();
      } catch {}
    }
    return this.source ? { source: this.source, devices: this.source.read() } : null;
  }
  close() {
    this.source?.close();
    this.source = null;
    this.opened = false;
    this.held.clear();
  }
}
