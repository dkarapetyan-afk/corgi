import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as terminal from "./moonlander_terminal";
import * as cli from "../tools/moonlander";

test("--speed accepts integer multipliers from 2 through 10", () => {
  expect(cli.options([])).toEqual({});
  for (let speed = 2; speed <= 10; speed++) {
    expect(cli.options(["--speed", String(speed)])).toEqual({ speed });
    expect(cli.options([`--speed=${speed}`, "--autoland"])).toEqual({ speed, autoland: true });
  }
  for (const value of ["", "1", "0", "11", "-2", "2.5", "NaN", "Infinity", "fast"])
    expect(cli.options(["--speed", value])).toHaveProperty("error");
  expect(cli.options(["--speed"])).toHaveProperty("error");
});

test("the terminal advances at the selected speed and still pauses", () => {
  for (const speed of [undefined, 2, 10]) {
    const state = new terminal.State(100, 30, () => {}, undefined, { hull: "fixed", speed });
    for (let frame = 0; frame <= 30; frame++) state.frame(100, 30, null, false, (frame * 1000) / 30);
    expect(state.engine.game.t).toBeCloseTo(speed ?? 1, 1);
    state.engine.launch(1);
    state.engine.press("pause");
    const before = state.engine.game.t;
    state.frame(100, 30, null, false, 1034);
    expect(state.engine.game.t).toBe(before);
    state.close();
  }
});

// Model Ghostty's ED2 eviction and its upload/placement acknowledgements.
// The face must survive a full repaint, restart, and a resize warning.
test("the terminal keeps its uploaded Kitty atlas through full repaints", async () => {
  const directory = mkdtempSync(join(tmpdir(), "corgi-moonlander-"));
  // Exercise Kitty's atlas lifetime without needing Python or installed fonts.
  writeFileSync(
    join(directory, "uv"),
    `#!/usr/bin/env bun
const atlas = await Bun.stdin.json();
const count = atlas.tiles.reduce((n, tile) => n + tile.count, 0);
process.stdout.write(Buffer.alloc(count * atlas.side * atlas.side, 128));
`,
    { mode: 0o755 },
  );
  // Images by id, as Ghostty keeps them: uploads, placements and deletes.
  const face = 730202,
    hullFirst = 730210,
    hullLast = 730236;
  let data = "",
    sending: number | null = null,
    missing = 0;
  const stored = new Set<number>(),
    uploads = new Map<number, number>(),
    placements = new Map<number, number>(),
    placed = (ids: (id: number) => boolean) => [...placements].reduce((n, [id, count]) => n + (ids(id) ? count : 0), 0);
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../tools/moonlander.ts")], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
    terminal: {
      cols: 100,
      rows: 30,
      data(terminal, bytes) {
        data += Buffer.from(bytes).toString();
        while (data.length) {
          if (data.startsWith("\x1b_G")) {
            const end = data.indexOf("\x1b\\");
            if (end < 0) return;
            const packet = data.slice(3, end),
              header = packet.split(";", 1)[0];
            data = data.slice(end + 2);
            const fields = Object.fromEntries(header.split(",").map(field => field.split("=")));
            const id = Number(fields.i);
            if (fields.a === "q") {
              terminal.write("\x1b[6;22;10t\x1b_Gi=730201;OK\x1b\\");
            } else if (fields.a === "t") {
              sending = id;
            } else if (fields.a === "d" && fields.d === "I") {
              stored.delete(id);
            } else if (fields.a === "d" && fields.d === "R") {
              for (const one of stored) if (one >= Number(fields.x) && one <= Number(fields.y)) stored.delete(one);
            } else if (fields.a === "p") {
              placements.set(id, (placements.get(id) ?? 0) + 1);
              if (!stored.has(id)) {
                missing++;
                terminal.write(`\x1b_Gi=${id},p=${fields.p};ENOENT: image not found\x1b\\`);
              }
            }
            if (sending !== null && fields.m === "0") {
              stored.add(sending);
              uploads.set(sending, (uploads.get(sending) ?? 0) + 1);
              terminal.write(`\x1b_Gi=${sending};OK\x1b\\`);
              sending = null;
            }
            continue;
          }
          if (data[0] !== "\x1b") {
            data = data.slice(1);
            continue;
          }
          if ("\x1b_G".startsWith(data)) return;
          const seq = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(data);
          if (!seq) return;
          if (seq[0] === "\x1b[2J" || seq[0] === "\x1b[3J") stored.clear();
          data = data.slice(seq[0].length);
        }
      },
    },
  });
  const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 4000;
    while (!condition()) {
      if (Date.now() > deadline) throw Error("Moonlander did not place its face and hull");
      await Bun.sleep(20);
    }
  };
  const isHull = (id: number) => id >= hullFirst && id <= hullLast;
  try {
    await waitFor(() => placed(id => id === face) >= 5 && placed(isHull) > 0);
    const before = placed(id => id === face);
    child.terminal!.resize(80, 24);
    await Bun.sleep(100);
    child.terminal!.write("r");
    await waitFor(() => placed(id => id === face) > before);
    expect(uploads.get(face)).toBe(1);
    // Only the upright tile and the tilts either side so far, each sent once.
    expect([...uploads].filter(([id]) => isHull(id)).sort()).toEqual([
      [hullFirst + 12, 1],
      [hullFirst + 13, 1],
      [hullFirst + 14, 1],
    ]);
    expect(missing).toBe(0);
    expect(stored.has(face)).toBe(true);
    child.terminal!.write("q");
    expect(await child.exited).toBe(0);
  } finally {
    child.kill();
    child.terminal?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 10000);

test("the built-in game uploads embedded glyphs without a font renderer and waits for its acknowledgement", async () => {
  const { State } = await import("./moonlander_terminal");
  const state = new State(100, 30, () => {}, undefined, { hull: "turned" });
  // The passenger waits for its image rather than show text that then moves.
  const first = state.frame(100, 30, { width: 10, height: 22 }, true, 0);
  expect(first).not.toContain("ᐯ◡ᴥ◡ᐯ");
  let writes: string[] = [];
  for (let i = 0; i < 100 && writes.length === 0; i++) {
    await Bun.sleep(10);
    writes = state.takeWrites();
  }
  expect(writes.join("")).toContain("a=t,t=d,f=100");
  expect(state.frame(100, 30, { width: 10, height: 22 }, true, 10)).not.toContain("a=p,i=730202");
  state.reply("\x1b_Gi=730202;OK\x1b\\", 100, 30);
  expect(state.frame(100, 30, { width: 10, height: 22 }, true, 20)).toContain("a=p,i=730202");
  state.reply("\x1b_Gi=730202,p=1;ENOENT: image not found\x1b\\", 100, 30);
  expect(state.frame(100, 30, { width: 10, height: 22 }, true, 30)).toContain("ᐯ◡ᴥ◡ᐯ");
  expect(state.close()).toContain("a=d,d=I,i=730202");
});
