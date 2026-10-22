import { test, expect, setSystemTime } from "bun:test";
import { State, geometry, copyAt, draw, filePath } from "./link_tooltip";
import { Controller } from "./controller";
import { transport } from "./fixtures/transport";
import * as viewer from "./viewer";
import * as native from "./native_ffi";
import { Writer } from "./text";
import { png_base64 } from "./assets/corgi_badge";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("the resource card opens and wakes the viewer after 150 ms", () => {
  const s = new State(),
    target = { resource: 1 };
  s.move();
  expect(s.ready(target, 100)).toBe(false);
  expect(s.due(249)).toBe(false);
  expect(s.ready(target, 249)).toBe(false);
  expect(s.due(250)).toBe(true);
  expect(s.ready(target, 250)).toBe(true);
  expect(s.due(251)).toBe(false);
  expect(s.ready({ resource: 2 }, 251)).toBe(false);
  expect(s.due(400)).toBe(false);
  expect(s.ready({ resource: 2 }, 401)).toBe(true);
});
test("tooltip waits for rest and requires fresh movement after interaction", () => {
  const s = new State(),
    target = { git: 1 };
  expect(s.ready(target, 0)).toBe(false);
  s.move();
  expect(s.ready(target, 100)).toBe(false);
  expect(s.ready(target, 599)).toBe(false);
  expect(s.ready(target, 600)).toBe(true);
  s.cancel();
  expect(s.ready(target, 2000)).toBe(false);
  s.move();
  expect(s.ready(target, 2001)).toBe(false);
  expect(s.ready(target, 2501)).toBe(true);
  expect(s.ready({ git: 2 }, 2502)).toBe(false);
  expect(s.ready(null, 4000)).toBe(false);
  expect(s.ready(target, 4001)).toBe(false);
});

test("link hover wakes at 150 ms and changing the URL restarts the delay", () => {
  const s = new State();
  const link = { pane: 1, id: 1n, uri: "https://example.com", x: 5, y: 2 };
  s.move();
  expect(s.ready({ link }, 100)).toBe(false);
  expect(s.due(249)).toBe(false);
  expect(s.ready({ link }, 249)).toBe(false);
  expect(s.due(250)).toBe(true);
  expect(s.ready({ link }, 250)).toBe(true);
  const changed = { link: { ...link, uri: "https://other.example.com" } };
  expect(s.ready(changed, 251)).toBe(false);
  expect(s.due(400)).toBe(false);
  expect(s.ready(changed, 401)).toBe(true);
});

test("the link popover fits at screen edges and only its middle row copies", () => {
  const below = geometry(100, 30, { x: 40, y: 5 })!;
  expect(below).toMatchObject({ x: 40, y: 6, w: 17, h: 3 });
  const edge = geometry(100, 30, { x: 99, y: 29 })!;
  expect(edge).toMatchObject({ x: 83, y: 26, w: 17, h: 3 });
  expect(geometry(16, 30, { x: 0, y: 0 })).toBeNull();
  expect(geometry(100, 3, { x: 0, y: 0 })).toBeNull();
  expect(copyAt(below, 42, 7)).toBe(true);
  expect(copyAt(below, 40, 7)).toBe(false);
  expect(copyAt(below, 42, 6)).toBe(false);
});

test("both link popover labels keep the right border aligned and stay inside the box", () => {
  const terminal = native.terminal();
  terminal.resize(40, 10);
  try {
    for (const x of [2, 39]) {
      const rect = geometry(40, 10, { x, y: 5 })!;
      for (const [uri, label] of [
        ["https://example.com", "⧉  Copy link"],
        ["file:///tmp/shot.png", "⧉  Copy path"],
        ["https://example.com", "✓  Copied"],
      ]) {
        const w = new Writer();
        for (let y = 0; y < 10; y++) w.write(`\x1b[${y + 1};1H` + "#".repeat(40));
        const link = { pane: 1, id: 1n, uri, x, y: 5 };
        draw(w, rect, { link, copied: label.includes("Copied"), thumbnail: null }, true);
        terminal.feed(w.buffered());
        const rows = terminal.text().split("\n");
        expect(rows[rect.y][rect.x + rect.w - 1]).toBe("┐");
        expect(rows[rect.y + 1][rect.x + rect.w - 1]).toBe("│");
        expect(rows[rect.y + 2][rect.x + rect.w - 1]).toBe("┘");
        expect(rows[rect.y + 1]).toContain(label);
        if (rect.x + rect.w < 40) expect(rows[rect.y + 1][rect.x + rect.w]).toBe("#");
        expect(rows[rect.y + 3]).toBe("#".repeat(40));
      }
    }
  } finally {
    terminal.close();
  }
});

