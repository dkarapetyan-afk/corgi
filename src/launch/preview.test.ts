import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Option, Worker } from "./preview";
import { Info } from "../usage/account";
import { Text } from "../providers";
import * as accounts from "../accounts";

const variables = ["CORGI_ENV_BASE", "XDG_STATE_HOME", "CORGI_CODEX_BIN", "CORGI_CLAUDE_BIN", "CORGI_PI_BIN"] as const;
let saved: NodeJS.ProcessEnv, root: string;
beforeEach(() => {
  saved = { ...process.env };
  root = mkdtempSync(join(tmpdir(), "corgi-preview-"));
  process.env.CORGI_ENV_BASE = root;
  process.env.XDG_STATE_HOME = root;
  process.env.CORGI_CODEX_BIN = process.execPath;
  process.env.CORGI_CLAUDE_BIN = process.execPath;
  process.env.CORGI_PI_BIN = process.execPath;
  accounts.reset();
});
afterEach(() => {
  for (const key of variables)
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  accounts.reset();
  rmSync(root, { recursive: true, force: true });
});
function listed(names: string[]) {
  mkdirSync(dirname(accounts.path()), { recursive: true });
  writeFileSync(
    accounts.path(),
    JSON.stringify({
      accounts: names.map(name => ({ provider: "claude", dir: join(root, name), name, managed: false })),
    }),
  );
  accounts.reset();
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
test("a launch preview names the model it shows and where it came from", () => {
  const o = new Option();
  o.setModel("opus", "Project");
  expect(o.model.text()).toBe("opus");
  expect(o.modelLabel()).toBe("Opus");
  expect(o.source.text()).toBe("Project");
});

test("a launch preview prefers the provider's model name and keeps its launch id", async () => {
  const worker = new Worker();
  worker.launcher = async () => ({
    account: async () => new Info(),
    model: async () => ({ model: "custom/private-v2", model_name: "My coding model", source: "Pi settings" }),
    close() {},
  });
  try {
    worker.preview(root);
    await worker.pump();
    const o = worker.preview(root).options.pi;
    expect(o.model.text()).toBe("custom/private-v2");
    expect(o.modelLabel()).toBe("My coding model");
    expect(o.source.text()).toBe("Pi settings");
  } finally {
    await worker.stop();
  }
});

test("accounts are listed before provider reads, and a slow account doesn't delay other rows", async () => {
  listed(["slow", "fast"]);
  const worker = new Worker(),
    slow = Promise.withResolvers<Info>(),
    started: string[] = [];
  worker.launcher = async (provider, account = "") => ({
    account: async () => {
      started.push(provider + account);
      if (account === join(root, "slow")) return slow.promise;
      return Object.assign(new Info(), { signed_in: true, account: new Text("fast@example.com") });
    },
    model: async () => ({ model: "opus", source: "test" }),
    close() {},
  });
  try {
    const first = worker.preview("/project");
    expect(first.pending).toBe(true);
    expect(first.accounts.map(a => a.name)).toEqual(["slow", "fast"]);
    expect(first.accounts.every(a => a.option.pending)).toBe(true);
    await turn();
    const partial = worker.preview("/project");
    expect(started).toHaveLength(5);
    expect(partial.pending).toBe(true);
    expect(partial.options.codex.pending).toBe(false);
    expect(partial.accounts[0].option.pending).toBe(true);
    expect(partial.accounts[1].option.account.text()).toBe("fast@example.com");
    expect(partial.accounts[1].option.pending).toBe(false);
    // Published snapshots stay unchanged so subscribers can detect the next update.
    expect(first.accounts[1].option.account.text()).toBe("");
    slow.resolve(new Info());
    await worker.pump();
    expect(worker.preview("/project").pending).toBe(false);
    expect(worker.preview("/project").accounts[0].option.pending).toBe(false);
    expect(partial.pending).toBe(true);
  } finally {
    slow.resolve(new Info());
    await worker.stop();
  }
});

test("account edits update a pending list and a failed reader doesn't block completion", async () => {
  listed(["removed"]);
  const worker = new Worker(),
    hold = Promise.withResolvers<Info>();
  worker.launcher = async (provider, account = "") => {
    if (provider === "codex") throw Error("Unavailable");
    return {
      account: async () => (account === join(root, "removed") ? hold.promise : new Info()),
      model: async () => ({ model: "", source: "test" }),
      close() {},
    };
  };
  try {
    worker.preview("/project");
    await turn();
    listed(["added"]);
    expect(worker.preview("/project").accounts.map(a => a.name)).toEqual(["added"]);
    hold.resolve(new Info());
    await worker.pump();
    const result = worker.preview("/project");
    expect(result.pending).toBe(false);
    expect(result.options.codex.pending).toBe(false);
    expect(result.options.codex.usage_error.text()).toBe("account read failed");
    expect(result.accounts.map(a => [a.name, a.option.pending])).toEqual([["added", false]]);
  } finally {
    hold.resolve(new Info());
    await worker.stop();
  }
});
