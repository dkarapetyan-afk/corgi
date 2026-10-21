//! Live PTY bandwidth: build root, workload, and output directory.
import { mkdirSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { Session } from "../../ui_driver";
import { Terminal } from "../../../src/pane/terminal";

const root = resolve(process.argv[2]);
const workload = process.argv[3];
if (!["moonlander", "corgi-moonlander", "corgi"].includes(workload)) throw Error("unknown workload");
const directory = resolve(process.argv[4]);
mkdirSync(directory, { recursive: true });
const seconds = 20,
  cols = 120,
  rows = 40;
const samples = Array.from({ length: seconds }, (_, i) => ({ second: i + 1, bytes: 0, frames: 0, screen: "" }));
const raw = Bun.file(join(directory, "terminal.bin")).writer();
let start: number | null = null,
  startupBytes = 0,
  pending = "",
  sending: string | null = null;
const placements = new Set<string>(),
  uploads = new Set<string>();
const screen = Terminal.create(cols, rows);
let respond: (data: string) => void;
const terminal = new Bun.Terminal({
  cols,
  rows,
  data(pty, bytes) {
    raw.write(bytes);
    screen.feed(bytes);
    const now = performance.now();
    const index = start === null ? -1 : Math.floor((now - start) / 1000);
    if (start === null) startupBytes += bytes.length;
    else if (index >= 0 && index < seconds) samples[index].bytes += bytes.length;
    pending += Buffer.from(bytes).toString("latin1");
    while (pending.length) {
      const esc = pending.indexOf("\x1b");
      if (esc < 0) {
        pending = "";
        break;
      }
      if (esc) pending = pending.slice(esc);
      if (pending.length < 2) break;
      if (pending.startsWith("\x1b_G")) {
        const end = pending.indexOf("\x1b\\");
        if (end < 0) break;
        const f = Object.fromEntries(
          pending
            .slice(3, end)
            .split(";", 1)[0]
            .split(",")
            .map(x => x.split("=")),
        );
        pending = pending.slice(end + 2);
        if (f.a === "q") pty.write(`\x1b_Gi=${f.i};OK\x1b\\`);
        if (f.a === "t" || f.a === "T") sending = f.i ?? null;
        if (f.a === "p") placements.add(f.i);
        if (sending && f.m !== "1") {
          uploads.add(sending);
          if (f.q !== "2") pty.write(`\x1b_Gi=${sending};OK\x1b\\`);
          sending = null;
        }
      } else if (pending.startsWith("\x1b[")) {
        const match = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(pending);
        if (!match) break;
        const s = match[0];
        pending = pending.slice(s.length);
        if (s === "\x1b[16t") pty.write("\x1b[6;22;10t");
        if (s === "\x1b[14t") pty.write("\x1b[4;880;1200t");
        if (s === "\x1b[?2026l" && index >= 0 && index < seconds) samples[index].frames++;
        if (s === "\x1b[5n") pty.write("\x1b[0n");
        if (s === "\x1b[6n") pty.write("\x1b[1;1R");
      } else if (pending.startsWith("\x1b]")) {
        const end = /\x07|\x1b\\/.exec(pending);
        if (!end) break;
        const body = pending.slice(2, end.index);
        pending = pending.slice(end.index + end[0].length);
        if (body === "10;?") pty.write("\x1b]10;rgb:dddd/dddd/dddd\x1b\\");
        if (body === "11;?") pty.write("\x1b]11;rgb:1111/1111/1111\x1b\\");
      } else if ("\x1b_G".startsWith(pending)) break;
      else pending = pending.slice(2);
    }
  },
});
respond = data => terminal.write(data);
const exe = join(root, "dist/corgi-test");
let session: Session | null = null,
  child: Bun.Subprocess | null = null;
const actions: { at: number; label: string; run: () => Promise<unknown> | void }[] = [];
async function command(args: string[]) {
  const proc = Bun.spawn([exe, ...args], { cwd: session!.cwd, env: session!.env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code) throw Error(`${args.join(" ")}: ${err}`);
  return out;
}
async function until(test: () => boolean, label: string, ms = 20000) {
  const end = performance.now() + ms;
  while (!test()) {
    if (performance.now() > end) throw Error(`${label}: ${screen.liveText()}`);
    await Bun.sleep(25);
  }
}
try {
  if (workload === "moonlander") {
    child = Bun.spawn([process.execPath, "tools/moonlander.ts"], {
      cwd: root,
      env: { ...process.env, TERM: "xterm-kitty", CORGI_NATIVE_ROOT: join(root, "native/zig-out") },
      terminal,
    });
  } else {
    const helper = join(directory, "pty-pixels");
    const compiled = Bun.spawnSync(["cc", join(import.meta.dir, "pty_pixels.c"), "-o", helper]);
    if (compiled.exitCode) throw Error(compiled.stderr.toString());
    const wrapper = join(directory, "viewer");
    const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    await Bun.write(wrapper, `#!/bin/sh\nexec ${quote(helper)} ${quote(exe)} "$@"\n`);
    chmodSync(wrapper, 0o700);
    session = new Session(wrapper, exe, cols, rows);
    session.terminal.close();
    session.terminal = terminal;
    session.env.TERM = "xterm-kitty";
    await session.start();
    await until(() => screen.liveText().includes("CPU"), "viewer ready");
    if (workload === "corgi-moonlander") await command(["action", "moonlander"]);
    else {
      // Give the terminal a controlled workload with sparse and dense updates.
      const script = join(session.home, "traffic.ts");
      await Bun.write(
        script,
        `const start=performance.now(); let tick=0;\nprocess.stdout.write("\\x1b[2J");\nwhile(performance.now()-start<16000){\n const t=(performance.now()-start)/1000;\n if(t<6 || t>=12){for(let row=1;row<=25;row++)process.stdout.write(\`\\x1b[\${row};1H\\x1b[36m\${String(tick).padStart(6,"0")}\\x1b[0m \${".".repeat(65)} \\x1b[33m\${String(tick+row).padStart(6,"0")}\\x1b[0m\`);}\n else {process.stdout.write(\`\${String(tick).padStart(6,"0")} \${Array.from({length:80},(_,i)=>String.fromCharCode(33+(tick*17+i*13)%80)).join("")}\\r\\n\`);}\n tick++;await Bun.sleep(50);}\nprocess.stdout.write("\\x1b[30;1Hdone\\r\\n");\n`,
      );
      await until(() => screen.liveText().includes("$"), "shell prompt");
      actions.push({ at: 0, label: "sparse counters (20 Hz)", run: () => respond(`${process.execPath} ${script}\r`) });
      actions.push({ at: 6, label: "dense scrolling output", run: () => {} });
      actions.push({ at: 12, label: "sparse counters", run: () => {} });
      actions.push({ at: 16, label: "idle", run: () => {} });
      actions.push({ at: 17, label: "open help", run: () => command(["action", "help"]) });
      actions.push({ at: 18, label: "close help", run: () => respond("\x1b[27u") });
    }
  }
  if (workload !== "corgi") {
    await until(
      () => placements.has("730202") && [...placements].some(id => +id >= 730210 && +id <= 730236),
      "face and hull placed",
    );
    for (const [at, key, label] of [
      [0, "\rw", "launch + thrust"],
      [2, "d", "tilt right"],
      [3, "a", "upright"],
      [6, "s", "coast"],
      [10, "w", "thrust"],
      [12, "a", "tilt left"],
      [13, "d", "upright"],
      [14, "s", "coast"],
    ] as const)
      actions.push({ at, label, run: () => respond(key) });
  }
  await Bun.sleep(400);
  const before = screen.liveText();
  await Bun.write(join(directory, "initial-screen.txt"), before);
  start = performance.now();
  for (let second = 0; second < seconds; second++) {
    for (const action of actions.filter(a => a.at === second)) await action.run();
    await Bun.sleep(Math.max(1, start + (second + 1) * 1000 - performance.now()));
    const text = screen.liveText();
    samples[second].screen =
      workload === "corgi"
        ? text
        : text
            .split("\n")
            .filter(line => /\balt\s+\d|fuel|crash|landed/i.test(line))
            .map(x => x.trim())
            .join(" | ");
    console.log(JSON.stringify({ second: second + 1, bytes: samples[second].bytes, frames: samples[second].frames }));
  }
  const result = {
    workload,
    root,
    revision: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim(),
    seconds,
    cols,
    rows,
    cellPixels: { width: 10, height: 22 },
    units: "raw PTY bytes per second, including Kitty; excludes SSH transport; startup excluded from samples",
    startupBytes,
    uploads: [...uploads],
    actions: actions.map(({ at, label }) => ({ at, label })),
    samples,
    totalBytes: samples.reduce((sum, s) => sum + s.bytes, 0),
  };
  await Bun.write(join(directory, "bandwidth.json"), JSON.stringify(result, null, 2) + "\n");
  await Bun.write(join(directory, "final-screen.txt"), screen.liveText());
  console.log(
    JSON.stringify({
      workload,
      totalBytes: result.totalBytes,
      KBps: result.totalBytes / seconds / 1000,
      startupBytes,
      directory,
    }),
  );
} finally {
  if (session) await session.close();
  else if (child) {
    try {
      respond("q");
      await Promise.race([child.exited, Bun.sleep(1000)]);
      child.kill("SIGKILL");
    } catch {}
    terminal.close();
  }
  screen.destroy();
  await raw.end();
}