const url = "https://example.com/docs";
function linkViewer(output = url) {
  const s = new Controller({
    socket: "",
    request: transport(async () => {
      throw Error("UnexpectedRequest");
    }).request,
  });
  s.width = 100;
  s.height = 30;
  s.sidebar_open = false;
  s.input_state.attached = true;
  s.receiveSnapshot({
    workspaces: [
      {
        id: 1,
        name: "test",
        cwd: "/tmp",
        model: { nodes: [{ pane: 1 }], tabs: [{ id: 1, root: 0, title: "" }], revision: 0 },
      },
    ],
    panes: [
      {
        id: 1,
        workspace: 1,
        tab: 1,
        cols: 100,
        rows: 29,
        agent: { provider: null, attention: "none", observation: { completed: 0, read: 0 } },
      },
    ],
    conversations: [],
    headless_sessions: [],
  });
  s.runtime.pane(1)!.terminal.inner.feed(output);
  s.frame();
  return s;
}
const mouse = (button: number, x: number, y: number, release = false) =>
  Buffer.from(`\x1b[<${button};${x + 1};${y + 1}${release ? "m" : "M"}`);

test.each([
  url,
  `\x1b]8;;${url}\x1b\\Named docs\x1b]8;;\x1b\\`,
  `\x1b]8;;${url}\x1b\\\x1b[1;4;38;5;33mfoo\x1b[0m\x1b]8;;\x1b\\`,
])("link popover waits, stays reachable, copies the URL, and confirms inline: %s", async output => {
  const s = linkViewer(output);
  try {
    setSystemTime(new Date(1000));
    await s.input(mouse(35, 2, 1));
    expect(s.frame()).not.toContain("Copy link");
    setSystemTime(new Date(1149));
    expect(s.frame()).not.toContain("Copy link");
    s.dirty = false;
    setSystemTime(new Date(1150));
    await s.expireInput();
    expect(s.dirty).toBe(true);
    expect(s.frame()).toContain("Copy link");
    await s.input(mouse(35, 2, 2)); // Cross the top border.
    expect(s.frame()).toContain("Copy link");
    await s.input(mouse(35, 4, 3));
    expect(s.frame()).toContain("\x1b]22;pointer\x1b\\");
    await s.input(mouse(0, 4, 3));
    expect(s.clipboard).toBeNull();
    await s.input(mouse(0, 4, 3, true));
    expect(s.clipboard).toBe(url);
    expect(s.effects).toEqual([{ write_terminal: `\x1b]52;c;${Buffer.from(url).toString("base64")}\x07` }]);
    expect(s.frame()).toContain("✓  Copied");
    expect(s.frame()).not.toContain("Copied to clipboard");
    setSystemTime(new Date(2150));
    await s.expireInput();
    expect(s.frame()).toContain("Copy link");
    await s.input(mouse(35, 90, 20));
    expect(s.frame()).not.toContain("Copy link");
  } finally {
    setSystemTime();
    viewer.close(s);
  }
});

test("link popover dismisses on typing, scrolling, selection, or changing terminal content", async () => {
  const s = linkViewer();
  let now = 1000;
  const show = async () => {
    now += 1000;
    setSystemTime(new Date(now));
    await s.input(mouse(35, 3, 1));
    s.frame();
    setSystemTime(new Date(now + 150));
    expect(s.frame()).toContain("Copy link");
  };
  try {
    for (const input of [Buffer.from("a"), mouse(64, 3, 1), mouse(0, 3, 1)]) {
      await show();
      await s.input(input);
      expect(s.frame()).not.toContain("Copy link");
      setSystemTime(new Date(now + 1000));
      expect(s.frame()).not.toContain("Copy link");
      await s.input(mouse(0, 4, 1, true));
      await s.input(mouse(35, 90, 20));
    }
    await show();
    await s.input(mouse(35, 4, 3));
    const terminal = s.runtime.pane(1)!.terminal;
    terminal.inner.feed("\r\x1b[2Kgone");
    terminal.render_dirty = true;
    expect(s.frame()).not.toContain("Copy link");
    await s.input(mouse(0, 4, 3));
    await s.input(mouse(0, 4, 3, true));
    expect(s.clipboard).toBeNull();
  } finally {
    setSystemTime();
    viewer.close(s);
  }
});

