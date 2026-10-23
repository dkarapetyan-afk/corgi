import { expect, spyOn, test } from "bun:test";
import { API } from "./api";
import { parse, read } from "./models";
import { Quit } from "../../subprocess";
import { Info, Text } from "../../usage/account";

const model = (providerID: string, id: string) => ({
  providerID,
  id,
  name: id,
  enabled: true,
  capabilities: { input: ["text", "image"], output: ["text"] },
  cost: [{ input: 1, output: 5 }],
});
const providers = { data: [{ id: "chatgpt", integrationID: "openai" }, { id: "custom" }] };
const credentials = {
  data: [
    {
      integrationID: "openai",
      active: true,
      value: { type: "oauth", methodID: "chatgpt-token-sharing", access: "secret" },
    },
    { integrationID: "custom", active: true, value: { type: "key", key: "secret" } },
  ],
};

test("OpenCode exposes enabled text models with exact provider IDs and subscription pricing", () => {
  const result = parse(
    {
      data: [
        model("chatgpt", "sol"),
        model("custom", "org/tiny"),
        model("chatgpt", "sol"),
        { ...model("custom", "disabled"), enabled: false },
        { ...model("custom", "image"), capabilities: { input: ["image"], output: ["image"] } },
        { ...model("custom", "speech"), capabilities: { input: ["text"], output: ["audio"] } },
        model("bad/provider", "tiny"),
        model("custom", "line\nbreak"),
        model("custom", "tiny#high"),
        model("custom", "x".repeat(512)),
      ],
    },
    providers,
    credentials,
  );
  expect(result).toEqual([
    { id: "chatgpt/sol", name: "sol", subscription: true, input_cost: 1, output_cost: 5 },
    { id: "custom/org/tiny", name: "org/tiny", subscription: false, input_cost: 1, output_cost: 5 },
  ]);
  expect(JSON.stringify(result)).not.toContain("secret");
});

test("catalog prices retain explicit free models, choose the base tier and leave absent prices unknown", () => {
  const result = parse(
    {
      data: [
        { ...model("custom", "free"), cost: [{ input: 0, output: 0 }] },
        { ...model("custom", "unknown"), cost: [] },
        { ...model("custom", "invalid"), cost: [{ input: -1, output: Infinity }] },
        {
          ...model("custom", "tiered"),
          name: "Tiny\x1b\n",
          cost: [
            { tier: { type: "context", size: 100000 }, input: 3, output: 15 },
            { input: 1, output: 5 },
          ],
        },
      ],
    },
    providers,
    { data: [] },
  );
  expect(result.map(m => [m.input_cost, m.output_cost])).toEqual([
    [0, 0],
    [null, null],
    [null, null],
    [1, 5],
  ]);
  expect(result[3].name).toBe("Tiny");
  expect(() => parse({}, providers, credentials)).toThrow("BadOpenCodeResponse");
});

test("inactive credentials and non-subscription OAuth are not advertised as subscriptions", () => {
  const result = parse({ data: [model("chatgpt", "sol"), model("custom", "tiny")] }, providers, {
    data: [
      { ...credentials.data[0], active: false },
      { integrationID: "custom", active: true, value: { type: "oauth" } },
    ],
  });
  expect(result.every(m => !m.subscription)).toBe(true);
});
test("connected ChatGPT token-sharing remains a subscription even when its models have no prices", () => {
  const result = parse(
    {
      data: [
        { ...model("opencode", "free"), cost: [{ input: 0, output: 0 }] },
        { ...model("openai", "gpt-6-luna"), cost: [] },
      ],
    },
    { data: [{ id: "opencode" }, { id: "openai", integrationID: "openai", name: "OpenAI" }] },
    {
      data: [
        {
          integrationID: "openai",
          active: false,
          label: "old@example.com",
          value: { type: "oauth", methodID: "chatgpt-browser" },
        },
        {
          integrationID: "openai",
          active: true,
          label: "OpenAI",
          value: { type: "oauth", methodID: "chatgpt-token-sharing", access: "opaque-secret" },
        },
      ],
    },
  );
  expect(result[1]).toEqual({
    id: "openai/gpt-6-luna",
    name: "gpt-6-luna",
    subscription: true,
    input_cost: null,
    output_cost: null,
  });
  expect(JSON.stringify(result)).not.toContain("old@example.com");
  expect(JSON.stringify(result)).not.toContain("opaque-secret");
});
test("OpenCode model identities follow active provider integrations without exposing tokens", () => {
  const access = `header.${Buffer.from(JSON.stringify({ email: "active@example.com" })).toString("base64url")}.secret`,
    result = parse(
      { data: [model("chatgpt", "sol"), model("custom", "tiny"), model("github-copilot", "flash")] },
      {
        data: [...providers.data, { id: "github-copilot", name: "GitHub Copilot" }],
      },
      {
        data: [
          { integrationID: "openai", active: false, value: { type: "oauth", email: "old@example.com" } },
          { integrationID: "openai", active: true, value: { type: "oauth", access } },
          { integrationID: "custom", active: true, label: "API key", value: { type: "key", key: "other-secret" } },
          {
            integrationID: "github-copilot",
            active: true,
            label: "work@example.com",
            value: { type: "oauth", access: "opaque-secret" },
          },
        ],
      },
    );
  expect(result.map(m => m.user)).toEqual(["active@example.com", undefined, "work@example.com"]);
  expect(JSON.stringify(result)).not.toContain("secret");
});

