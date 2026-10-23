//! The screen reading every provider's watcher shares: a screen's reading,
//! confirmed over a few reads before it speaks for an agent no hook reports,
//! and what it shows of a compaction or a permission prompt. Each provider's
//! watcher builds on it with what only it knows.
import type { Hook } from "./common";
import type { Known, PaneMemory, PaneView, Seen, Watcher } from "./adapter";
/** What a provider's screen shows, from its own reader. */
export type Reading = "initializing" | "working" | "compacting" | "tool" | "idle" | "blocked";
export class ScreenWatcher implements Watcher {
  constructor(readonly reading: (title: string, text: string) => Reading | null) {}
  /** A hook goes to the pane it came from, whose conversation it names. */
  route(_hook: NonNullable<Hook>, from: number | null, _showing: (session: string) => number | null) {
    return from === null ? null : { pane: from, binds: true };
  }
  read(pane: PaneView, memory: PaneMemory, known: Known | null, _now: number): Seen {
    const seen: Seen = { shown: null, compacting: null, interrupted: false, answered: null, prompt: null };
    let reading: Reading | null | undefined;
    const read = () => (reading === undefined ? (reading = this.reading(pane.title, pane.text())) : reading);
    if (!known?.authoritative) seen.shown = this.confirm(memory, read());
    if (known?.state === "working" || seen.shown?.state === "working") {
      const r = read();
      seen.compacting = r === "compacting" ? true : r === "working" || r === "tool" ? false : null;
    }
    if (known?.permission_review) seen.prompt = read() === "blocked";
    return seen;
  }
  /** The state a reading confirms: idle three reads in a row, anything else
   * two. Working needs a prior idle screen unless identity is explicit. */
  protected confirm(memory: PaneMemory, reading: Reading | null) {
    const next = reading === "compacting" || reading === "tool" ? "working" : reading;
    if (!next || (next === "working" && !memory.ready && !memory.allow_initial_work)) {
      memory.candidate = null;
      memory.confirmations = 0;
      return null;
    }
    if (memory.candidate !== next) {
      memory.candidate = next;
      memory.confirmations = 0;
    }
    memory.confirmations = Math.min(255, memory.confirmations + 1);
    if (memory.confirmations < (next === "idle" ? 3 : 2)) return null;
    return { state: next, tool: reading === "tool" };
  }
}
