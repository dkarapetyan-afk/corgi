import { Model } from "../providers/model";
import { add, max } from "./tokens";
export class View {
  used = 0n;
  window = 0n;
  compacts_at = 0n;
  at = 0;
  constructor(v: Partial<View> = {}) {
    Object.assign(this, v);
  }
  pressure() {
    if (!this.at || !this.window) return null;
    const limit = this.compacts_at > 0n && this.compacts_at < this.window ? this.compacts_at : this.window;
    return Number(this.used) / Number(limit);
  }
  band() {
    const p = this.pressure();
    return p === null ? null : p < 0.7 ? "calm" : p < 0.85 ? "near" : "high";
  }
  percent() {
    if (!this.window) return 0n;
    const mul = this.used * 100n;
    return add(mul > max ? max : mul, this.window / 2n) / this.window;
  }
}
export class Points {
  entries: Array<{ model: string; tokens: bigint }> = [];
  next = 0;
  learn(model: string, tokens: bigint) {
    if (!model || !tokens) return;
    const old = this.entries.find(e => e.model === model);
    if (old) {
      old.tokens = tokens;
      return;
    }
    if (this.entries.length < 8) this.entries.push({ model, tokens });
    else {
      this.entries[this.next] = { model, tokens };
      this.next = (this.next + 1) % 8;
    }
  }
  get(model: string) {
    return this.entries.find(e => e.model === model)?.tokens ?? 0n;
  }
}
export class Reading {
  used = 0n;
  window = 0n;
  at = 0;
  model = new Model();
  auto_compaction = 0n;
  in_turn = false;
  view(points: Points) {
    return new View({
      used: this.used,
      window: this.window,
      at: this.at,
      compacts_at: this.auto_compaction || points.get(this.model.id.text()),
    });
  }
}
