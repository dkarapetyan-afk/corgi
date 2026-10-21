//! What the launcher shows about Codex: its account, usage and effective
//! model, read through its app server.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Launcher } from "../adapter";
import { Cache, interval } from "../../usage/account_cache";
import * as errors from "../../errors";
import { configDir } from "./index";
import * as appServer from "./app_server";
export function open(): Launcher {
  const server = new appServer.AppServer(5000);
  return {
    async account(quit) {
      const root = configDir();
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
        try {
          cache.state.update(await appServer.account(server, quit.abortSignal), Math.floor(Date.now() / 1000));
        } catch (e) {
          cache.state.failed(errors.is(e, "Timeout") ? "request timed out" : "account read failed");
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
