/**
 * The pane images sandbox: a pane showing a striped picture with the Kitty
 * graphics protocol, beside an agent, to open Corgi's cards over it. Needs a
 * terminal with Kitty graphics that reports its cell size (Ghostty, Kitty).
 *
 * - picture: links above and below the picture; Enter draws it again.
 * - agent: a fake agent, whose card in the sidebar opens over the picture.
 */
import { join } from "node:path";
import { table, type Sandbox, type World } from "../sandbox";

/** A `cols` by `rows` cell picture: a gradient crossed by diagonal stripes,
 * which break visibly where pieces of it don't line up. */
function picture(cols: number, rows: number): string {
  const width = cols * 8,
    height = rows * 16,
    pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3,
        stripe = (x + y) % 24 < 4;
      pixels[at] = stripe ? 250 : Math.round(60 + (180 * x) / width);
      pixels[at + 1] = stripe ? 245 : Math.round(70 + (150 * y) / height);
      pixels[at + 2] = stripe ? 230 : 170;
    }
  const data = pixels.toString("base64");
  let out = "";
  for (let start = 0; start < data.length; start += 4096) {
    const more = Number(start + 4096 < data.length);
    out +=
      (start === 0
        ? `\x1b_Ga=T,f=24,s=${width},v=${height},c=${cols},r=${rows},C=1,q=2,m=${more};`
        : `\x1b_Gm=${more};`) +
      data.slice(start, start + 4096) +
      "\x1b\\";
  }
  return out;
}

export const world: World = {
  seed(s) {
    const rows = 12;
    s.write(
      join(s.dir, "picture.ans"),
      [
        "Hover a link: its card cuts a hole in the picture.",
        "",
        "    https://corgi.computer/over-the-picture",
        "  " + picture(44, rows) + "\n".repeat(rows - 1),
        "    https://corgi.computer/under-the-picture",
        "",
        "Enter draws the picture again.",
      ].join("\n"),
    );
  },

  /** The picture and an agent side by side, and a shell. */
  arrange(s) {
    const before: { id: number; model?: { tabs?: unknown[] } }[] = s.corgi(["workspace", "list"])?.workspaces ?? [];
    const made: { workspace: number; tab: number } = s.corgi(["workspace", "new", "images", "--cwd", s.dir]);
    s.corgi(["tab", "rename", String(made.tab), "shell"]);
    const shown: { pane: number } = s.corgi([
      "tab",
      "new",
      "--workspace",
      String(made.workspace),
      "--name",
      "picture",
      "--cwd",
      s.dir,
      "--command",
      "while :; do clear; cat picture.ans; read -r _; done",
    ]);
    s.corgi(["pane", "split", String(shown.pane), "--right", "--cwd", s.dir, "--command", "claude"]);
    // The daemon's own starting workspace stays empty; close it so only this one shows.
    for (const w of before)
      if (w.id !== made.workspace && (w.model?.tabs?.length ?? 0) === 0)
        s.corgi(["workspace", "close", String(w.id)], false);
  },

  intro(s) {
    return [
      'Tab "picture": a Kitty picture with links, beside an agent.',
      ...table([
        ["hover", "the link above the picture: the card cuts its own hole"],
        ["hover", "the agent's row in the sidebar: its card opens over the picture"],
        ["click", "Copy link: the toast and the card both stay clear"],
        [`${s.prefixName}`, "the prefix bar covers the bottom row only"],
        ["Enter", "in the picture pane: draw it again"],
      ]),
    ];
  },
};
