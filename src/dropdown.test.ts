import { expect, test } from "bun:test";
import { viewport } from "./dropdown";

const choices = [
  { depth: 0 },
  { heading: true, depth: 0 },
  { heading: true, depth: 1 },
  { depth: 2 },
  { depth: 2 },
  { depth: 2 },
  { heading: true, depth: 1 },
  { depth: 2 },
  { depth: 2 },
  { heading: true, depth: 0 },
  { heading: true, depth: 1 },
  { depth: 2 },
  { depth: 1 },
  { heading: true, depth: 0 },
  { depth: 1 },
];

test("scrolling pins both agent and provider account above their models", () => {
  expect(viewport(choices, 4, 5, 4)).toEqual({ first: 4, indices: [1, 2, 4, 5] });
  expect(viewport(choices, 7, 8, 4)).toEqual({ first: 7, indices: [1, 6, 7, 8] });
});

test("sticky headers change at section boundaries without repeating old parents", () => {
  expect(viewport(choices, 6, 7, 4).indices).toEqual([1, 6, 7, 8]);
  expect(viewport(choices, 9, 11, 4).indices).toEqual([9, 10, 11, 12]);
  expect(viewport(choices, 12, 12, 4).indices).toEqual([9, 12, 13, 14]);
});

test("pinned headings reserve room without hiding the keyboard selection", () => {
  expect(viewport(choices, 0, 8, 4)).toEqual({ first: 6, indices: [1, 6, 7, 8] });
  expect(viewport(choices, 11, 0, 4)).toEqual({ first: 0, indices: [0, 1, 2, 3] });
  expect(viewport(choices, 4, 5, 1).indices).toEqual([5]);
  expect(viewport(choices, 4, 5, 2).indices).toEqual([2, 5]);
});

test("short and empty lists fill the window without duplicate headings", () => {
  expect(viewport(choices, 13, 14, 20)).toEqual({ first: 0, indices: choices.map((_, i) => i) });
  expect(viewport([], 0, 0, 4)).toEqual({ first: 0, indices: [] });
  expect(viewport(choices, 0, 0, 0)).toEqual({ first: 0, indices: [] });
});

test("the automatic model stays pinned with its container while browsing a different provider", () => {
  const pinned = choices.map((choice, i) => ({ ...choice, pin: i === 3 }));
  expect(viewport(pinned, 0, 8, 5).indices).toEqual([1, 2, 3, 6, 8]);
  expect(viewport(pinned, 8, 3, 5).indices.filter(i => i === 3)).toHaveLength(1);
  expect(viewport(pinned, 11, 11, 5).indices).not.toContain(3);
});
