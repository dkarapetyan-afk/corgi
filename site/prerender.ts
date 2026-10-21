/** The first hero frame, drawn by the same page bundle that takes it over. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as tooling from "../scripts/tooling";
import * as heroConfig from "./hero_config";

const root = import.meta.dir;
export const directory = join(root, ".generated");

export async function render(html: string, bundle: string): Promise<string> {
  const [dom] = await tooling.packages("site", { "happy-dom": "21.0.4" });
  const { Window } = await import(join(dom, "lib", "index.js"));
  const frames = [];
  for (const [name, width] of [
    ["desktop", heroConfig.mobile.breakpoint + 1],
    ["mobile", heroConfig.mobile.breakpoint - 1],
  ] as const) {
    const window = new Window({
      url: "http://localhost/",
      width,
      height: 900,
      settings: {
        disableCSSFileLoading: true,
        disableJavaScriptFileLoading: true,
        enableJavaScriptEvaluation: true,
        // Only the freshly built local bundle is evaluated.
        suppressInsecureJavaScriptEnvironmentWarning: true,
      },
    });
    try {
      window.structuredClone = structuredClone;
      window.document.write(html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<link\b[^>]*>/gi, ""));
      // No layout engine or animation clock is needed to draw the cell grid.
      Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get: () => width });
      Object.defineProperty(window.performance, "now", { value: () => 0 });
      window.setInterval = window.setTimeout = window.requestAnimationFrame = () => 0;
      window.eval(bundle);
      const screen = window.document.getElementById("v-sim");
      const cols = Number(screen.style.getPropertyValue("--cols"));
      const rows = [...screen.querySelectorAll(":scope > .r")];
      if (!cols || !rows.length || !rows.some(row => row.textContent.trim()))
        throw Error(`The ${name} hero did not paint its first frame`);
      for (const row of rows) {
        for (const cell of [...row.querySelectorAll(":scope > span")].slice(cols)) cell.remove();
      }
      frames.push({ name, cols, rows: rows.length, html: screen.innerHTML });
    } finally {
      await window.happyDOM.close();
    }
  }
  const [desktop, mobile] = frames;
  const initial = frames
    .map(frame => `<div class="hero-initial hero-initial-${frame.name}" data-cols="${frame.cols}">${frame.html}</div>`)
    .join("");
  const css = `<style id="hero-initial-layout">
    #v-sim { --cols: ${desktop.cols}; --rows: ${desktop.rows}; }
    .hero-initial-mobile { display: none; }
    @container (width < ${heroConfig.mobile.breakpoint}px) {
      #v-sim { --cols: ${mobile.cols}; --rows: ${mobile.rows}; }
      .hero-initial-desktop { display: none; }
      .hero-initial-mobile { display: block; }
    }
  </style>`;
  return new HTMLRewriter()
    .on("head", { element: element => element.append(css, { html: true }) })
    .on("#v-sim", {
      element(element) {
        element.setAttribute(
          "style",
          (element.getAttribute("style") ?? "").replace(/--(?:cols|rows):[^;]*(?:;|$)/g, ""),
        );
        element.setInnerContent(initial, { html: true });
      },
    })
    .transform(new Response(html))
    .text();
}

export async function prepare(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(root, "main.js")],
    target: "browser",
    format: "iife",
    minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, "Hero prerender bundle failed");
  const html = await render(await Bun.file(join(root, "index.html")).text(), await result.outputs[0].text());
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "index.html");
  // Local asset paths are relative to site/, one directory above this file.
  const prepared = html.replace(/\b(src|href)="\.\//g, '$1="../');
  const previous = await Bun.file(path)
    .text()
    .catch(() => null);
  if (prepared !== previous) await Bun.write(path, prepared);
  return path;
}
