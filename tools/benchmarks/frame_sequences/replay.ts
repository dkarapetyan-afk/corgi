//! Offline corpus loader, screen oracle and diff-only benchmark.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Differ } from "../../../src/frame_diff";
import * as native from "../../../src/native_ffi";

export interface Sequence {
  name: string;
  cols: number;
  rows: number;
  durationMs: number;
  frames: { at: number; frame: string }[];
}
export const directory = join(import.meta.dir, "fixtures");
export const names = (source = directory) =>
  readdirSync(source)
    .filter(name => name.endsWith(".json.gz"))
    .map(name => name.slice(0, -8))
    .sort();
export async function load(name: string, source = directory): Promise<Sequence> {
  return JSON.parse(Buffer.from(Bun.gunzipSync(await Bun.file(join(source, `${name}.json.gz`)).bytes())).toString());
}

export function verify(sequence: Sequence, stride = 1): number {
  let bytes = 0;
  const whole = native.terminal(),
    delta = native.terminal();
  const d = Differ.create(sequence.cols, sequence.rows);
  whole.resize(sequence.cols, sequence.rows);
  delta.resize(sequence.cols, sequence.rows);
  try {
    for (let i = 0; i < sequence.frames.length; i += stride) {
      const frame = sequence.frames[i].frame;
      whole.feed(frame);
      const out = d.diff(frame);
      bytes += out.length;
      delta.feed(out);
      if (!delta.snapshot().equals(whole.snapshot())) throw Error(`${sequence.name} frame ${i}: replay differs`);
      if (d.diff(frame).length !== 0) throw Error(`${sequence.name} frame ${i}: identical frame writes bytes`);
    }
  } finally {
    d.destroy();
    whole.close();
    delta.close();
  }
  return bytes;
}

export function benchmark(sequence: Sequence) {
  const frames = sequence.frames.map(({ frame }) => Buffer.from(frame));
  const samples: number[] = [],
    cpu: number[] = [];
  let bytes = 0,
    initial = 0;
  for (let pass = 0; pass < 18; pass++) {
    const d = Differ.create(sequence.cols, sequence.rows);
    let total = 0;
    const usage = process.cpuUsage();
    try {
      for (let i = 0; i < frames.length; i++) {
        const start = performance.now();
        const out = d.diff(frames[i]);
        if (pass >= 3) samples.push((performance.now() - start) * 1000);
        total += out.length;
        if (i === 0) initial = out.length;
      }
    } finally {
      d.destroy();
    }
    if (pass >= 3) {
      const elapsed = process.cpuUsage(usage);
      cpu.push((elapsed.user + elapsed.system) / frames.length);
    }
    bytes = total;
  }
  samples.sort((a, b) => a - b);
  cpu.sort((a, b) => a - b);
  const memory = process.memoryUsage();
  return {
    name: sequence.name,
    frames: frames.length,
    inputBytes: frames.reduce((n, f) => n + f.length, 0),
    bytes,
    initialBytes: initial,
    steadyBytes: bytes - initial,
    bytesPerSecond: (bytes * 1000) / sequence.durationMs,
    medianUs: samples[Math.floor(samples.length / 2)],
    p95Us: samples[Math.floor(samples.length * 0.95)],
    cpuUsPerFrame: cpu[Math.floor(cpu.length / 2)],
    rssBytes: memory.rss,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    heapUsedBytes: memory.heapUsed,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const selected: string[] = [];
  let source = directory,
    check = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verify") check = true;
    else if (args[i] === "--directory") {
      if (!args[i + 1] || args[i + 1].startsWith("--")) throw Error("--directory needs a path");
      source = args[++i];
    } else if (args[i].startsWith("--")) throw Error(`Unknown option: ${args[i]}`);
    else selected.push(args[i]);
  }
  for (const name of selected.length ? selected : names(source)) {
    const sequence = await load(name, source);
    if (check) {
      verify(sequence);
      verify(sequence, 7);
      console.log(`${name}: verified ${sequence.frames.length} frames and dropped-frame replay`);
    } else console.log(JSON.stringify(benchmark(sequence)));
  }
}
