/**
 * Serves the landing page.
 *
 *   bun site/serve.ts --dev   bundle on request and reload on save
 *   bun site/serve.ts         serve the build in site/dist
 *
 * PORT picks the port (4400). /moonlander serves the moonlander easter egg,
 * a page of its own.
 */
import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import * as prerender from "./prerender";

const port = Number(process.env.PORT ?? 4400);
const dev = process.argv.includes("--dev");
const built = (page: string) => () => new Response(Bun.file(join(import.meta.dir, "dist", page)));

if (dev) {
  await prerender.prepare();
  const { default: page } = await import("./.generated/index.html");
  const { default: moonlander } = await import("./moonlander.html");
  Bun.serve({ port, routes: { "/": page, "/moonlander": moonlander }, development: { hmr: true, console: true } });
  let timer: ReturnType<typeof setTimeout>,
    running = false,
    pending = false;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      pending = true;
      if (running) return;
      running = true;
      try {
        while (pending) {
          pending = false;
          await prerender.prepare();
        }
      } catch (error) {
        console.error("Hero prerender failed:", error);
      } finally {
        running = false;
      }
    }, 200);
  };
  for (const directory of ["site", "src", "assets"])
    watch(join(import.meta.dir, "..", directory), { recursive: true }, (_event, file) => {
      if (file && !/^(?:\.generated|dist)\//.test(file) && /\.(?:ts|js|html|css|json|md)$/.test(file)) changed();
    });
  watch(join(import.meta.dir, "..", "package.json"), changed);
} else {
  if (!existsSync(join(import.meta.dir, "dist", "moonlander.html"))) {
    console.error("No build in site/dist; run bun run landingpage:build");
    process.exit(1);
  }
  Bun.serve({
    port,
    // Read on each request, so a rebuild shows without a restart.
    routes: { "/": built("index.html"), "/moonlander": built("moonlander.html") },
    fetch: () => new Response("Not found", { status: 404 }),
  });
}
console.log(`landing page ${dev ? "(dev) " : ""}at http://localhost:${port}/`);
