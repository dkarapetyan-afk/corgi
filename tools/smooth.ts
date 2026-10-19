/**
 * Smooth-animation load test: draws frames on a fixed clock so you can see
 * whether the terminal around it (Corgi) keeps up with a busy pane.
 *
 *   bun tools/smooth.ts              # sliding bars at 60 fps
 *   bun tools/smooth.ts --fps 30     # or 15, or any rate
 *   bun tools/smooth.ts --plasma     # repaint every cell in truecolor
 *
 * Keys: 1/2/3 switch to 60/30/15 fps, s switches scene, q quits.
 *
 * Motion follows the frame clock, so every frame moves the same distance and
 * any stutter on screen happened after this process. The top line counts
 * frames drawn and skipped, how late the clock fired, how long stdout took to
 * drain, and the round trip of a cursor-position query sent after each frame,
 * which the terminal answers only once it has parsed the frame.
 */

type Scene = "bars" | "plasma";

const RATES: Record<string, number> = { "1": 60, "2": 30, "3": 15 };
const BLOCKS = " ▏▎▍▌▋▊▉";
const ECHO_REPLY = /\x1b\[\d+;\d+R/g;

function usage(): never {
  console.error("usage: bun tools/smooth.ts [--fps 60|30|15] [--plasma]");
  process.exit(2);
}

function options(argv: string[]): { fps: number; scene: Scene } {
  let fps = 60;
  let scene: Scene = "bars";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--plasma") scene = "plasma";
    else if (arg === "--fps" || arg === "-r") fps = Number(argv[++i]);
    else if (arg.startsWith("--fps=")) fps = Number(arg.slice("--fps=".length));
    else usage();
  }
  if (!(fps > 0 && fps <= 1000)) usage();
  return { fps, scene };
}

/** "r;g;b" on a cosine rainbow, `t` in turns. */
function color(t: number, brightness = 1): string {
  const channel = (offset: number) => Math.round(255 * brightness * (0.5 + 0.5 * Math.cos(2 * Math.PI * (t + offset))));
  return `${channel(0)};${channel(0.33)};${channel(0.67)}`;
}

const RAINBOW = Array.from({ length: 256 }, (_, i) => color(i / 256));

/** One block per row, sliding at a constant speed with eighth-cell steps. */
function bars(rows: number, cols: number, time: number): string {
  const out: string[] = [];
  const span = cols * 8;
  const width = Math.min(span - 8, Math.max(4, Math.round(cols / 10)) * 8);
  for (let row = 0; row < rows; row++) {
    const crossing = 2 + (row % 6) * 0.5;
    const left = Math.round(((time / crossing) % 1) * span);
    const bar = color(row / rows);
    const track = color(row / rows, 0.15);
    let fg = "";
    let bg = "";
    out.push(`\x1b[${row + 2};1H`);
    for (let col = 0; col < cols; col++) {
      const start = col * 8;
      const into = (start - left + span) % span;
      const before = (left - start + span) % span;
      let cell: [fg: string, bg: string, glyph: string];
      if (into + 8 <= width) cell = [fg, bar, " "];
      else if (into < width) cell = [bar, track, BLOCKS[width - into]];
      else if (before > 0 && before < 8) cell = [track, bar, BLOCKS[before]];
      else cell = [fg, track, " "];
      if (cell[0] !== fg) out.push(`\x1b[38;2;${(fg = cell[0])}m`);
      if (cell[1] !== bg) out.push(`\x1b[48;2;${(bg = cell[1])}m`);
      out.push(cell[2]);
    }
  }
  return out.join("");
}

/** Every cell changes every frame: two truecolor pixels per cell. */
function plasma(rows: number, cols: number, time: number): string {
  const out: string[] = [];
  const pixel = (x: number, y: number) => {
    const v =
      Math.sin(x / 9 + time) +
      Math.sin(y / 7 - time * 1.3) +
      Math.sin((x + y) / 13 + time * 0.7) +
      Math.sin(Math.hypot(x - cols / 2, y - rows) / 8 - time * 2);
    return RAINBOW[Math.floor(((v / 8 + time * 0.05) % 1) * 256 + 256) % 256];
  };
  for (let row = 0; row < rows; row++) {
    out.push(`\x1b[${row + 2};1H`);
    for (let col = 0; col < cols; col++) {
      out.push(`\x1b[38;2;${pixel(col, row * 2)};48;2;${pixel(col, row * 2 + 1)}m▀`);
    }
  }
  return out.join("");
}

