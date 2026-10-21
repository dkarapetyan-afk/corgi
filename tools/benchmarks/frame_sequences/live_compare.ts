//! Resume a sequential live comparison; keep partial results if a run fails.
import { resolve, join } from "node:path";
const before = resolve(process.argv[2]),
  after = resolve(process.argv[3]);
const output = resolve(process.argv[4] ?? "dist/bandwidth");
for (const workload of ["moonlander", "corgi-moonlander", "corgi"]) {
  for (const [variant, root] of [
    ["before", before],
    ["after", after],
  ]) {
    const directory = join(output, `${variant}-${workload}`);
    const saved = Bun.file(join(directory, "bandwidth.json"));
    if (await saved.exists()) {
      const data = await saved.json();
      const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim();
      if (data.root !== root || data.revision !== revision || data.workload !== workload)
        throw Error(`Stale result in ${directory}; choose a fresh output directory`);
      continue;
    }
    console.log(`Starting ${variant} ${workload}`);
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "live_bandwidth.ts"), root, workload, directory], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (await child.exited) throw Error(`${variant} ${workload} failed`);
  }
}