test("popover clicks and cancelled drags do not reach mouse-aware programs", async () => {
  const s = linkViewer("\x1b[?1003h\x1b[?1006h" + url);
  try {
    setSystemTime(new Date(1000));
    await s.input(mouse(35, 2, 1));
    s.frame();
    setSystemTime(new Date(1150));
    expect(s.frame()).toContain("Copy link");
    const terminal = s.runtime.pane(1)!.terminal;
    terminal.pending = [];
    await s.input(mouse(35, 4, 3));
    await s.input(mouse(0, 4, 3));
    await s.input(mouse(32, 90, 20));
    s.frame();
    await s.input(mouse(0, 90, 20, true));
    expect(s.clipboard).toBeNull();
    expect(terminal.pending).toEqual([]);
  } finally {
    setSystemTime();
    viewer.close(s);
  }
});

test("file links copy their path", () => {
  expect(filePath("file:///tmp/corgi-501/paste/a%20shot.png")).toBe("/tmp/corgi-501/paste/a shot.png");
  expect(filePath("FILE://localhost/Users/me/notes.md")).toBe("/Users/me/notes.md");
  expect(filePath("file://other-host/srv/log.txt")).toBe("/srv/log.txt");
  expect(filePath("https://example.com/a.png")).toBeNull();
});

test("a thumbnail grows the popover under its copy row and needs room on one side", () => {
  const cell = { width: 10, height: 20 },
    thumbnail = { width: 235, height: 90, cell };
  const below = geometry(100, 30, { x: 40, y: 5 }, thumbnail)!;
  expect(below).toMatchObject({ x: 40, y: 6, w: 26, h: 9 });
  expect(copyAt(below, 42, 7)).toBe(true);
  expect(copyAt(below, 42, 9)).toBe(false);
  expect(geometry(100, 30, { x: 40, y: 25 }, thumbnail)).toMatchObject({ y: 16, h: 9 });
  expect(geometry(100, 12, { x: 40, y: 6 }, thumbnail)).toBeNull();
  expect(geometry(100, 12, { x: 40, y: 6 })).not.toBeNull();
  expect(geometry(100, 30, { x: 40, y: 5 }, { width: 30, height: 20, cell })).toMatchObject({ w: 17, h: 5 });
});

test("a file link's popover offers and copies its path", async () => {
  const s = linkViewer("\x1b]8;;file:///tmp/corgi%20shot.png\x1b\\[Image #1]\x1b]8;;\x1b\\");
  try {
    setSystemTime(new Date(1000));
    await s.input(mouse(35, 2, 1));
    s.frame();
    setSystemTime(new Date(1150));
    expect(s.frame()).toContain("Copy path");
    await s.input(mouse(0, 4, 3));
    await s.input(mouse(0, 4, 3, true));
    expect(s.clipboard).toBe("/tmp/corgi shot.png");
    expect(s.effects).toEqual([
      { write_terminal: `\x1b]52;c;${Buffer.from("/tmp/corgi shot.png").toString("base64")}\x07` },
    ]);
  } finally {
    setSystemTime();
    viewer.close(s);
  }
});

test("an image link's popover shows a thumbnail on Kitty hosts and frees it when it closes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "corgi-thumb-"));
  const path = join(dir, "shot.png");
  writeFileSync(path, await new Bun.Image(Buffer.from(png_base64, "base64")).resize(1000, 400).png().buffer());
  const s = linkViewer(`\x1b]8;;file://${path}\x1b\\[Image #1]\x1b]8;;\x1b\\`);
  s.supports_kitty_graphics = true;
  s.cell_pixels = { width: 10, height: 20 };
  try {
    setSystemTime(new Date(1000));
    await s.input(mouse(35, 2, 1));
    s.frame();
    await s.thumbnails.loading;
    expect(s.dirty).toBe(true);
    setSystemTime(new Date(1150));
    const frame = s.frame();
    expect(frame).toContain("Copy path");
    expect(frame).toContain("├" + "─".repeat(28) + "┤");
    // 1000×400 shrinks to 280×112: 28 cells by 6, centered in the rows.
    expect(frame).toContain("\x1b[6;4H\x1b_Ga=p,i=730140,p=1,X=0,Y=4,z=1,C=1,q=2\x1b\\");
    const sent = s.effects.map(e => ("write_terminal" in e ? e.write_terminal : "")).join("");
    expect(sent.startsWith("\x1b_Ga=t,t=d,f=100,i=730140,q=2,m=")).toBe(true);
    s.clearEffects();
    s.frame();
    expect(s.effects).toEqual([]);
    await s.input(mouse(0, 4, 3));
    await s.input(mouse(0, 4, 3, true));
    expect(s.clipboard).toBe(path);
    await s.input(mouse(35, 90, 20));
    expect(s.frame()).not.toContain("a=p,i=730140");
    expect(s.effects.at(-1)).toEqual({ write_terminal: "\x1b_Ga=d,d=I,i=730140,q=2\x1b\\" });
  } finally {
    setSystemTime();
    viewer.close(s);
    rmSync(dir, { recursive: true, force: true });
  }
});
