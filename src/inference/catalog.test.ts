import { expect, spyOn, test } from "bun:test";
import { Catalog } from "./catalog";
import { adapter } from "../providers";
import * as discovery from "../discovery";
import * as accounts from "../accounts";
import type { InferenceModel } from "../providers/adapter";

const model: InferenceModel = {
  id: "custom/model",
  name: "Model",
  subscription: false,
  input_cost: 1,
  output_cost: 2,
};

test("model picker requests share discovery, cache results, and retain them during refresh failures", async () => {
  const installed = spyOn(discovery, "installed").mockImplementation(p => p === "pi"),
    known = spyOn(accounts, "known").mockReturnValue([]);
  let finish!: (models: InferenceModel[]) => void;
  const pending = new Promise<InferenceModel[]>(resolve => (finish = resolve));
  const read = spyOn(adapter("pi").inference, "models").mockReturnValue(pending);
  const catalog = new Catalog();
  try {
    expect(read).not.toHaveBeenCalled();
    const first = catalog.refresh();
    expect(catalog.loading).toBe(true);
    expect(catalog.refresh()).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
    finish([model]);
    await first;
    expect(catalog.loading).toBe(false);
    expect(catalog.available.map(m => m.model)).toEqual([model.id]);
    await catalog.refresh();
    expect(read).toHaveBeenCalledTimes(1);

    catalog.next = 0;
    let fail!: (error: Error) => void;
    read.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const refresh = catalog.refresh();
    expect(catalog.loading).toBe(true);
    expect(catalog.available.map(m => m.model)).toEqual([model.id]);
    fail(Error("ModelsUnavailable"));
    await refresh;
    expect(catalog.loading).toBe(false);
    expect(catalog.available.map(m => m.model)).toEqual([model.id]);
    await catalog.refresh();
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    finish([]);
    catalog.close();
    read.mockRestore();
    known.mockRestore();
    installed.mockRestore();
  }
});
