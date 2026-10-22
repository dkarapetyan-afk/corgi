import { expect, test } from "bun:test";
import * as signinExit from "./signin_exit";
import * as palette from "./palette";
import { Terminal } from "./pane/terminal";
import { Grid } from "./cell_grid";
import { Writer } from "./text";

function source(width = 80, height = 24): Grid {
  const grid = new Grid(width, height, palette.colors.text);
  grid.text(2, 0, "Add account · Claude Code", palette.colors.strong);
  grid.text(4, 5, "Signed in as me@example.com", palette.colors.accent);
  grid.text(4, 6, "日本語 e\u0301", palette.colors.text);
  return grid;
}
function draw(state: signinExit.State | null, width = 80, height = 24, label = "Claude Code · work"): string {
  const w = new Writer();
  signinExit.draw(w, label, width, height, state);
  return w.buffered();
}

test("captures normalized native cells with colors, wide glyphs and combining marks, without links", () => {
  const terminal = new Terminal(40, 5);
  try {
    terminal.feed(
      new palette.Style({ fg: "accent", bg: "surface", bold: true }).sgr() +
        "\x1b]8;;https://example.com\x1b\\日本語 e\u0301\x1b]8;;\x1b\\",
    );
    const snapshot = signinExit.capture(terminal.surface(0).surface);
    expect(snapshot.at(0, 0)).toEqual({ ch: "日", fg: palette.colors.accent, bg: palette.colors.surface, bold: true });
    expect(snapshot.at(1, 0)?.ch).toBe("");
    expect(snapshot.at(7, 0)?.ch).toBe("e\u0301");
    const w = new Writer();
    snapshot.write(w, 0, 0, palette.bg("bg"));
    expect(w.buffered()).not.toContain("https:");
    expect(w.buffered()).not.toContain("\x1b]8;");
  } finally {
    terminal.destroy();
  }
});

test("pull starts at the captured screen and ends at the ordinary confirmation", () => {
  const exit = new signinExit.State(source(), 1000),
    terminal = new Terminal(80, 24);
  try {
    terminal.feed(draw(exit));
    expect(terminal.text()).toContain("Signed in as me@example.com");
    expect(terminal.text()).not.toContain("✓ Added");
    exit.tick(1000 + signinExit.duration_ms);
    expect(exit.done).toBe(true);
    expect(draw(exit)).toBe(draw(null));
    terminal.feed("\x1b[2J" + draw(exit));
    expect(terminal.text()).toContain("✓ Added Claude Code · work");
  } finally {
    terminal.destroy();
  }
});

test("rendering frequency cannot advance or change the transition", () => {
  const frequent = new signinExit.State(source(), 1000),
    skipped = new signinExit.State(source(), 1000);
  for (let now = 1000; now < 1530; now += 10) {
    frequent.tick(now);
    draw(frequent);
    draw(frequent);
  }
  frequent.tick(1530);
  skipped.tick(1530);
  expect(draw(frequent)).toBe(draw(skipped));
  const elapsed = frequent.elapsed;
  expect(draw(frequent)).toBe(draw(frequent));
  expect(frequent.elapsed).toBe(elapsed);
  expect(frequent.tick(1531)).toBe(false);
});

test("all pull frames stay on screen, and a resize falls back to the full confirmation", () => {
  for (const [width, height] of [
    [30, 10],
    [80, 24],
    [160, 40],
  ]) {
    const exit = new signinExit.State(source(width, height), 0);
    for (let now = 0; now <= 900; now += 10) {
      exit.tick(now);
      const output = draw(exit, width, height, "日本語 · " + "long".repeat(40));
      for (const match of output.matchAll(/\x1b\[(\d+);(\d+)H/g)) {
        expect(Number(match[1])).toBeGreaterThan(0);
        expect(Number(match[1])).toBeLessThanOrEqual(height);
        expect(Number(match[2])).toBeGreaterThan(0);
        expect(Number(match[2])).toBeLessThanOrEqual(width);
      }
    }
    exit.tick(400);
    expect(draw(exit, width + 1, height)).toBe(draw(null, width + 1, height));
  }
  expect(draw(new signinExit.State(source(), 0), 10, 3)).toBe("");
});
