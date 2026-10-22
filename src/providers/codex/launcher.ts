//! What the launcher shows about Codex: its account, usage and effective
//! model, read through its app server.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Launcher } from "../adapter";
import { Cache, interval } from "../../usage/account_cache";
import { getLogger } from "../../log";
import { Failure } from "../../failure";
import * as errors from "../../errors";
import { configDir } from "./index";
import * as appServer from "./app_server";
const log = getLogger("codex.account");
/** What the launcher shows about `account`, "" for the default. */
export function open(account = ""): Launcher {
  const server = new appServer.AppServer(5000, null, account),
    failure = new Failure();
  return {
    async account(quit) {
      const root = account || configDir();
      let auth: string;
      try {
        auth = readFileSync(join(root, "auth.json"), "utf8");
      } catch {
        auth = root;
      }
      const cache = await Cache.open("codex", auth + "\n" + (process.env.OPENAI_API_KEY ?? ""));
      try {
        const now = Math.floor(Date.now() / 1000);
        if (now < cache.state.next_usage) return cache.state.display(now);
        cache.state.next_usage = now + interval;
        cache.save();
        const started = Date.now();
        try {
          cache.state.update(await appServer.account(server, quit.abortSignal), Math.floor(Date.now() / 1000));
          if (failure.clear()) log.info("Account read recovered", { account, ms: Date.now() - started });
        } catch (e) {
          cache.state.failed(errors.is(e, "Timeout") ? "request timed out" : "account read failed");
          if (!errors.is(e, "Cancelled") && failure.changed(e))
            log.warn("Account read failed", { account, ms: Date.now() - started, err: e });
        }
        cache.save();
        return cache.state.display(Math.floor(Date.now() / 1000));
      } finally {
        cache.close();
      }
    },
    async model(cwd, quit) {
      try {
        return {
          model: (await appServer.model(server, cwd, quit.abortSignal)).text(),
          source: "Effective Codex settings",
        };
      } catch {
        return { model: "", source: "Model resolved by Codex at startup" };
      }
    },
    close: () => server.close(),
  };
}
