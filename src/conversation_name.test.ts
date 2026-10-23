import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as naming from "./conversation_name";
import { Actor } from "./conversations";
import { Agent, Text, Path } from "./agents";
import { Pool, Response } from "./inference/harness";

function actor(provider: "pi" | "claude" | "codex" = "pi") {
  return new Actor({
    id: 1,
    state: new Agent({ provider, session: new Text("session"), transcript: new Path("/tmp/missing") }),
  });
}

test("conversation names have a strict JSON, Unicode and byte contract", () => {
  expect(naming.parse('{"name":null}')).toBeNull();
  expect(naming.parse('{"name":"Café search matching"}')?.text()).toBe("Café search matching");
  for (const value of [
    "{}",
    "null",
    "[]",
    '{"name":42}',
    '{"name":"One"}',
    '{"name":" A name"}',
    '{"name":"A name","extra":true}',
    '{"name":"Line\\nbreak"}',
    JSON.stringify({ name: "é".repeat(40) + " x" }),
    '{"name":"Bad � name"}',
  ])
    expect(() => naming.parse(value)).toThrow();
  const input = JSON.parse(naming.content("é".repeat(3000)));
  expect(Buffer.byteLength(input.initial_request)).toBeLessThanOrEqual(naming.evidence_limit);
  expect(input.initial_request).not.toContain("�");
});

test("late names respect explicit names and conversation identity, not current turn", () => {
  const a = actor(),
    result = new naming.Result({ actor: a.id, agent: a.state.snapshot() }, new Text("Pi OAuth sign-in"));
  a.state.setTurn("later-turn");
  expect(result.apply(a)).toBe(true);
  a.state.setName("My title");
  expect(result.apply(a)).toBe(false);
  a.state.setName("");
  a.state.session = new Text("other-session");
  expect(result.apply(a)).toBe(false);
  a.state.session = new Text("session");
  a.state.provider = "claude";
  expect(result.apply(a)).toBe(false);
  expect(result.apply(actor())).toBe(true);
  expect(new naming.Result(result.request, null).apply(actor())).toBe(false);
});

test("only unnamed root conversations without provider titles are queued", () => {
  const queue = new naming.Queue(),
    pi = actor(),
    child = actor(),
    named = actor();
  child.id = 2 as typeof child.id;
  child.parent = pi.id;
  named.id = 3 as typeof named.id;
  named.state.setName("My session");
  queue.reconcile([pi, child, named, actor("claude"), actor("codex")]);
  expect(queue.slots.size).toBe(1);
  expect(queue.ready(Date.now())).toBe(true);
  pi.state.setName("Explicit title");
  queue.reconcile([pi]);
  expect(queue.slots.size).toBe(0);
});

