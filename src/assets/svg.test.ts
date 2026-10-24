import { test, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { parse } from "./svg";
import { brands } from "../process_name";

test("a mark is a view box and filled paths, one file per brand; anything else fails the build", () => {
  const mark = `<svg viewBox="-1 -1 4 4"><title>x</title><path id="a" fill="#00ff00" d="M0 0h2v2z"/>
    <path fill="currentColor" d="M1 1h1z"/></svg>`;
  expect(parse(mark, "x.svg")).toEqual({
    view: [-1, -1, 4, 4],
    layers: [
      ["00FF00", "M0 0h2v2z"],
      ["ink", "M1 1h1z"],
    ],
  });
  for (const bad of [
    `<svg viewBox="0 0 1 1"><circle r="1"/></svg>`,
    `<svg viewBox="0 0 1 1"><path fill="#000000" transform="scale(2)" d="M0 0z"/></svg>`,
    `<svg viewBox="0 0 1 1"><path fill="url(#g)" d="M0 0z"/></svg>`,
  ])
    expect(() => parse(bad, "x.svg")).toThrow("x.svg: unsupported");
  const files = readdirSync(new URL("../../assets/brand_icons", import.meta.url)).map(f => f.replace(/\.svg$/, ""));
  expect(files.sort()).toEqual([...brands].sort());
});
