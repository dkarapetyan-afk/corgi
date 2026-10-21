import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  let data = "",
    atlasStored = false,
    uploadStarted = false,
    uploads = 0,
    placements = 0,
    missing = 0;
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
            if (fields.a === "q") {
              terminal.write("\x1b[6;22;10t\x1b_Gi=730201;OK\x1b\\");
            } else if (fields.a === "t") {
              uploadStarted = true;
            } else if (fields.a === "d" && fields.d === "I") {
              atlasStored = false;
            } else if (fields.a === "p") {
              placements++;
              if (!atlasStored) {
                missing++;
                terminal.write("\x1b_Gi=730202,p=1;ENOENT: image not found\x1b\\");
              }
            }
            if (uploadStarted && fields.m === "0") {
              uploadStarted = false;
              atlasStored = true;
              uploads++;
              terminal.write("\x1b_Gi=730202;OK\x1b\\");
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
          if (seq[0] === "\x1b[2J" || seq[0] === "\x1b[3J") atlasStored = false;
          data = data.slice(seq[0].length);
        }
      },
    },
  });
  const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 4000;
    while (!condition()) {
      if (Date.now() > deadline) throw Error("Moonlander did not place its face");
      await Bun.sleep(20);
    }
  };
  try {
    await waitFor(() => placements >= 5);
    const before = placements;
    child.terminal!.resize(80, 24);
    await Bun.sleep(100);
    child.terminal!.write("r");
    await waitFor(() => placements > before);
    expect(uploads).toBe(1);
    expect(missing).toBe(0);
    expect(atlasStored).toBe(true);
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
  const state = new State(100, 30);
  const first = state.frame(100, 30, { width: 10, height: 22 }, true, 0);
  expect(first).toContain("ᐯ◡ᴥ◡ᐯ");
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
