/**
 * Codepoint widths on the landing page, which has no native layer: Ghostty's
 * table, kept in frames.json as the ranges whose width isn't 1. package.json's
 * "browser" field puts this in place of src/viewer_native.ts for text.ts.
 */
import DATA from "../frames.json";

let table: Uint8Array | null = null;
export function codepointWidths(): Uint8Array {
  if (!table) {
    table = new Uint8Array(0x110000).fill(1);
    for (const [from, to, width] of (DATA as unknown as { widths: [number, number, number][] }).widths)
      table.fill(width, from, to + 1);
  }
  return table;
}