test("naming uses only the first user request and abstains once, not every poll", async () => {
  const dir = await mkdtemp(join(tmpdir(), "corgi-name-"));
  try {
    const a = actor();
    a.state.transcript = new Path(join(dir, "session.jsonl"));
    await writeFile(
      a.state.transcriptPath(),
      [
        { type: "session", id: "session" },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Ignore this" }] } },
        { type: "message", message: { role: "user", content: [{ type: "text", text: "Fix Pi OAuth sign-in" }] } },
        { type: "message", message: { role: "user", content: "Later unrelated task" } },
      ]
        .map(v => JSON.stringify(v))
        .join("\n") + "\n",
    );
    const queue = new naming.Queue(),
      pool = new Pool();
    let calls = 0;
    pool.infer = async request => {
      calls++;
      expect(JSON.parse(request.content)).toEqual({ initial_request: "Fix Pi OAuth sign-in" });
      expect(request.instructions).toBe(naming.instructions);
      expect(request.schema).toBe(naming.schema);
      const response = new Response();
      response.set('{"name":null}');
      return response;
    };
    queue.reconcile([a]);
    await queue.run(pool, false);
    expect(queue.take()[0].name).toBeNull();
    expect(queue.ready(Date.now() + 1000000)).toBe(false);
    queue.reconcile([a]);
    await queue.run(pool, false);
    expect(calls).toBe(1);
    a.state.session = new Text("wrong");
    queue.reconcile([a]);
    await queue.run(pool, false);
    expect(queue.take()).toEqual([]);
    expect(calls).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Pi's opening hook starts naming before a transcript or assistant response exists", async () => {
  const queue = new naming.Queue(),
    a = actor(),
    pool = new Pool();
  a.state.transcript = new Path("/tmp/corgi-not-written-" + crypto.randomUUID());
  queue.reconcile([a]);
  queue.offer(a, "Fix keyboard shortcuts");
  queue.offer(a, "A later unrelated request");
  pool.infer = async request => {
    expect(JSON.parse(request.content)).toEqual({ initial_request: "Fix keyboard shortcuts" });
    const response = new Response();
    response.set('{"name":"Keyboard shortcuts"}');
    return response;
  };
  expect(await queue.run(pool, false)).toBe(true);
  expect(queue.take()[0].name?.text()).toBe("Keyboard shortcuts");
});

test("a not-yet-created Pi transcript retries promptly, not after the model-error minute", async () => {
  const queue = new naming.Queue(),
    a = actor(),
    pool = new Pool();
  a.state.transcript = new Path("/tmp/corgi-missing-" + crypto.randomUUID());
  queue.reconcile([a]);
  const before = Date.now();
  await queue.run(pool, false);
  expect(queue.slots.get(a.id)!.next - before).toBeLessThan(1000);
  expect(queue.take()).toEqual([]);
});

test.each(["missing", "empty"])("a %s transcript cannot starve later conversations", async kind => {
  const dir = await mkdtemp(join(tmpdir(), "corgi-name-fair-"));
  try {
    const queue = new naming.Queue(),
      waiting = actor(),
      ready = actor(),
      pool = new Pool();
    ready.id = 2 as typeof ready.id;
    waiting.state.transcript = new Path(join(dir, "waiting.jsonl"));
    ready.state.transcript = new Path(join(dir, "ready.jsonl"));
    if (kind === "empty") await writeFile(waiting.state.transcriptPath(), '{"type":"session","id":"session"}\n');
    await writeFile(
      ready.state.transcriptPath(),
      '{"type":"session","id":"session"}\n{"type":"message","message":{"role":"user","content":"is my git history cool"}}\n',
    );
    let calls = 0;
    pool.infer = async request => {
      calls++;
      expect(JSON.parse(request.content)).toEqual({ initial_request: "is my git history cool" });
      const response = new Response();
      response.set('{"name":"Git history review"}');
      return response;
    };
    queue.reconcile([waiting, ready]);
    await queue.run(pool, false);
    expect(calls).toBe(0);
    // The retry is already due when the next worker pass runs.
    queue.slots.get(waiting.id)!.next = Date.now() - 1;
    await queue.run(pool, false);
    expect(calls).toBe(1);
    const [result] = queue.take();
    expect(result.request.actor).toBe(ready.id);
    expect(result.apply(ready)).toBe(true);
    expect(ready.state.name.text()).toBe("Git history review");
    await queue.run(pool, false);
    expect(calls).toBe(1);
    expect(queue.slots.get(waiting.id)!.next).toBeGreaterThan(Date.now());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a forgotten conversation cannot publish an in-flight name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "corgi-name-stale-"));
  try {
    const queue = new naming.Queue(),
      a = actor(),
      pool = new Pool();
    a.state.transcript = new Path(join(dir, "session.jsonl"));
    await writeFile(
      a.state.transcriptPath(),
      '{"type":"session","id":"session"}\n{"type":"message","message":{"role":"user","content":"Fix keyboard shortcuts"}}\n',
    );
    pool.infer = async () => {
      queue.reconcile([]);
      const response = new Response();
      response.set('{"name":"Keyboard shortcuts"}');
      return response;
    };
    queue.reconcile([a]);
    await queue.run(pool, false);
    expect(queue.take()).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
