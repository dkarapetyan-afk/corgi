/**
 * Builds the landing page and deploys it to corgi.computer with wrangler, as
 * a Worker serving static assets on / and /moonlander (site/wrangler.jsonc).
 * Other paths pass through to the release bucket, install.sh among them.
 */
import { join } from "node:path";
import * as tooling from "../scripts/tooling.ts";

const run = (argv: string[]) => Bun.spawnSync(argv, { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).success;
if (!run([process.execPath, join(import.meta.dir, "build.ts")])) process.exit(1);
const [wrangler] = await tooling.packages("deploy", { wrangler: "4.148.0" });
const deploy = [
  process.execPath,
  join(wrangler, "bin", "wrangler.js"),
  "deploy",
  "--config",
  join(import.meta.dir, "wrangler.jsonc"),
];
if (!run([...deploy, ...process.argv.slice(2)])) process.exit(1);
if (process.argv.includes("--dry-run")) process.exit(0);

// What visitors get: this build on the Worker's paths, the bucket's beside them.
const checks = [
  { path: "/", file: "index.html" },
  { path: "/moonlander", file: "moonlander.html" },
  { path: "/?ref=deploy-check", file: "index.html" },
  { path: "/moonlander?ref=deploy-check", file: "moonlander.html" },
  { path: "/install.sh", file: null },
  { path: "/channels/stable.json", file: null },
];
let failed = false;
for (const check of checks) {
  // New routes can take a few seconds to reach the serving edge.
  for (let attempt = 0; ; attempt++) {
    const served = await fetch(`https://corgi.computer${check.path}`, { redirect: "manual" });
    const bytes = Buffer.from(await served.arrayBuffer());
    const same = check.file === null || bytes.equals(await Bun.file(join(import.meta.dir, "dist", check.file)).bytes());
    if ((served.status !== 200 || !same) && attempt < 11) {
      await Bun.sleep(2500);
      continue;
    }
    console.log(`https://corgi.computer${check.path}: HTTP ${served.status}${same ? "" : ", not this build"}`);
    if (served.status !== 200 || !same) failed = true;
    break;
  }
}
if (failed) process.exitCode = 1;
