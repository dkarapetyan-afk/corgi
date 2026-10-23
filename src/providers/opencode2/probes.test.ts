import { expect, spyOn, test } from "bun:test";
import type { InferenceModel } from "../adapter";
import { API } from "./api";
import { Probes } from "./probes";
import { Quit } from "../../subprocess";
import { Option, automatic, compare } from "../../inference/models";

const model = (id: string, price: number | null, subscription = true): InferenceModel => ({
  id,
  name: id,
  subscription,
  input_cost: price,
  output_cost: price,
});
const ranked = (models: InferenceModel[]) =>
  models.map(m => Object.assign(new Option(), m, { model: m.id })).sort(compare);

test("Auto prefers the cheapest working subscription, not a cheaper rejected login or an untested model", async () => {
  const api = new API("unused"),
    probes = new Probes(),
    call = spyOn(api, "call").mockImplementation(async (method, path, body, quit, timeout) => {
      expect(method).toBe("POST");
      expect(path).toBe("/api/experimental/generate");
      expect(quit).toBe(stopping);
      expect(timeout).toBe(10000);
      const input = body as { model: { providerID: string }; prompt: string };
      expect(input.prompt).toBe("Reply with exactly OK and nothing else.");
      if (input.model.providerID === "github") throw Error("OpenCodeRequestFailed");
      return { data: { text: "OK\n" } };
    }),
    stopping = new Quit();
  try {
    const checked = await probes.check(
      api,
      [
        model("github/haiku", 0.1),
        model("github/luna", 0.2),
        model("github/sol", 0.3),
        model("openai/luna", null),
        model("openai/sol", null),
        model("api/free", 0, false),
      ],
      {},
      stopping,
    );
    expect(checked.map(m => m.ready)).toEqual([false, false, null, true, null, null]);
    expect(automatic(ranked(checked))?.model).toBe("openai/luna");
    expect(call).toHaveBeenCalledTimes(3);
  } finally {
    call.mockRestore();
  }
});

test("working subscriptions are compared by summary price after checking each provider", async () => {
  const api = new API("unused"),
    call = spyOn(api, "call").mockResolvedValue({ data: { text: "OK" } });
  try {
    const checked = await new Probes().check(api, [model("a/expensive", 5), model("b/cheap", 1)], {}, new Quit());
    expect(automatic(ranked(checked))?.model).toBe("b/cheap");
    expect(call).toHaveBeenCalledTimes(2);
  } finally {
    call.mockRestore();
  }
});

test("probe successes are cached for ten minutes and invalidated by credential changes", async () => {
  const api = new API("unused"),
    probes = new Probes(),
    models = [model("openai/a", 1)],
    call = spyOn(api, "call").mockResolvedValue({ data: { text: "OK" } });
  try {
    await probes.check(api, models, { login: "old" }, new Quit(), 0);
    await probes.check(api, models, { login: "old" }, new Quit(), 599999);
    expect(call).toHaveBeenCalledTimes(1);
    await probes.check(api, models, { login: "old" }, new Quit(), 600000);
    expect(call).toHaveBeenCalledTimes(2);
    await probes.check(api, models, { login: "new" }, new Quit(), 600001);
    expect(call).toHaveBeenCalledTimes(3);
  } finally {
    call.mockRestore();
  }
});

test("failed access checks retry after a short cooldown and accept any nonempty successful reply", async () => {
  const api = new API("unused"),
    probes = new Probes(),
    models = [model("openai/luna", null)],
    call = spyOn(api, "call").mockRejectedValue(Error("Timeout"));
  try {
    expect((await probes.check(api, models, {}, new Quit(), 0))[0].ready).toBe(false);
    call.mockResolvedValue({ data: { text: "OK." } });
    expect((await probes.check(api, models, {}, new Quit(), 29999))[0].ready).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
    expect((await probes.check(api, models, {}, new Quit(), 30000))[0].ready).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
  } finally {
    call.mockRestore();
  }
});

test("unpriced subscriptions try a known cheap inference default before legacy alphabetic entries", async () => {
  const api = new API("unused"),
    call = spyOn(api, "call").mockResolvedValue({ data: { text: "OK" } });
  try {
    const checked = await new Probes().check(
      api,
      [model("openai/ancient", null), model("openai/luna", null)],
      {},
      new Quit(),
      0,
      new Set(["openai/luna"]),
    );
    expect(automatic(ranked(checked))?.model).toBe("openai/luna");
    expect(call).toHaveBeenCalledTimes(1);
  } finally {
    call.mockRestore();
  }
});

test("failed or empty replies leave Auto unavailable; untested entries remain explicit choices", async () => {
  const api = new API("unused"),
    call = spyOn(api, "call").mockResolvedValue({ data: { text: "" } });
  try {
    const checked = await new Probes().check(
      api,
      [model("a/one", 1), model("a/two", 2), model("a/three", 3)],
      {},
      new Quit(),
    );
    expect(checked.map(m => m.ready)).toEqual([false, false, null]);
    expect(automatic(ranked(checked))).toBeUndefined();
    expect(checked).toHaveLength(3);
  } finally {
    call.mockRestore();
  }
});

test("free or metered models are checked only if no subscription answers", async () => {
  const api = new API("unused"),
    call = spyOn(api, "call").mockImplementation(async (_method, _path, body) => {
      if ((body as { model: { providerID: string } }).model.providerID === "sub") throw Error("OpenCodeRequestFailed");
      return { data: { text: "OK" } };
    });
  try {
    const checked = await new Probes().check(api, [model("sub/model", 1), model("api/free", 0, false)], {}, new Quit());
    expect(automatic(ranked(checked))?.model).toBe("api/free");
    expect(call).toHaveBeenCalledTimes(2);
  } finally {
    call.mockRestore();
  }
});

test("probing has a hard request budget even when every provider rejects access", async () => {
  const api = new API("unused"),
    call = spyOn(api, "call").mockRejectedValue(Error("OpenCodeRequestFailed"));
  try {
    const models = Array.from({ length: 20 }, (_, i) => [
      model(`provider-${i}/a`, 1),
      model(`provider-${i}/b`, 2),
      model(`provider-${i}/c`, 3),
    ]).flat();
    await new Probes().check(api, models, {}, new Quit());
    expect(call).toHaveBeenCalledTimes(8);
  } finally {
    call.mockRestore();
  }
});

test("cancellation aborts probing without caching a false access failure", async () => {
  const api = new API("unused"),
    probes = new Probes(),
    stopping = new Quit(),
    models = [model("openai/luna", 1)],
    call = spyOn(api, "call").mockImplementation(async () => {
      stopping.signal();
      throw Error("Cancelled");
    });
  try {
    await expect(probes.check(api, models, {}, stopping)).rejects.toThrow("Cancelled");
    call.mockResolvedValue({ data: { text: "OK" } });
    expect((await probes.check(api, models, {}, new Quit()))[0].ready).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
  } finally {
    call.mockRestore();
  }
});
