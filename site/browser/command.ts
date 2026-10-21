/**
 * Agent launch commands on the landing page, which launches nothing. The
 * worktree overview dates rows with the launcher's ages, and the launcher's
 * name dialog imports this for a footer the page never opens. package.json's
 * "browser" field puts this in place of src/launch/command.ts.
 */
import type { Provider } from "../../src/providers";

export function identify(_source: string): Provider | null {
  return null;
}
export function shell(): string {
  return "/bin/zsh";
}
