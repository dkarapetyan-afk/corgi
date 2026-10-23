import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { source } from "./integration";

test("Pi sends opening text before a transcript exists and never sends image data", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-prompt-"));
  const extension = join(root, "extension.mjs"),
    sender = join(root, "hook"),
    driver = join(root, "driver.mjs"),
    log = join(root, "hooks.jsonl");
  await writeFile(extension, source);
  await writeFile(
    sender,
    `#!${process.execPath}
import {appendFileSync} from "node:fs";
let text="";for await(const chunk of process.stdin)text+=chunk;
appendFileSync(${JSON.stringify(log)},text+"\\n");
`,
    { mode: 0o755 },
  );
  await writeFile(
    driver,
    `
import extension from ${JSON.stringify(extension)};
const hooks = new Map();
extension({on:(name,handler)=>hooks.set(name,handler),getSessionName:()=>undefined});
const session=crypto.randomUUID();
let branch=[];
const ctx={mode:"tui",cwd:"/tmp",ui:{onTerminalInput:()=>()=>{}},sessionManager:{getSessionId:()=>session,getSessionFile:()=>"/tmp/not-created-"+session,getBranch:()=>branch}};
await hooks.get("session_start")({},ctx);
await hooks.get("before_agent_start")({messageType:"user",prompt:"Fix keyboard shortcuts",images:[{data:"private-image"}]},ctx);
await hooks.get("agent_start")({},ctx);
await hooks.get("session_shutdown")({},ctx);
`,
  );
  const proc = Bun.spawn([process.execPath, driver], {
    env: {
      ...process.env,
      CORGI_PI_OWNER: "",
      CORGI_PANE: "1",
      CORGI_SOCKET: "/tmp/unused",
      CORGI_BIN: sender,
      PI_CODING_AGENT_DIR: root,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    expect(await proc.exited, await new Response(proc.stderr).text()).toBe(0);
    const text = await readFile(log, "utf8"),
      events = text
        .trim()
        .split("\n")
        .map(l => JSON.parse(l));
    expect(events.find(e => e.event === "UserPromptSubmit").initial_request).toBe("Fix keyboard shortcuts");
    expect(text).not.toContain("private-image");
  } finally {
    proc.kill();
    await proc.exited;
    await rm(root, { recursive: true, force: true });
  }
});
