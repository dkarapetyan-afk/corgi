/**
 * The resource card's story, a second at a time: each workspace's processes
 * on the laptop keeps watch shows, and on the eight-GPU host of the resources
 * band, where moonlander also trains its autopilot. The page folds the
 * seconds into history with Corgi's tracker, so the card's graphs and the
 * leaders it lists for a moment past are Corgi's own; the recorder draws the
 * sidebar's rows from the first second.
 */
import type { Provider } from "../src/providers";
import * as gpu from "../src/trackers/gpu";
import { Process, Snapshot, Work, record, standouts, type Point } from "../src/trackers/resources";

/** The page loops this many seconds, a sample a second. */
export const loop_s = 120;
export type Host = "laptop" | "gpus";
const MiB = 1 << 20,
  GiB = 1 << 30;

// ---------------------------------------------------------------- the laptop
/** The laptop's processes take twelve steps of ten seconds round the loop. */
const STEPS = 12,
  step_s = loop_s / STEPS;
type Proc = {
  pid: number;
  name: string;
  provider?: Provider;
  cpu: (number | null)[];
  /** MiB. */
  memory: number[];
  /** MB/s. */
  read?: number[];
  written?: number[];
};
const same = (n: number) => Array<number>(STEPS).fill(n);
/** corgi: "Fix sidebar flicker" edits (steps 2-3, zls re-reads the file),
 * runs `./scripts/zig build test -Dtest-filter=sidebar` (compile 4-7, link
 * writes the test binary, tests 8-1), and reads the result. Codex's verifier
 * downloads the release to check its checksums (1-3). The rest idle along. */
