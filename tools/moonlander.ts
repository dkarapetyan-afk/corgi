#!/usr/bin/env bun
//! Run with `bun tools/moonlander.ts`. No daemon or viewer is needed.
//! `--hull` picks how the ship's hull is drawn; `--help` lists the choices.
import { join } from "node:path";
import * as terminal from "../src/moonlander/terminal";
import * as faces from "../src/moonlander/faces";
import * as hull from "../src/moonlander/hull";
import { Differ } from "../src/frame_diff";
export { clearText, upload } from "../src/moonlander/terminal";

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

const usage = `usage: bun tools/moonlander.ts [--hull STYLE] [--levels 4|16] [--autoland] [--speed 2..10]

  --hull STYLE  how to draw the ship's hull:
                  image        Kitty graphics, turned smoothly (default);
                               turned-gray where the terminal has none
                  turned-gray  braille: the upright dots turned as pixel art,
                               with gray edges
                  turned       the same, without gray
                  fixed        braille: the outline redrawn at each tilt
  --levels N    alpha levels in the hull image: 4 or 16 (default 16)
  --speed N     game speed multiplier: an integer from 2 to 10 (default 1)
  --autoland    skip the title, and start each flight just above a pad,
                to land softly about a second in
`;
const levels: Record<string, faces.Bits> = { "4": 2, "16": 4 };
/** Options from the command line, or a usage error. */
export function options(argv: string[]): terminal.Options | { error: string } {
  const out: terminal.Options = {};
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    if (flag === "--autoland" && inline === undefined) {
      out.autoland = true;
      continue;
    }
    const value = inline ?? argv[++i] ?? "";
    if (flag === "--hull") {
      const style = hull.parseStyle(value);
      if (!style) return { error: `unknown hull style: ${value}` };
      out.hull = style;
    } else if (flag === "--levels") {
      if (!Object.hasOwn(levels, value)) return { error: `--levels takes 4 or 16, not ${value}` };
      out.bits = levels[value];
    } else if (flag === "--speed") {
      if (!/^(?:[2-9]|10)$/.test(value)) return { error: `--speed takes an integer from 2 to 10, not ${value}` };
      out.speed = Number(value);
    } else return { error: flag === "--help" || flag === "-h" ? "" : `unknown option: ${flag}` };
  }
  return out;
}

export async function run(argv = process.argv.slice(2)) {
  const chosen = options(argv);
  if ("error" in chosen) {
    process.stderr.write((chosen.error ? chosen.error + "\n\n" : "") + usage);
    process.exit(chosen.error ? 2 : 0);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error("Run Moonlander in an interactive terminal");
  const state = new terminal.State(process.stdout.columns, process.stdout.rows, () => {}, rasterize, chosen);
  let input = "",
    inputAt = 0,
    closed = false,
    host: Differ | null = null,
    timer: ReturnType<typeof setInterval>;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    host?.destroy();
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
    const cols = process.stdout.columns,
      rows = process.stdout.rows;
    if (host && (host.cols !== cols || host.rows !== rows)) {
      host.destroy();
      host = null;
    }
    host ??= Differ.create(cols, rows);
    process.stdout.write(host.diff(state.frame(cols, rows)));
    for (const write of state.takeWrites()) {
      process.stdout.write(write);
      host.invalidateImages();
    }
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
