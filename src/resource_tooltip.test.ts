import { test, expect } from "bun:test";
import { geometry, aimed, draw, State } from "./resource_tooltip";
import { Rect } from "./layout";
import { Writer } from "./text";
import { Terminal } from "./pane/terminal";
test("resource card stays within terminal bounds", () => {
  for (const cols of [68, 88, 120, 200])
    for (const rows of [24, 30, 40]) {
      const r = geometry(cols, rows, 28, rows - 1)!;
      expect(r.x + r.w).toBeLessThan(cols);
      expect(r.y + r.h).toBeLessThan(rows);
    }
});
test("aim triangle spans from the row exit to the card's left edge", () => {
  const card = new Rect(28, 4, 82, 24),
    exit = { x: 4, y: 4 };
  for (const [x, y] of [
    [8, 7],
    [14, 10],
    [20, 13],
    [27, 26],
  ])
    expect(aimed(card, exit, x, y)).toBe(true);
  expect(aimed(card, exit, 4, 5)).toBe(true);
  for (const [x, y] of [
    [4, 6],
    [3, 5],
    [20, 3],
    [27, 28],
    [28, 10],
  ])
    expect(aimed(card, exit, x, y)).toBe(false);
  const lifted = new Rect(28, 10, 82, 24);
  expect(aimed(lifted, { x: 4, y: 30 }, 16, 24)).toBe(true);
  expect(aimed(lifted, { x: 4, y: 30 }, 16, 36)).toBe(false);
  expect(aimed(new Rect(2, 4, 82, 24), exit, 3, 5)).toBe(false);
});
test("process rows freeze by identity while their numbers can refresh", () => {
  const state = new State(),
    processes = [
      { pid: 1, start: 10n, name: "first", cpu: 90 },
      { pid: 2, start: 20n, name: "second", cpu: 10 },
    ],
    work = { id: 1, known: true, processes };
  state.update(work, true);
  processes[0].cpu = 0;
  processes[1].cpu = 100;
  state.update(work, true);
  expect(state.order[0].pid).toBe(1);
  state.update(work, false);
  expect(state.order[0].pid).toBe(2);
});
test("a second click on the sorted heading turns the order around, unsampled processes last", () => {
  const state = new State({ workspace: 1 }),
    rect = new Rect(28, 4, 82, 24),
    processes = [
      { pid: 1, start: 10n, name: "busy", cpu: 90 },
      { pid: 2, start: 20n, name: "unsampled", cpu: null },
      { pid: 3, start: 30n, name: "quiet", cpu: 10 },
    ],
    work = { id: 1, known: true, processes },
    heading = () => {
      const w = new Writer(),
        terminal = new Terminal(120, 30);
      try {
        draw(w, rect, "repo", { workspaces: [work] }, state);
        terminal.feed(w.buffered());
        return terminal.text().split("\n")[rect.y + 14];
      } finally {
        terminal.destroy();
      }
    };
  state.update(work, false);
  expect(state.order.map(p => p.pid)).toEqual([1, 3, 2]);
  expect(heading()).toMatch(/↓CPU % +GiB +R MB\/s +W MB\/s/);
  state.click(rect, rect.x + rect.w - 28, rect.y + 14);
  state.update(work, false);
  expect(state.order.map(p => p.pid)).toEqual([3, 1, 2]);
  expect(heading()).toContain("↑CPU %");
  // Another heading starts from the most again; both disk columns are marked.
  state.click(rect, rect.x + rect.w - 5, rect.y + 14);
  expect(state.ascending).toBe(false);
  expect(heading()).toMatch(/↓R MB\/s ↓W MB\/s/);
});