const CORGI_PROCS: Proc[] = [
  // Fix sidebar flicker, and the zls its LSP tool started.
  {
    pid: 51536,
    name: "claude",
    provider: "claude",
    cpu: [7.1, 7.8, 9.6, 6.9, 7.4, 6.6, 6.2, 6.8, 7.6, 7.2, 6.9, 7.3],
    memory: [406, 407, 409, 410, 404, 404, 405, 405, 406, 406, 406, 406],
    written: [0.2, 0.3, 0.1, 0.2, 0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.1, 0.2],
  },
  {
    pid: 51544,
    name: "zls",
    cpu: [1.3, 1.4, 1.2, 5.2, 1.6, 1.3, 1.2, 1.4, 1.3, 1.2, 1.4, 1.3],
    memory: [347, 347, 347, 352, 351, 350, 350, 349, 349, 348, 348, 348],
    read: [0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // Its Bash tool's shell, the zig build, the build runner, the compiler and the test binary.
  { pid: 53975, name: "zsh", cpu: [0.0, 0.0, null, null, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], memory: same(3.1) },
  {
    pid: 53977,
    name: "zig",
    cpu: [0.2, 0.6, null, null, 0.9, 0.3, 0.2, 0.4, 0.3, 0.2, 0.2, 0.2],
    memory: [41, 42, 0, 0, 38, 40, 40, 41, 41, 41, 41, 41],
    read: [0, 0, 0, 0, 1.2, 0, 0, 0, 0, 0, 0, 0],
    written: [0, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    pid: 53984,
    name: "build",
    cpu: [0.4, 0.8, null, null, 1.1, 0.4, 0.3, 0.5, 0.6, 0.4, 0.4, 0.4],
    memory: [66, 66, 0, 0, 58, 63, 64, 64, 65, 65, 66, 66],
    read: [0, 0, 0, 0, 2.6, 0.3, 0, 0, 0, 0, 0, 0],
    written: [0, 0.2, 0, 0, 0.1, 0, 0, 0.1, 0, 0, 0, 0],
  },
  {
    pid: 53989,
    name: "zig",
    cpu: [null, null, null, null, 41.3, 72.6, 66.1, 28.4, null, null, null, null],
    memory: [0, 0, 0, 0, 412, 596, 758, 823, 0, 0, 0, 0],
    read: [0, 0, 0, 0, 18.2, 6.4, 2.2, 1.1, 0, 0, 0, 0],
    written: [0, 0, 0, 0, 2.1, 9.8, 21.5, 46.8, 0, 0, 0, 0],
  },
  {
    pid: 53996,
    name: "test",
    cpu: [31.2, 12.4, null, null, null, null, null, null, 36.8, 44.1, 41.5, 38.0],
    memory: [86, 88, 0, 0, 0, 0, 0, 0, 48, 72, 80, 84],
    read: [0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0],
    written: [0.4, 0.2, 0, 0, 0, 0, 0, 0, 0.3, 0.8, 0.5, 0.6],
  },
  // Audit the install script: Codex runs both subagents; the verifier's curl.
  {
    pid: 52926,
    name: "codex",
    provider: "codex",
    cpu: [4.4, 4.8, 4.6, 4.5, 4.8, 4.2, 4.0, 4.3, 4.6, 4.9, 4.5, 4.1],
    memory: [133, 134, 135, 135, 134, 134, 133, 133, 132, 132, 133, 133],
    written: [0.1, 0.1, 0.1, 0.1, 0.1, 0, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
  },
  {
    pid: 53958,
    name: "zsh",
    cpu: [null, 0.0, 0.0, 0.0, null, null, null, null, null, null, null, null],
    memory: same(3.0),
  },
  {
    pid: 53961,
    name: "curl",
    cpu: [null, 1.1, 2.6, 2.2, null, null, null, null, null, null, null, null],
    memory: same(9.0),
    written: [0, 3.1, 12.6, 8.9, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // Release notes, waiting for permission.
  {
    pid: 52431,
    name: "claude",
    provider: "claude",
    cpu: [0.3, 0.2, 0.3, 0.3, 0.2, 0.3, 0.3, 0.2, 0.3, 0.3, 0.2, 0.3],
    memory: same(268),
  },
  // Refactor the viewer, compacting a long context.
  {
    pid: 50873,
    name: "claude",
    provider: "claude",
    cpu: [3.6, 3.9, 3.7, 3.9, 3.6, 3.4, 3.3, 3.5, 3.6, 3.8, 3.7, 3.5],
    memory: [509, 510, 511, 512, 513, 513, 514, 514, 515, 515, 516, 516],
    written: [0, 0.1, 0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 0],
  },
  // Ghostty keybindings, finished.
  {
    pid: 49817,
    name: "codex",
    provider: "codex",
    cpu: [0.1, 0.0, 0.0, 0.1, 0.0, 0.0, 0.1, 0.0, 0.0, 0.1, 0.0, 0.0],
    memory: same(74),
  },
];
/** moonlander, a Bun site: "Tune the thruster physics" saves physics.ts (2),
 * the `bun --hot` dev server reloads and its `bun test --watch` reruns
 * (3-7), the e2e suite driving the game in its headless browser. */
const MOON_PROCS: Proc[] = [
  // Draw the lander sprite, idle.
  {
    pid: 48297,
    name: "claude",
    provider: "claude",
    cpu: [0.3, 0.3, 0.4, 0.3, 0.3, 0.3, 0.4, 0.3, 0.3, 0.3, 0.4, 0.3],
    memory: same(188),
  },
  // Tune the thruster physics, and the dev server and tests it left running.
  {
    pid: 52677,
    name: "claude",
    provider: "claude",
    cpu: [7.4, 8.6, 6.9, 6.2, 8.1, 8.8, 8.6, 7.9, 7.8, 8.2, 7.6, 7.1],
    memory: [278, 279, 281, 282, 281, 283, 283, 282, 281, 280, 279, 278],
    written: [0.1, 0.2, 0.2, 0.1, 0.1, 0.2, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1],
  },
  { pid: 52801, name: "zsh", cpu: same(0.0), memory: same(3.1) },
  {
    pid: 52803,
    name: "bun",
    cpu: [0.5, 0.6, 3.4, 1.1, 0.6, 0.5, 0.5, 0.5, 0.5, 0.6, 0.5, 0.5],
    memory: [62, 62, 66, 65, 64, 64, 63, 63, 63, 62, 62, 62],
    read: [0, 0, 1.4, 0.2, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  { pid: 53088, name: "zsh", cpu: same(0.0), memory: same(3.0) },
  {
    pid: 53090,
    name: "bun",
    cpu: [0.2, 0.2, 0.3, 24.3, 58.7, 63.9, 41.2, 12.8, 0.2, 0.2, 0.2, 0.2],
    memory: [74, 74, 74, 96, 118, 126, 128, 104, 76, 74, 74, 74],
    read: [0, 0, 0, 6.2, 1.1, 0.2, 0, 0, 0, 0, 0, 0],
    written: [0, 0, 0, 0, 0.3, 0.4, 0.2, 0.1, 0, 0, 0, 0],
  },
  {
    pid: 53097,
    name: "chrome-headless-shell",
    cpu: [1.1, 1.0, 1.2, 1.3, 2.4, 3.1, 2.8, 1.6, 1.2, 1.1, 1.0, 1.1],
    memory: same(72),
    written: [0, 0, 0, 0, 0.1, 0.3, 0.2, 0, 0, 0, 0, 0],
  },
  {
    pid: 53102,
    name: "chrome-headless-shell",
    cpu: [4.6, 4.9, 4.7, 5.1, 5.4, 7.9, 7.2, 5.6, 4.8, 4.6, 4.5, 4.7],
    memory: [121, 121, 122, 124, 131, 134, 133, 126, 122, 121, 121, 121],
    written: [0, 0, 0, 0, 0.2, 0.6, 0.4, 0.1, 0, 0, 0, 0],
  },
];

// ---------------------------------------------------------------- the GPU host
/** moonlander's autopilot training: torchrun and its eight ranks, one to a
 * GPU, rank 5 a little behind the rest. Rank 0 evaluates the policy alone at
 * 50-61 s while the others wait at the barrier, and at 90-99 s every rank
 * checkpoints, rank 0 writing it out. */
const TRAINING: Source[] = [
  { pid: 61731, name: "torchrun", at: s => ({ cpu: 0.4 * jiggle(61731, s, 0.2), memory: 384, read: 0, written: 0 }) },
  ...Array.from({ length: 8 }, (_, r): Source => {
    const pid = 61742 + r,
      by = (amount: number, k: number, s: number) => jiggle(pid * 4 + k, s, amount);
    return {
      pid,
      name: "python",
      at: s => {
        const phase = s >= 50 && s < 62 ? "eval" : s >= 90 && s < 100 ? "save" : "train",
          lead = r === 0;
        const util =
          phase === "train"
            ? (r === 5 ? 86 : 95) * by(0.04, 0, s)
            : phase === "eval"
              ? lead
                ? 72 * by(0.1, 0, s)
                : 4 * by(0.5, 0, s)
              : 12 * by(0.4, 0, s);
        return {
          cpu: (phase === "save" ? (lead ? 164 : 38) : phase === "eval" && !lead ? 99 : 112) * by(0.1, 1, s),
          memory: (5.9 + r * 0.06 + (phase === "save" && lead ? 3.6 : 0)) * 1024,
          read: phase === "train" ? 41 * by(0.3, 2, s) : 0,
          written: phase === "save" && lead && s < 97 ? 1850 * by(0.1, 3, s) : 0,
          gpu: {
            index: r,
            util: Math.min(100, util),
            memory: 61.5 + r * 0.4 + (phase === "save" ? 3.4 : phase === "eval" && lead ? 5.2 : 0),
          },
        };
      },
    };
  }),
];
/** Its GPUs, each holding a little beyond what its processes hold. */
const devices = 8,
  device_total = 80 * GiB,
  device_other = GiB / 2;

// ---------------------------------------------------------------- sampling
/** What a process reads at one second: CPU %, memory in MiB, disk I/O in
 * MB/s, and its GPU's utilization % and memory in GiB. */
type Reading = {
  cpu: number;
  memory: number;
  read: number;
  written: number;
  gpu?: { index: number; util: number; memory: number };
};
/** A process, and its reading `s` seconds into the loop, or none while it isn't running. */
type Source = { pid: number; name: string; provider?: Provider; at: (s: number) => Reading | null };
/** A smooth wobble in [-1, 1] that is zero where the loop starts and comes round with it. */
function wobble(salt: number, s: number): number {
  const turn = (2 * Math.PI * s) / loop_s;
  return 0.6 * Math.sin(turn * (7 + (salt % 11))) + 0.4 * Math.sin(turn * (17 + (salt % 13)));
}
/** A factor within `amount` of 1. */
const jiggle = (salt: number, s: number, amount: number) => 1 + amount * wobble(salt, s);
/** A table's step at each second, its CPU and I/O wobbling around it. */
function stepped(p: Proc): Source {
  return {
    pid: p.pid,
    name: p.name,
    provider: p.provider,
    at: s => {
      const i = Math.floor(s / step_s) % STEPS,
        cpu = p.cpu[i],
        by = (n: number, amount: number, k: number) => Math.max(0, n * jiggle(p.pid * 4 + k, s, amount));
      if (cpu === null) return null;
      return {
        cpu: by(cpu, 0.08, 0),
        memory: p.memory[i],
        read: by(p.read?.[i] ?? 0, 0.3, 1),
        written: by(p.written?.[i] ?? 0, 0.3, 2),
      };
    },
  };
}
const HOSTS: Record<Host, { cores: number; idle: number; memory_kind: string; gpus: number; workspaces: Source[][] }> =
  {
    laptop: {
      cores: 12,
      idle: 24,
      memory_kind: "footprint",
      gpus: 0,
      workspaces: [CORGI_PROCS.map(stepped), MOON_PROCS.map(stepped)],
    },
    gpus: {
      cores: 96,
      idle: 6,
      memory_kind: "RSS",
      gpus: devices,
      workspaces: [CORGI_PROCS.map(stepped), [...MOON_PROCS.map(stepped), ...TRAINING]],
    },
  };
/** The host at second `s`, its workspaces as the tracker sums them, without history. */
function sample(host: Host, s: number): Snapshot {
  const h = HOSTS[host],
    t = s % loop_s;
  const workspaces = h.workspaces.map((sources, i) => {
    const work = Object.assign(new Work(i + 1), { known: true });
    for (const source of sources) {
      const r = source.at(t);
      if (!r) continue;
      const p = Object.assign(new Process(source.pid, 1n, source.name), {
        provider: source.provider ?? null,
        cpu: r.cpu,
        memory: BigInt(Math.trunc(r.memory * MiB)),
        read: BigInt(Math.trunc(r.read * 1e6)),
        written: BigInt(Math.trunc(r.written * 1e6)),
      });
      if (r.gpu) {
        const memory = BigInt(Math.trunc(r.gpu.memory * GiB)),
          total = gpu.find(work.gpu_devices, r.gpu.index);
        Object.assign(p, { gpu: r.gpu.util, gpu_memory: memory, gpu_devices: [{ ...r.gpu, memory }] });
        total.util = (total.util ?? 0) + r.gpu.util;
        total.memory = (total.memory ?? 0n) + memory;
        work.gpu_attribution = "process";
      }
      work.processes.push(p);
      work.count += 1;
      work.add(p);
    }
    if (h.gpus) {
      work.gpu ??= 0;
      work.gpu_memory ??= 0n;
      work.gpu_shown = work.gpu > 0 || work.gpu_memory > 0n;
    }
    return work;
  });
  const busy = workspaces.reduce((n, w) => n + (w.cpu ?? 0), 0),
    shares = (index: number) => workspaces.map(w => w.gpu_devices.find(d => d.index === index)).filter(d => d != null);
  return Object.assign(new Snapshot(), {
    sampled_at: s * 1000,
    interval_ms: 1000,
    host_cpu: Math.round(h.idle + busy / h.cores),
    cores: h.cores,
    memory_pressure: "normal",
    memory_kind: h.memory_kind,
    gpus: Array.from({ length: h.gpus }, (_, index): gpu.Gpu => ({
      index,
      name: "NVIDIA H100 80GB HBM3",
      util: Math.round(shares(index).reduce((n, d) => n + (d.util ?? 0), 0)),
      used: shares(index).reduce((n, d) => n + (d.memory ?? 0n), BigInt(device_other)),
      total: BigInt(device_total),
    })),
    gpu_memory_kind: h.gpus ? "VRAM" : "",
    workspaces,
  });
}
const loops = new Map<Host, Snapshot[]>();
/** The host `second` into the page's loop, each workspace with its history
 * up to then: a second time round, so the history reaches back past the
 * loop's start. */
export function snapshot(host: Host, second: number): Snapshot {
  let loop = loops.get(host);
  if (!loop) {
    loop = [];
    const history: Point[][] = [];
    for (let s = 0; s < 2 * loop_s; s++) {
      const now = sample(host, s);
      now.workspaces.forEach((w, i) => {
        w.history = history[i] = record(history[i] ?? [], {
          at: s * 1000,
          samples: 1,
          cpu: w.cpu,
          memory: w.memory,
          io: w.read! + w.written!,
          gpus: w.gpu_devices.map(d => ({ ...d })),
          processes: standouts(w.processes),
        });
      });
      if (s >= loop_s) loop.push(now);
    }
    loops.set(host, loop);
  }
  return loop[((second % loop_s) + loop_s) % loop_s];
}
