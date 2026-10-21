#!/usr/bin/env bun
//! Run with `bun tools/moonlander.ts`. No daemon or viewer is needed.
import { join } from "node:path";
import * as terminal from "../src/moonlander_terminal";
import * as faces from "../src/moonlander_faces";
export { clearText, upload } from "../src/moonlander_terminal";

export async function rasterize(atlas: faces.Atlas): Promise<Uint8Array> {
  const child = Bun.spawn(["uv", "run", "--script", join(import.meta.dir, "moonlander_faces.py")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(JSON.stringify(atlas));
  child.stdin.end();
  const [tiles, errors, code] = await Promise.all([
    new Response(child.stdout).bytes(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw Error(`Face atlas rasterizer failed: ${errors.trim()}`);
  return faces.pack(atlas, tiles);
}

export async function run() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error("Run Moonlander in an interactive terminal");
  const state = new terminal.State(process.stdout.columns, process.stdout.rows, () => {}, rasterize);
  let input = "",
    inputAt = 0,
    closed = false,
    timer: ReturnType<typeof setInterval>;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    process.stdin.off("data", onData);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(state.close() + "\x1b[<u\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1003l\x1b[?1006l\x1b[?1049l");
    process.off("SIGINT", close);
    process.off("SIGTERM", close);
    process.off("SIGWINCH", query);
  };
  const query = () => process.stdout.write(terminal.State.query());
  const onData = (bytes: Buffer) => {
    inputAt = performance.now();
    input += bytes.toString();
    while (input.length && !closed) {
      if (input[0] !== "\x1b") {
        if (state.key(input.charCodeAt(0))) close();
        input = input.slice(1);
        continue;
      }
      if ("\x1b_G".startsWith(input)) break;
      if (input.startsWith("\x1b_G")) {
        const end = input.indexOf("\x1b\\", 3);
        if (end < 0) break;
        state.reply(input.slice(0, end + 2), process.stdout.columns, process.stdout.rows);
        input = input.slice(end + 2);
        continue;
      }
      const match = /^\x1b(?:\[[0-?]*[ -/]*[@-~]|O.)/.exec(input);
      if (!match) {
        if (input.length === 1 || input[1] === "[" || input[1] === "O") break;
        close();
        break;
      }
      const sequence = match[0];
      if (sequence.startsWith("\x1b[<")) {
        const click = /^\x1b\[<0;(\d+);(\d+)M$/.exec(sequence);
        if (click && state.click(Number(click[1]) - 1, Number(click[2]) - 1)) close();
      } else if (!state.reply(sequence, process.stdout.columns, process.stdout.rows) && state.sequence(sequence))
        close();
      input = input.slice(sequence.length);
    }
  };
  const draw = () => {
    if (input === "\x1b" && performance.now() - inputAt > 40) close();
    if (closed) return;
    if (performance.now() - inputAt > 1000) input = "";
    process.stdout.write(state.frame(process.stdout.columns, process.stdout.rows));
    for (const write of state.takeWrites()) process.stdout.write(write);
  };
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onData);
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  process.on("SIGWINCH", query);
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?1006h\x1b[>1u");
  query();
  timer = setInterval(() => {
    try {
      draw();
    } catch (error) {
      close();
      throw error;
    }
  }, 1000 / 30);
  draw();
}
if (import.meta.main) await run();
