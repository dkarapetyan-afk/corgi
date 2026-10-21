import { Quit } from "../subprocess";
import { Provider, adapter, byProvider, Text } from "../providers";
import type { Launcher } from "../providers/adapter";
import { Model } from "../providers/model";
import { Info, serializeLimits } from "../usage/account";
import { none, update as updateLimitHistory } from "../usage/limits";
import * as discovery from "../discovery";
export { Text };
export class Option {
  signed_in: boolean | null = null;
  model = new Text();
  model_name = new Text();
  source = new Text();
  account = new Text();
  plan = new Text();
  limits: Info["limits"] = "none";
  usage_fetched_at = 0;
  usage_error = new Text();
  usage_needs_consent = false;
  history = none();
  toJSON() {
    return { ...this, limits: serializeLimits(this.limits) };
  }
  modelLabel() {
    return this.model_name.len ? this.model_name.text() : this.model.text();
  }
  setModel(model: string, source: string) {
    this.model = new Text(model);
    this.model_name = Model.resolve(model).name;
    this.source = new Text(source);
  }
}
export class Preview {
  pending = true;
  options = byProvider(() => new Option());
  installed = byProvider(() => true);
}
export function installed() {
  return byProvider(p => discovery.installed(p));
}
export class Worker {
  quit = Quit.init();
  stopping = false;
  running = false;
  private pending: Promise<void> | null = null;
  jobs: {
    cwd: string;
    preview: Preview;
    updated: number;
    used: number;
    queued: boolean;
    accessing: boolean;
    request_access: boolean;
  }[] = [];
  /** Each provider's launcher, opened on first use. */
  launchers = new Map<Provider, Promise<Launcher | null>>();
  static start() {
    return new Worker();
  }
  async stop() {
    this.stopping = true;
    this.quit.signal();
    for (const launcher of this.launchers.values()) void launcher.then(l => l?.close());
    await this.pending;
  }
  launcher(p: Provider) {
    let launcher = this.launchers.get(p);
    if (!launcher) this.launchers.set(p, (launcher = adapter(p).launcher?.() ?? Promise.resolve(null)));
    return launcher;
  }
  preview(cwd: string) {
    return this.request(cwd, false);
  }
  trackUsage(cwd: string) {
    return this.request(cwd, true);
  }
  request(cwd: string, access: boolean) {
    if (Buffer.byteLength(cwd) > 4096) return new Preview();
    const now = Date.now();
    let job = this.jobs.find(j => j.cwd === cwd);
    if (job) {
      job.used = now;
      if ((now - job.updated > 60000 && !job.queued) || (access && !job.accessing && !job.request_access)) {
        job.queued = true;
        job.request_access ||= access;
        job.preview.pending = true;
        void this.pump();
      }
      return job.preview;
    }
    const preview = new Preview();
    preview.installed = installed();
    job = {
      cwd,
      preview,
      updated: 0,
      used: now,
      queued: true,
      accessing: false,
      request_access: access,
    };
    if (this.jobs.length >= 32)
      this.jobs.splice(
        this.jobs.reduce((best, j, i, a) => (j.used < a[best].used ? i : best), 0),
        1,
      );
    this.jobs.push(job);
    void this.pump();
    return preview;
  }
  pump(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.pending) return this.pending;
    const pending = this.drain();
    this.pending = pending;
    void pending
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      })
      .catch(() => {});
    return pending;
  }
  private async drain() {
    this.running = true;
    try {
      for (;;) {
        const job = this.jobs.find(job => job.queued);
        if (!job || this.stopping) break;
        await this.run(job);
      }
    } finally {
      this.running = false;
    }
  }
  async run(job: Worker["jobs"][number]) {
    job.queued = false;
    job.accessing = job.request_access;
    job.request_access = false;
    const result = new Preview();
    result.pending = false;
    result.installed = installed();
    for (const p of Provider.all) {
      if (this.stopping) return;
      if (!result.installed[p]) continue;
      const out = new Option(),
        launcher = await this.launcher(p);
      if (!launcher) continue;
      try {
        const account = await launcher.account(this.quit);
        for (const key of [
          "signed_in",
          "account",
          "plan",
          "limits",
          "usage_fetched_at",
          "usage_error",
          "usage_needs_consent",
        ] as const)
          (out as any)[key] = account[key];
        out.history = await updateLimitHistory(p, account, this.stopping);
      } catch {
        out.usage_error = new Text("account read failed");
      }
      if (this.stopping) return;
      const chosen = await launcher.model(job.cwd, this.quit);
      if (chosen.model) out.setModel(chosen.model, chosen.source);
      else out.source = new Text(chosen.source);
      result.options[p] = out;
    }
    if (this.jobs.includes(job)) {
      job.preview = result;
      job.preview.pending = job.queued;
      job.accessing = false;
      job.updated = Date.now();
    }
  }
}
