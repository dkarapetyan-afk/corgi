import { expect, mock, test } from "bun:test";
import { credential, resolve } from "./account";
import { Info, Text } from "../../usage/account";
import { Quit } from "../../subprocess";

const sharing = {
  integrationID: "openai",
  active: true,
  label: "OpenAI",
  value: { type: "oauth", methodID: "chatgpt-token-sharing", access: "opaque-secret" },
};
const info = () =>
  Object.assign(new Info(), { signed_in: true, account: new Text("shared@example.com"), plan: new Text("Pro 500") });
const jwt = (email: string) => `header.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.signature`;

test("token-sharing identities use the same native account as the launcher", async () => {
  const shared = info(),
    subscription = mock(async () => shared),
    selected = credential(
      { id: "chatgpt", integrationID: "openai" },
      { data: [{ ...sharing, active: false, label: "old@example.com" }, sharing] },
    ),
    result = await resolve(selected, "OpenAI", new Quit(), subscription);
  expect(result.user).toBe("shared@example.com");
  expect(result.shared).toBe(shared);
  expect(result.plan).toBe("Pro 500");
  expect(subscription).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain("opaque-secret");
});

test("shared account reads honor the launcher's freshness schedule", async () => {
  const quit = new Quit(),
    subscription = mock(async (_quit: Quit, _max_age: number) => info());
  await resolve(sharing, "OpenAI", quit, subscription, 135);
  expect(subscription).toHaveBeenCalledWith(quit, 135);
});

test("browser OAuth keeps its own plan instead of the native token-sharing plan", async () => {
  const access = `header.${Buffer.from(JSON.stringify({ email: "own@example.com", "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } })).toString("base64url")}.signature`,
    result = await resolve(
      { ...sharing, value: { type: "oauth", methodID: "chatgpt-browser", access } },
      "OpenAI",
      new Quit(),
      async () => info(),
    );
  expect(result.user).toBe("own@example.com");
  expect(result.plan).toBe("Pro 200");
  expect(result.shared).toBeNull();
});

test("browser, API, other-provider and inactive connections never borrow the Codex account", async () => {
  const subscription = mock(async () => info());
  for (const entry of [
    { ...sharing, value: { type: "oauth", methodID: "chatgpt-browser", access: jwt("browser@example.com") } },
    { ...sharing, value: { type: "key", key: "secret" } },
    { ...sharing, integrationID: "github-copilot", label: "GitHub Copilot" },
    { ...sharing, active: false },
  ]) {
    const result = await resolve(entry, entry.label, new Quit(), subscription);
    expect(result.shared).toBeNull();
    expect(result.user).not.toBe("shared@example.com");
  }
  expect(subscription).not.toHaveBeenCalled();
});

test("a missing native login retains only the active credential's own identity", async () => {
  const entry = { ...sharing, value: { ...sharing.value, access: jwt("own@example.com") } };
  expect((await resolve(entry, "OpenAI", new Quit(), async () => null)).user).toBe("own@example.com");
  expect(
    (await resolve(sharing, "OpenAI", new Quit(), async () => Object.assign(info(), { signed_in: false }))).user,
  ).toBe("");
  expect(
    (
      await resolve(sharing, "OpenAI", new Quit(), async () => {
        throw Error("Unavailable");
      })
    ).user,
  ).toBe("");
});

test("cancellation does not turn an interrupted identity lookup into another user's account", async () => {
  const quit = new Quit();
  await expect(
    resolve(sharing, "OpenAI", quit, async () => {
      quit.signal();
      return info();
    }),
  ).rejects.toThrow("Cancelled");
});