test("the inference adapter discovers models and checks access without creating a session", async () => {
  const api = new API("unused", "/project with spaces"),
    peek = spyOn(API, "peek").mockImplementation((_cwd, read) => read(api)),
    call = spyOn(api, "call").mockImplementation(async (method, path, _body, quit) => {
      expect(quit).toBe(stopping);
      if (method === "POST" && path === "/api/experimental/generate") return { data: { text: "OK" } };
      expect(method).toBe("GET");
      if (path.startsWith("/api/model?")) return { data: [model("chatgpt", "sol")] };
      if (path.startsWith("/api/provider?")) return providers;
      if (path === "/api/credential") return credentials;
      throw Error("UnexpectedCall");
    }),
    stopping = new Quit();
  try {
    expect(await read("", stopping, async () => null)).toMatchObject([
      { id: "chatgpt/sol", subscription: true, ready: true },
    ]);
    expect(call.mock.calls.map(args => args[1])).toEqual([
      "/api/model?location%5Bdirectory%5D=%2Fproject%20with%20spaces",
      "/api/provider?location%5Bdirectory%5D=%2Fproject%20with%20spaces",
      "/api/credential",
      "/api/experimental/generate",
    ]);
    stopping.signal();
    await expect(read("", stopping, async () => null)).rejects.toThrow("Cancelled");
    expect(call).toHaveBeenCalledTimes(4);
  } finally {
    call.mockRestore();
    peek.mockRestore();
  }
});

test("model discovery resolves the shared ChatGPT user once without assigning it to other integrations", async () => {
  const api = new API("unused", "/project"),
    peek = spyOn(API, "peek").mockImplementation((_cwd, read) => read(api)),
    call = spyOn(api, "call").mockImplementation(async (method, path) => {
      if (method === "POST") return { data: { text: "OK" } };
      if (path.startsWith("/api/model?"))
        return { data: [model("chatgpt", "luna"), model("chatgpt", "sol"), model("github-copilot", "haiku")] };
      if (path.startsWith("/api/provider?"))
        return {
          data: [
            { id: "chatgpt", integrationID: "openai", name: "OpenAI" },
            { id: "github-copilot", name: "GitHub Copilot" },
          ],
        };
      if (path === "/api/credential")
        return {
          data: [
            {
              integrationID: "openai",
              active: true,
              label: "OpenAI",
              value: { type: "oauth", methodID: "chatgpt-token-sharing", access: "sharing-secret" },
            },
            {
              integrationID: "github-copilot",
              active: true,
              label: "OAuth",
              value: { type: "oauth", methodID: "device", access: "github-secret" },
            },
          ],
        };
      throw Error("UnexpectedCall");
    });
  let lookups = 0;
  try {
    const available = await read("", new Quit(), async () => {
      lookups++;
      return Object.assign(new Info(), {
        signed_in: true,
        account: new Text("shared@example.com"),
        plan: new Text("Pro 500"),
      });
    });
    expect(available.filter(m => m.id.startsWith("chatgpt/")).map(m => m.user)).toEqual([
      "shared@example.com",
      "shared@example.com",
    ]);
    expect(available.find(m => m.id.startsWith("github-copilot/"))?.user).toBeUndefined();
    expect(available.filter(m => m.id.startsWith("chatgpt/")).map(m => m.plan)).toEqual(["Pro 500", "Pro 500"]);
    expect(available.find(m => m.id.startsWith("github-copilot/"))?.plan).toBeUndefined();
    expect(lookups).toBe(1);
    expect(JSON.stringify(available)).not.toContain("secret");
  } finally {
    call.mockRestore();
    peek.mockRestore();
  }
});
