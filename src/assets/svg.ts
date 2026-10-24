//! Reads a brand mark's SVG file into the paths tabs fill. It runs as a Bun
//! macro, at build time, so Corgi carries the paths and neither the files
//! nor this reader.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Art {
  /** The paths' box, as SVG's viewBox: x, y, width, height. */
  view: [number, number, number, number];
  /** Fills in order, each a hex color, or "ink" for the tabs' text color,
   * and its path. */
  layers: [string, string][];
}

/** The mark in assets/brand_icons/`name`.svg. */
export function svg(name: string): Art {
  const file = join(import.meta.dir, "../../assets/brand_icons", name + ".svg");
  return parse(readFileSync(file, "utf8"), file);
}

/** Only what the rasterizer draws: a view box and filled paths, with
 * `currentColor` for ink. Titles and metadata are skipped; anything else
 * fails the build rather than drawing wrong. */
export function parse(text: string, file: string): Art {
  const fail = (what: string): never => {
    throw Error(`${file}: ${what}`);
  };
  const body = text.replace(/<\?xml[^>]*\?>|<!--[\s\S]*?-->|<(title|desc|metadata)\b[\s\S]*?<\/\1>/g, "");
  let view: Art["view"] | null = null;
  const layers: Art["layers"] = [];
  for (const [, closing, tag, rest] of body.matchAll(/<(\/?)([\w:-]+)([^>]*)>/g)) {
    if (closing) continue;
    const attrs = new Map([...rest.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    switch (tag) {
      case "svg": {
        const box = (attrs.get("viewBox") ?? "")
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (box.length !== 4 || !box.every(Number.isFinite)) fail("needs a viewBox");
        view = box as Art["view"];
        break;
      }
      case "path": {
        for (const key of attrs.keys()) if (!["id", "fill", "d"].includes(key)) fail(`unsupported ${key} on <path>`);
        const fill = attrs.get("fill") ?? "",
          d = attrs.get("d") ?? fail("<path> without d");
        if (fill === "currentColor") layers.push(["ink", d]);
        else if (/^#[0-9a-fA-F]{6}$/.test(fill)) layers.push([fill.slice(1).toUpperCase(), d]);
        else fail(`unsupported fill "${fill}"`);
        break;
      }
      default:
        fail(`unsupported <${tag}>`);
    }
  }
  if (!view || !layers.length) return fail("needs a viewBox and a path");
  return { view, layers };
}
