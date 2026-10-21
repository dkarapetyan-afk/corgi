/**
 * Builds the landing page into one self-contained site/dist/index.html, with
 * the moonlander easter egg beside it in site/dist/moonlander.html.
 * Bun.build rather than `bun build --compile`, which skips package.json's
 * "browser" field and so the page's stand-ins in site/browser/.
 */
import { join } from "node:path";
import * as prerender from "./prerender";

const result = await Bun.build({
  entrypoints: [await prerender.prepare(), join(import.meta.dir, "moonlander.html")],
  outdir: join(import.meta.dir, "dist"),
  naming: "[name].[ext]",
  target: "browser",
  minify: true,
  compile: true,
});
for (const log of result.logs) console.error(log);
if (!result.success) process.exit(1);
for (const out of result.outputs) console.log(out.path);
