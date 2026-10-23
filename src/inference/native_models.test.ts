import { expect, test } from "bun:test";
import { options } from "./native_models";
import { Option, compare } from "./models";
import { Info, Text } from "../usage/account";

test("native metered catalogs rank cheap models before the account's heavy chat defaults", () => {
  const info = Object.assign(new Info(), {
      signed_in: true,
      account: new Text("work@example.com"),
      plan: new Text("API"),
      limits: "metered",
    }),
    models = options(
      [
        { id: "gpt-6-astra", name: "GPT-6 Astra" },
        { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
        { id: "gpt-6-luna", name: "GPT-6 Luna" },
        { id: "claude-opus-5-5[1m]", name: "Opus (1M)" },
        { id: "claude-haiku-5-5", name: "Haiku 5.5" },
        { id: "custom/unknown", name: "Unknown" },
      ],
      info,
    )
      .map(m => Object.assign(new Option(), m, { model: m.id }))
      .sort(compare);
  expect(models.slice(0, 2).map(m => m.model)).toEqual(["claude-haiku-5-5", "gpt-6-luna"]);
  expect(models.at(-1)?.model).toBe("custom/unknown");
  expect(models.every(m => !m.subscription)).toBe(true);
  expect(models.find(m => m.model === "custom/unknown")?.input_cost).toBeNull();
});

test("native catalogs keep all usable entries, sanitize labels and require a signed-in account", () => {
  const entries = [
      { id: "haiku", name: "Haiku\x1b\n" },
      { id: "haiku", name: "Duplicate" },
      { id: "bad\nmodel", name: "Bad" },
      { id: "", name: "Empty" },
      { id: "gpt-6-luna", name: "" },
    ],
    info = Object.assign(new Info(), { signed_in: true });
  expect(options(entries, info).map(m => m.name)).toEqual(["Haiku", "GPT-6 Luna"]);
  expect(options(entries, new Info())).toEqual([]);
});
