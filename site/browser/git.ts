/**
 * The review panel's git on the landing page. The recorder made the thruster
 * tuning's checkout for real and kept what git answered about it in frames.json;
 * this answers the panel the same, its times moved up to now. package.json's
 * "browser" field puts it in place of src/review/git.ts.
 */
import type { Base, Change, Commit, Loaded, Source } from "../../src/review/git";
import * as diff from "../../src/review/diff";
import DATA from "../frames.json";

/** What git answered, as the recorder keeps it. */
export interface Fixture {
  /** When git was read, in seconds. */
  at: number;
  root: string;
  head: string;
  branch: string;
  base: Base | null;
  commits: Commit[];
  /** Each source's changes, under the panel's key for the source. */
  listings: Record<string, Change[]>;
  /** When each file in the working tree was last written, in ms. */
  edited: Record<string, number>;
  /** Each file's diff under its source's key and path: the patch, or why there is none. */
  diffs: Record<string, string | Exclude<Loaded, { kind: "diff" }>>;
}
const fixture = (DATA as unknown as { review: Fixture }).review;
const shift = Date.now() / 1000 - fixture.at;
const sourceKey = (s: Source) => (s.kind === "worktree" ? `w:${s.against}` : `c:${s.hash}`);

/** As git.ts has it. */
export const empty_tree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export async function toplevel(cwd: string): Promise<string | null> {
  return cwd ? fixture.root : null;
}
export async function head(_root: string): Promise<string | null> {
  return fixture.head;
}
export async function branch(_root: string): Promise<string | null> {
  return fixture.branch;
}
export async function base(_root: string): Promise<Base | null> {
  return fixture.base;
}
export async function commits(_root: string, _base: Base | null): Promise<Commit[]> {
  return fixture.commits.map(c => ({ ...c, time: Math.round(c.time + shift) }));
}
export async function changes(_root: string, source: Source): Promise<Change[]> {
  const listed = fixture.listings[sourceKey(source)];
  if (!listed) throw Error("GitFailed");
  // Recorded before Changes carried `funcname`.
  return listed.map(c => ({ ...c, funcname: c.funcname ?? false }));
}
export async function edited(_root: string, paths: string[]): Promise<Map<string, number>> {
  return new Map(paths.filter(path => path in fixture.edited).map(path => [path, fixture.edited[path] + shift * 1000]));
}
export async function fileDiff(_root: string, source: Source, change: Change): Promise<Loaded> {
  const found = fixture.diffs[`${sourceKey(source)}\0${change.path}`];
  if (found === undefined) return { kind: "failed", message: "git diff failed" };
  if (typeof found !== "string") return found;
  const parsed = diff.parse(found);
  return parsed === "binary" ? { kind: "binary" } : { kind: "diff", diff: parsed };
}
