//! What Claude Code's screen shows, for panes without its hooks and for what
//! its hooks leave out: a prompt answered, a turn interrupted.
import type { State } from "../../agents";
import { screenTail, sharedPrompt } from "../common";
import type { Known, PaneMemory, PaneView, PromptMemory, Seen } from "../adapter";
import { ScreenWatcher, type Reading } from "../watcher";
export function screen(title: string, text: string): Reading | null {
  return sharedPrompt(text) ?? (title.startsWith("✳ ") ? "idle" : null);
}
/** Whether its input box shows: a prompt or dialog covers it otherwise. */
export function composer(text: string): "open" | "covered" | "unknown" {
  let after = false,
    input = false,
    found = false;
  for (const row of text.split("\n")) {
    if (/^─{10,}$/.test(row.trim())) {
      if (input) found = true;
      input = false;
      after = true;
      continue;
    }
    if (after) input = row.trimStart().startsWith("❯");
    after = false;
  }
  if (!found) return "covered";
  if (/esc to cancel|enter to select|enter to confirm|enter to submit/.test(screenTail(text))) return "unknown";
  return "open";
}
/** Whether a turn its hooks call working was interrupted: the screen has
 * stayed idle long enough, or a while after an interrupt key. */
export function interrupted(reading: Reading | null, memory: PaneMemory, now: number) {
  if (reading !== "idle") {
    memory.idle_since = 0;
    return false;
  }
  if (!memory.idle_since) memory.idle_since = now;
  if (
    memory.interrupt_key_at &&
    now - memory.interrupt_key_at <= 5000000 &&
    now - Math.max(memory.idle_since, memory.interrupt_key_at) >= 250000
  )
    return true;
  return now - memory.idle_since >= 1500000;
}
/** Ends a block its hooks reported once the screen shows the prompt was seen
 * and then answered: what the agent does now, or null. */
export function answered(prompt: PromptMemory, blocked: boolean, text: string): State | null {
  const reset = () => Object.assign(prompt, { seen: false, covered: 0, open: 0 });
  if (!blocked) {
    reset();
    return null;
  }
  switch (composer(text)) {
    case "covered":
      prompt.covered = Math.min(255, prompt.covered + 1);
      prompt.open = 0;
      if (prompt.covered >= 2) prompt.seen = true;
      return null;
    case "unknown":
      prompt.covered = 0;
      prompt.open = 0;
      return null;
    case "open":
      prompt.covered = 0;
      if (!prompt.seen) return null;
      prompt.open = Math.min(255, prompt.open + 1);
      if (prompt.open < 2) return null;
      reset();
      return screen("", text) === "working" ? "working" : "idle";
  }
}
/** Claude's hooks report neither a turn the user interrupts nor a prompt
 * answered, so its screen tells both. */
export class Watcher extends ScreenWatcher {
  constructor() {
    super(screen);
  }
  read(pane: PaneView, memory: PaneMemory, known: Known | null, now: number): Seen {
    const seen = super.read(pane, memory, known, now);
    if (!known) return seen;
    if (!known.authoritative || known.state !== "working" || known.pending_stop) memory.idle_since = 0;
    else if (interrupted(screen(pane.title, pane.text()), memory, now)) {
      seen.interrupted = true;
      memory.idle_since = 0;
      memory.interrupt_key_at = 0;
    }
    const blocked = known.authoritative && known.state === "blocked";
    seen.answered = answered(known.prompt, blocked, blocked ? pane.text() : "");
    return seen;
  }
}
