import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { source } from "./integration";
import { channel, suggest } from "./rename";

test("Pi outside Corgi never opens the naming channel or changes its name", async () => {
  const module = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
  const proc = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    const { default: extension } = await import(${JSON.stringify(module)});
    const hooks = new Map();
    extension({ on: (event, handler) => hooks.set(event, handler), setSessionName: () => { throw Error("UnexpectedRename"); } });
    const ctx = { mode: "tui", ui: { onTerminalInput: () => { throw Error("UnexpectedCorgiIntegration"); } } };
    await hooks.get("session_start")({}, ctx);
    await hooks.get("session_shutdown")({}, ctx);
  `,
    ],
    {
      env: { ...process.env, CORGI_PI_OWNER: "", CORGI_PANE: "", CORGI_SOCKET: "", CORGI_BIN: "" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(await proc.exited, await new Response(proc.stderr).text()).toBe(0);
});

test("older Pi extensions are never sent an automatic rename", async () => {
  const account = "/tmp/pi-old-extension",
    session = crypto.randomUUID(),
    uid = process.getuid?.() ?? 0;
  const hash = createHash("sha256")
    .update(account + "\n" + session)
    .digest("hex")
    .slice(0, 24);
  const path = join(tmpdir(), `corgi-pi-${uid}-${hash}-${process.pid}.sock`);
  const requests: { name?: string }[] = [];
  const server = createServer(socket =>
    socket.on("data", bytes => {
      requests.push(JSON.parse(bytes.toString()));
      socket.end('{"ok":true}\n');
    }),
  );
  await new Promise<void>(resolve => server.listen(path, resolve));
  try {
    expect(await suggest(session, "Automatic name", account)).toBe("unavailable");
    expect(requests.every(r => r.name === undefined)).toBe(true);
    const rename = await channel(session, true, account);
    await rename!("Manual name");
    expect(requests.at(-1)?.name).toBe("Manual name");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("automatic Pi names never replace an explicit name, but manual renames can", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-name-"));
  const session = crypto.randomUUID();
  const extension = join(dir, "extension.mjs"),
    driver = join(dir, "driver.mjs");
  await writeFile(extension, source);
  await writeFile(
    driver,
    `
import extension from ${JSON.stringify(extension)};
const hooks = new Map();
let name = "Explicit title";
extension({ on: (event, handler) => hooks.set(event, handler), getSessionName: () => name, setSessionName: value => { name = value; console.log(JSON.stringify({name})); } });
const ctx = {mode:"tui",cwd:"/tmp",ui:{onTerminalInput:()=>()=>{}},sessionManager:{getSessionId:()=>${JSON.stringify(session)},getSessionFile:()=>""}};
await hooks.get("session_start")({}, ctx);
console.log("ready");
for await (const chunk of process.stdin) break;
await hooks.get("session_shutdown")({}, ctx);
`,
  );
  const proc = Bun.spawn([process.execPath, driver], {
    env: {
      ...process.env,
      CORGI_PI_OWNER: "",
      CORGI_PANE: "1",
      CORGI_SOCKET: "/tmp/not-used",
      CORGI_BIN: "/usr/bin/true",
      PI_CODING_AGENT_DIR: dir,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const reader = proc.stdout.getReader();
    let output = "";
    while (!output.includes("ready\n")) {
      const chunk = await reader.read();
      if (chunk.done) throw Error("ExtensionExited");
      output += new TextDecoder().decode(chunk.value);
    }
    expect(await suggest(session, "Generated title", dir)).toBe("exists");
    const rename = await channel(session, true, dir);
    expect(rename).not.toBeNull();
    await rename!("Manual title");
    expect(await suggest(session, "Generated title", dir)).toBe("exists");
    await rename!("");
    expect(await suggest(session, "Generated title", dir)).toBe("named");
    proc.stdin.write("stop\n");
    proc.stdin.end();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += new TextDecoder().decode(chunk.value);
    }
    expect(await proc.exited, await new Response(proc.stderr).text()).toBe(0);
    expect(output).toContain('{"name":"Manual title"}');
    expect(output).toContain('{"name":"Generated title"}');
    expect(output).not.toContain('{"name":"Explicit title"}');
  } finally {
    proc.kill();
    await proc.exited;
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
