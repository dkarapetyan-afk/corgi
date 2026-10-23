import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as server from "./server";
let root = "";
afterEach(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});
/** `opencode serve --stdio` as OpenCode runs it: its address on stdout, its
 * password from the environment, gone once its stdin closes. */
function fake() {
  root = mkdtempSync(join(tmpdir(), "corgi-opencode-server-"));
  const path = join(root, "opencode");
  writeFileSync(
    path,
    `#!${process.execPath}
require("node:fs").appendFileSync(${JSON.stringify(join(root, "runs"))}, process.argv.slice(2).join(" ") + "\\n");
const auth = "Basic " + btoa("opencode:" + process.env.OPENCODE_PASSWORD);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: r => (r.headers.get("authorization") === auth ? Response.json({ pid: process.pid }) : new Response("", { status: 401 })),
});
console.log(JSON.stringify({ url: "http://127.0.0.1:" + server.port }));
for await (const _ of Bun.stdin.stream());
process.exit(0);
`,
    { mode: 0o755 },
  );
  return async () => path;
}
async function pid(endpoint: { url: string; authorization: string }): Promise<number> {
  const reply = await fetch(endpoint.url, { headers: { authorization: endpoint.authorization } });
  return (await reply.json()).pid;
}
async function gone(pid: number) {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await Bun.sleep(20);
  }
  return false;
}
test("a private server answers with its own password and stays a while for the next read", async () => {
  const executable = fake(),
    first = await server.hold(executable, 100),
    running = await pid(first.endpoint);
  first.release();
  const second = await server.hold(executable, 100);
  expect(second.endpoint).toEqual(first.endpoint);
  second.release();
  expect(await gone(running)).toBe(true);
  expect(readFileSync(join(root, "runs"), "utf8")).toBe("serve --stdio --port 0\n");
});
test("a private server that died is started again", async () => {
  const executable = fake(),
    first = await server.hold(executable),
    running = await pid(first.endpoint);
  process.kill(running, "SIGKILL");
  expect(await gone(running)).toBe(true);
  first.release();
  await Bun.sleep(50);
  const second = await server.hold(executable);
  expect(await pid(second.endpoint)).not.toBe(running);
  second.release();
});
