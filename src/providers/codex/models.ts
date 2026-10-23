import type { InferenceModel } from "../adapter";
import type { Quit } from "../../subprocess";
import { AppServer, account as readAccount } from "./app_server";
import { field, str } from "../common";
import * as nativeModels from "../../inference/native_models";

export async function read(account: string, quit: Quit): Promise<InferenceModel[]> {
  if (quit.aborted) throw Error("Cancelled");
  const server = new AppServer(5000, null, account);
  try {
    const info = await readAccount(server, quit.abortSignal);
    if (info.signed_in !== true) return [];
    const entries: { id: string; name: string }[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const reply = await server.request("model/list", { cursor, limit: 100 }, quit.abortSignal),
        result = field(reply, "result"),
        data = field(result, "data");
      if (!Array.isArray(data)) throw Error("InvalidModels");
      for (const entry of data) entries.push({ id: str(entry, "model"), name: str(entry, "displayName") });
      const next = str(result, "nextCursor");
      if (!next) return nativeModels.options(entries, info);
      if (next === cursor) throw Error("InvalidModels");
      cursor = next;
    }
    throw Error("InvalidModels");
  } finally {
    server.close();
  }
}