if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.error("smooth: run this in a terminal");
  process.exit(1);
}

let { fps, scene } = options(process.argv.slice(2));
let start = performance.now();
let base = 0;
let frame = -1;
let timer: Timer | undefined;
let writing = false;
let echoSent: number | null = null;
let skipped = 0;
let window = { since: start, drawn: 0, bytes: 0, late: 0, write: 0, echoes: [] as number[] };
let status = "measuring…";

function time(): number {
  return base + Math.max(frame, 0) / fps;
}

function setRate(next: number) {
  base = time();
  fps = next;
  start = performance.now();
  frame = -1;
  clearTimeout(timer);
  tick();
}

function summarize(now: number) {
  const seconds = (now - window.since) / 1000;
  const echoes = window.echoes;
  const echo = echoes.length
    ? `${(echoes.reduce((a, b) => a + b, 0) / echoes.length).toFixed(1)} ms ≤${Math.max(...echoes).toFixed(1)}`
    : echoSent === null
      ? "—"
      : `>${(now - echoSent).toFixed(0)} ms`;
  status = [
    `drew ${(window.drawn / seconds).toFixed(1)}/s`,
    `skipped ${skipped}`,
    `late ≤${window.late.toFixed(1)} ms`,
    `stdout ≤${window.write.toFixed(1)} ms`,
    `echo ${echo}`,
    `${(window.bytes / seconds / 1e6).toFixed(2)} MB/s`,
  ].join(" │ ");
  window = { since: now, drawn: 0, bytes: 0, late: 0, write: 0, echoes: [] };
}

function header(cols: number): string {
  const text = ` ${fps} fps ${scene} │ ${status} │ 1/2/3 60/30/15  s scene  q quit`;
  return `\x1b[1;1H\x1b[0;7m${text.slice(0, cols).padEnd(cols)}\x1b[0m`;
}

function tick() {
  const now = performance.now();
  const interval = 1000 / fps;
  let next = frame + 1;
  window.late = Math.max(window.late, now - (start + next * interval));
  const due = Math.floor((now - start) / interval);
  if (due > next) {
    skipped += due - next;
    next = due;
  }
  frame = next;
  if (now - window.since >= 1000) summarize(now);
  if (writing) skipped++;
  else draw(now);
  timer = setTimeout(tick, start + (frame + 1) * interval - performance.now());
}

function draw(now: number) {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows - 1;
  const body = scene === "bars" ? bars(rows, cols, time()) : plasma(rows, cols, time());
  let out = `\x1b[?2026h${header(cols)}${body}\x1b[0m\x1b[?2026l`;
  if (echoSent === null || now - echoSent > 2000) {
    out += "\x1b[6n";
    echoSent = now;
  }
  writing = true;
  window.drawn++;
  window.bytes += Buffer.byteLength(out);
  process.stdout.write(out, () => {
    writing = false;
    window.write = Math.max(window.write, performance.now() - now);
  });
}

function quit() {
  clearTimeout(timer);
  process.stdin.setRawMode(false);
  process.stdout.write("\x1b[?2026l\x1b[0m\x1b[?25h\x1b[?1049l", () => process.exit(0));
  setTimeout(() => process.exit(0), 1000);
}

process.stdin.setRawMode(true);
process.stdin.on("data", (chunk: Buffer) => {
  const keys = chunk.toString().replace(ECHO_REPLY, () => {
    if (echoSent !== null) window.echoes.push(performance.now() - echoSent);
    echoSent = null;
    return "";
  });
  for (const key of keys) {
    if (key === "q" || key === "\x03") return quit();
    if (key in RATES) setRate(RATES[key]);
    else if (key === "s") scene = scene === "bars" ? "plasma" : "bars";
  }
});
process.stdout.on("resize", () => process.stdout.write("\x1b[2J"));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, quit);

process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
tick();
