import { test, expect } from "bun:test";
import { State } from "./link_tooltip";
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
