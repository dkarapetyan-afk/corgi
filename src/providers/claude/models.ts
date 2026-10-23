import type { InferenceModel } from "../adapter";
import type { Quit } from "../../subprocess";
import { Client } from "./account";
import { vocabulary } from "./info";
import { str } from "../common";
import * as nativeModels from "../../inference/native_models";

export async function read(account: string, quit: Quit): Promise<InferenceModel[]> {
  if (quit.aborted) throw Error("Cancelled");
  const env = account ? { ...process.env, [vocabulary.config_env]: account } : process.env,
    client = new Client(env);
  try {
    const { info, models } = await client.models(quit);
    if (!Array.isArray(models)) throw Error("InvalidModels");
    return nativeModels.options(
      models.map(entry => ({
        id: str(entry, "resolvedModel") || str(entry, "value"),
        name: str(entry, "value") === "default" ? "" : str(entry, "displayName"),
      })),
      info,
    );
  } finally {
    client.close();
  }
}
