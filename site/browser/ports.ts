/**
 * The port tracker on the landing page, which scans no ports. The worktree
 * overview imports the sidebar for its counts and pulse, and the sidebar
 * imports this for its links' addresses, which the page never draws live.
 * package.json's "browser" field puts this in place of src/trackers/ports.ts.
 */
import type { Endpoint } from "../../src/trackers/ports";

export function url(_e: Endpoint, _remote: boolean): string | null {
  return null;
}
