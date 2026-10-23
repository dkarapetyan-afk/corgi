//! Opt-in Pi/Luna RPC queue, write, stop and recovery checks. Pass Pi cli.js.
import { Pi } from "../src/providers/pi/headless";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
const dir = mkdtempSync("/tmp/corgi-pi-rpc-");
const cli = process.argv[2];
writeFileSync(
  dir + "/pi",
  "#!/bin/sh\nexec " + JSON.stringify(process.execPath) + " " + JSON.stringify(cli) + ' "$@"\n',
  { mode: 0o700 },
);
let c = Pi.start({ cwd: dir, account: "", executable: dir + "/pi" }, [
  "--session-dir",
  dir + "/sessions",
  "--model",
  "openai-codex/gpt-6-luna",
  "--thinking",
  "low",
  "--no-extensions",
  "--no-context-files",
  "--no-skills",
  "--no-prompt-templates",
  "--no-approve",
]);
async function until(fn: (ev: any[]) => boolean, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const events = c.take();
    for (const e of events) console.log(JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    if (fn(events)) return;
    await c.wait(Date.now() + 10);
  }
  throw Error("timeout");
}
try {
  await until(() => c.ready, 20000);
  c.send({
    kind: "prompt",
    text: "Use the write tool to create result.txt containing exactly PI_OK. Then reply with PI_DONE.",
  });
  await until(es => es.some(e => e.kind === "turn" && e.phase === "ended"));
  if ((await Bun.file(dir + "/result.txt").text()).trim() !== "PI_OK") throw Error("missing write");
  c.send({ kind: "prompt", text: "Run bash command sleep 20. Then say SLEEP_DONE." });
  await until(es => es.some(e => e.kind === "tool" && !e.done));
  c.send({ kind: "prompt", text: "Create must-not-exist.txt containing QUEUED." });
  c.send({ kind: "interrupt" });
  await until(es => es.some(e => e.kind === "turn" && e.phase === "ended" && e.outcome === "interrupted"));
  if (await Bun.file(dir + "/must-not-exist.txt").exists()) throw Error("queue continued");
  c.send({ kind: "prompt", text: "Reply with RECOVERED, without tools." });
  await until(es => es.some(e => e.kind === "turn" && e.phase === "ended" && e.outcome === "completed"));
  if (await Bun.file(dir + "/must-not-exist.txt").exists()) throw Error("queue survived stop into next run");
  console.log("LIVE PASS", cli);
} finally {
  c.close();
  rmSync(dir, { recursive: true, force: true });
}
