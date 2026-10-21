import { Meter, Tokens } from "../usage/live";
import { add, sub } from "../usage/tokens";
import type { Event } from "../providers/adapter";
export class System {
  meter = new Meter();
  reports = 0n;
  constructor() {
    this.meter.value.known = true;
  }
  markPartial(reason: string) {
    this.meter.value.partial = true;
  }
}
export class Tracker {
  threads = new Map<string, Tokens>();
  /** Parts already counted. */
  parts = new Set<string>();
  clear() {
    this.threads.clear();
    this.parts.clear();
  }
  /** Adds what a summary reported: a part once, or a thread's running total,
   * counted from its last one. */
  ingest(e: Extract<Event, { kind: "usage" }>, system: System, now: number) {
    if (e.part) {
      if (this.parts.has(e.part.id)) return;
      this.parts.add(e.part.id);
      system.meter.add(new Tokens(e.part.tokens), now);
    } else if (e.total) {
      const current = new Tokens(e.total.total);
      if (!this.threads.has(e.session)) this.threads.set(e.session, new Tokens());
      const previous = this.threads.get(e.session)!;
      const delta = new Tokens();
      for (const key of ["input", "cached_input", "output"] as const) {
        delta[key] = sub(current[key], previous[key]);
        if (current[key] < previous[key]) system.markPartial("counter regression");
        previous[key] = current[key] > previous[key] ? current[key] : previous[key];
      }
      system.meter.add(delta, now);
    }
    system.reports = add(system.reports, 1n);
  }
}
