import { Provider, adapter } from "../providers";
import * as accounts from "../accounts";
import * as discovery from "../discovery";
import { Quit } from "../subprocess";
import { Option, compare } from "./models";
import { Failure } from "../failure";
import { getLogger } from "../log";
const log = getLogger("inference.models");
export class Catalog {
  available: Option[] = [];
  loading = false;
  next = 0;
  private quit = new Quit();
  private failure = new Failure();
  private paused = false;
  private job: Promise<void> | null = null;
  /** Picker opens share pending work and reuse the last result for a minute. */
  refresh(): Promise<void> {
    if (this.job) return this.job;
    if (this.paused || this.quit.aborted || Date.now() < this.next) return Promise.resolve();
    this.loading = true;
    this.job = this.read()
      .catch(() => {
        if (!this.quit.aborted && this.failure.changed("ModelsUnavailable")) log.warn("Model discovery failed");
      })
      .finally(() => {
        this.next = Date.now() + 60000;
        this.loading = false;
        this.job = null;
      });
    return this.job;
  }
  private async read() {
    const found: Option[] = [];
    let failed = false;
    for (const provider of Provider.all) {
      const read = adapter(provider).inference.models;
      if (!read || !discovery.installed(provider)) continue;
      for (const account of [
        "",
        ...accounts
          .known()
          .filter(a => a.provider === provider)
          .map(a => a.dir),
      ]) {
        if (this.quit.aborted) return;
        try {
          for (const model of await read(account, this.quit))
            found.push(
              Object.assign(new Option(), {
                provider,
                model: model.id,
                name: model.name,
                account,
                account_name: accounts.label(provider, account),
                subscription: model.subscription,
                input_cost: model.input_cost,
                output_cost: model.output_cost,
              }),
            );
        } catch {
          failed = true;
          found.push(...this.available.filter(m => m.provider === provider && m.account === account));
        }
      }
    }
    if (this.quit.aborted) return;
    this.available = found.sort(compare);
    if (failed && this.failure.changed("ModelsUnavailable")) log.warn("Model discovery failed");
    if (!failed) this.failure.clear();
  }
  async pause() {
    this.paused = true;
    this.quit.signal();
    await this.job;
    this.quit = new Quit();
  }
  resume() {
    this.paused = false;
  }
  close() {
    this.quit.signal();
  }
}
