/**
 * Git's status tracker on the landing page, which runs no git: the worktree
 * overview imports it only to clean the text it prints. package.json's
 * "browser" field puts this in place of src/trackers/git_status.ts.
 */
const bytes = new TextEncoder();

/** As the tracker's: control characters become spaces, cut at `capacity` bytes. */
export function clean(source: string, capacity = source.length * 4) {
  let out = "";
  for (const ch of source) {
    const cp = ch.codePointAt(0)!,
      v = cp >= 32 && !(cp >= 127 && cp <= 159) && cp !== 0xfffd ? ch : " ";
    if (bytes.encode(out + v).length > capacity) break;
    out += v;
  }
  return out;
}
