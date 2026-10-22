import { Quit } from "../subprocess";
import { Provider, adapter, byProvider, Text } from "../providers";
import type { Launcher } from "../providers/adapter";
import { Model } from "../providers/model";
import { Info, serializeLimits } from "../usage/account";
import { none, update as updateLimitHistory } from "../usage/limits";
import * as discovery from "../discovery";
import * as accounts from "../accounts";
export { Text };
export class Option {
  pending = true;
  signed_in: boolean | null = null;
  model = new Text();
  model_name = new Text();
  source = new Text();
  account = new Text();
  plan = new Text();
  limits: Info["limits"] = "none";
  spend: Info["spend"] = null;
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
  /** What each default account is called; "" for one that goes by its agent's name. */
  names = byProvider(() => "");
  /** The accounts besides each default, with what their option reads. */
  accounts: Account[] = [];
}
/** An account Corgi knows, as the launcher lists it. */
export type Account = { provider: Provider; account: string; name: string; managed: boolean; option: Option };
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
  /** Each account's launcher, opened on first use. */
  launchers = new Map<string, Promise<Launcher | null>>();
  static start() {
    return new Worker();
  }
  async stop() {
    this.stopping = true;
    this.quit.signal();
    for (const launcher of this.launchers.values()) void launcher.then(l => l?.close());
    await this.pending;
  }
  launcher(p: Provider, account = "") {
    const key = p + "\0" + account;
    let launcher = this.launchers.get(key);
    if (!launcher) this.launchers.set(key, (launcher = adapter(p).launcher?.(account) ?? Promise.resolve(null)));
    return launcher;
  }
  preview(cwd: string, refresh = false) {
    return this.request(cwd, false, refresh);
  }
  trackUsage(cwd: string) {
    return this.request(cwd, true);
  }
  request(cwd: string, access: boolean, refresh = false) {
    if (Buffer.byteLength(cwd) > 4096) return new Preview();
    const now = Date.now();
    let job = this.jobs.find(j => j.cwd === cwd);
    if (job) {
      job.used = now;
      const listed = this.list(job.preview),
        moved =
          job.preview.accounts.length !== listed.accounts.length ||
          job.preview.accounts.some(
            (a, i) =>
              a.provider !== listed.accounts[i].provider ||
              a.account !== listed.accounts[i].account ||
              a.name !== listed.accounts[i].name ||
              a.managed !== listed.accounts[i].managed,
          ) ||
          Provider.all.some(p => job!.preview.names[p] !== listed.names[p]);
      if (moved) job.preview = listed;
      if (
        moved ||
        ((refresh || now - job.updated > 60000) && !job.preview.pending) ||
        (access && !job.accessing && !job.request_access)
      ) {
        job.queued = true;
        job.request_access ||= access;
        job.preview = Object.assign(new Preview(), job.preview, { pending: true });
        void this.pump();
      }
      return job.preview;
    }
    const preview = this.list(new Preview());
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
  /** Account rows come from local state, independently of provider reads. */
  private list(previous: Preview): Preview {
    const result = Object.assign(new Preview(), previous);
    result.installed = installed();
    result.names = byProvider(p => accounts.defaultName(p));
    result.accounts = accounts
      .known()
      .filter(a => result.installed[a.provider])
      .map(a => ({
        provider: a.provider,
        account: a.dir,
        name: a.name,
        managed: a.managed,
        option:
          previous.accounts.find(old => old.provider === a.provider && old.account === a.dir)?.option ?? new Option(),
      }));
    return result;
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
    job.preview = this.list(job.preview);
    job.preview.pending = true;
    // Launchers keep a provider process each, so those of accounts gone close.
    const live = new Set([...Provider.all.map(p => p + "\0"), ...accounts.known().map(a => a.provider + "\0" + a.dir)]);
    for (const [key, launcher] of this.launchers)
      if (!live.has(key)) {
        void launcher.then(l => l?.close());
        this.launchers.delete(key);
      }
    const rows = [
      ...Provider.all.filter(p => job.preview.installed[p]).map(provider => ({ provider, account: "" })),
      ...job.preview.accounts,
    ];
    await Promise.all(
      rows.map(async ({ provider, account }) => {
        let option: Option;
        try {
          option = (await this.option(provider, account, job.cwd)) ?? new Option();
        } catch {
          option = new Option();
          option.usage_error = new Text("account read failed");
        }
        option.pending = false;
        if (this.stopping || !this.jobs.includes(job)) return;
        job.preview = Object.assign(
          new Preview(),
          job.preview,
          account
            ? {
                accounts: job.preview.accounts.map(a =>
                  a.provider === provider && a.account === account ? { ...a, option } : a,
                ),
              }
            : { options: { ...job.preview.options, [provider]: option } },
        );
      }),
    );
    if (this.stopping) return;
    if (this.jobs.includes(job)) {
      job.preview = Object.assign(new Preview(), job.preview, { pending: job.queued });
      job.accessing = false;
      job.updated = Date.now();
    }
  }
  /** What `account` of `p` would start with in `cwd`. */
  private async option(p: Provider, account: string, cwd: string): Promise<Option | null> {
    const out = new Option(),
      launcher = await this.launcher(p, account);
    if (!launcher) return null;
    try {
      const info = await launcher.account(this.quit);
      for (const key of [
        "signed_in",
        "account",
        "plan",
        "limits",
        "spend",
        "usage_fetched_at",
        "usage_error",
        "usage_needs_consent",
      ] as const)
        (out as any)[key] = info[key];
      out.history = await updateLimitHistory(p, info, this.stopping);
    } catch {
      out.usage_error = new Text("account read failed");
    }
    if (this.stopping) return null;
    const chosen = await launcher.model(cwd, this.quit);
    if (chosen.model) out.setModel(chosen.model, chosen.source);
    else out.source = new Text(chosen.source);
    return out;
  }
}
