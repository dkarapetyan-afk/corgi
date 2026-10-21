//! Run baseline/candidate in fresh, alternating processes to isolate memory.
import { mkdirSync, mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import * as replay from "./replay";
const baseline = process.argv[2];
if (!baseline) throw Error("usage: bun tools/benchmarks/frame_sequences/compare.ts BASELINE_NATIVE_ROOT");
const candidate = resolve(import.meta.dir, "../../../native/zig-out");
const output = resolve(import.meta.dir, "../../../dist/benchmarks");
mkdirSync(output, { recursive: true });
const recordings = mkdtempSync(resolve(output, "frame-sequences-"));
const games = ["moonlander", "moonlander-kitty"];
for (const name of games) {
  console.error(`Recording ${name} into ${recordings}`);
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "record.ts"), name, recordings], {
    env: { ...process.env, CORGI_NATIVE_ROOT: candidate },
    stdout: "ignore",
    stderr: "inherit",
  });
  if (await child.exited) throw Error(`${name} recording failed`);
  const sequence = await replay.load(name, recordings);
  replay.verify(sequence);
  replay.verify(sequence, 7);
}
const results: Record<string, unknown[]> = { baseline: [], candidate: [] };
for (let round = 0; round < 3; round++) {
  for (const name of [...replay.names(), ...games]) {
    for (const variant of round % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
      const source = games.includes(name) ? recordings : replay.directory;
      const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "replay.ts"), "--directory", source, name], {
        env: { ...process.env, CORGI_NATIVE_ROOT: variant === "baseline" ? resolve(baseline) : candidate },
        stdout: "pipe",
        stderr: "inherit",
      });
      const output = await new Response(child.stdout).text();
      if (await child.exited) throw Error(`${variant}/${name} failed`);
      results[variant].push({ round, ...JSON.parse(output) });
    }
  }
}
console.log(
  JSON.stringify(
    {
      baseline: resolve(baseline),
      candidate,
      recordings,
      platform: `${process.platform}/${process.arch}`,
      bun: Bun.version,
      results,
    },
    null,
    2,
  ),
);
