/**
 * node:fs/promises on the landing page, which has no files. The review panel
 * stats a changed file only to notice it changing again; finding none, it
 * keeps the diff it read. package.json's "browser" field puts this in place.
 */
export async function stat(_path: string): Promise<never> {
  throw Error("FileNotFound");
}
