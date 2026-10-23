import { createHash } from "node:crypto";
import type { InferenceModel } from "../adapter";
import type { Quit } from "../../subprocess";
import { Option, compare, cost } from "../../inference/models";
import { str, field } from "../common";
import { API, modelRef } from "./api";

const lifetime = 10 * 60 * 1000,
  retry_after = 30000;
/** A picker refresh checks a few cheap candidates, not the entire catalog. */
export class Probes {
  private context = "";
  private cache = new Map<string, { ready: boolean; expires: number }>();

  async check(
    api: API,
    models: InferenceModel[],
    credentials: unknown,
    quit: Quit,
    now = Date.now(),
    preferred: ReadonlySet<string> = new Set(),
  ) {
    const context = createHash("sha256")
      .update(JSON.stringify([api.cwd, credentials]))
      .digest("hex");
    if (context !== this.context) {
      this.cache.clear();
      this.context = context;
    }
    for (const [id, cached] of this.cache) if (cached.expires <= now) this.cache.delete(id);
    const ranked = models
        .map(m => Object.assign(new Option(), m, { model: m.id }))
        .sort((a, b) => {
          const preference =
            a.subscription === b.subscription && cost(a) === cost(b)
              ? Number(preferred.has(b.id)) - Number(preferred.has(a.id))
              : 0;
          return preference || compare(a, b);
        }),
      groups = new Map<string, InferenceModel[]>();
    for (const model of ranked) {
      const provider = model.id.split("/")[0];
      if (!groups.has(provider)) groups.set(provider, []);
      groups.get(provider)!.push(model);
    }
    // At most four providers, two models each. Subscriptions get first refusal.
    const candidates = [...groups.values()].slice(0, 4),
      subscriptions = candidates.filter(models => models[0].subscription);
    const checked = await Promise.all(subscriptions.map(models => this.group(api, models, quit, now)));
    if (!checked.some(Boolean))
      await Promise.all(
        candidates.filter(models => !models[0].subscription).map(models => this.group(api, models, quit, now)),
      );
    if (quit.aborted) throw Error("Cancelled");
    return models.map(model => ({ ...model, ready: this.cache.get(model.id)?.ready ?? null }));
  }

  private async group(api: API, models: InferenceModel[], quit: Quit, now: number) {
    for (const model of models.slice(0, 2)) {
      if (quit.aborted) throw Error("Cancelled");
      let cached = this.cache.get(model.id);
      if (!cached) {
        let ready = false;
        try {
          const reply = await api.call(
            "POST",
            "/api/experimental/generate",
            { model: modelRef(model.id), prompt: "Reply with exactly OK and nothing else." },
            quit,
            10000,
          );
          ready = str(field(reply, "data"), "text").trim().length > 0;
        } catch {
          if (quit.aborted) throw Error("Cancelled");
        }
        if (quit.aborted) throw Error("Cancelled");
        cached = { ready, expires: now + (ready ? lifetime : retry_after) };
        this.cache.set(model.id, cached);
      }
      if (cached.ready) return true;
    }
    return false;
  }
}
