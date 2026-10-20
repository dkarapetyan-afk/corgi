import type { Key as LogicalKey } from "./keyboard";
export const paste_start = "\x1b[200~",
  paste_end = "\x1b[201~";
const map: Record<string, string> = {
  "\u001b[A": "up",
  "\u001bOA": "up",
  "\u001b[B": "down",
  "\u001bOB": "down",
  "\u001b[C": "right",
  "\u001bOC": "right",
  "\u001b[D": "left",
  "\u001bOD": "left",
  "\u001b[5~": "page_up",
  "\u001b[6~": "page_down",
  "\u001b[H": "home",
  "\u001bOH": "home",
  "\u001b[1~": "home",
  "\u001b[F": "end",
  "\u001bOF": "end",
  "\u001b[4~": "end",
  "\u001b[3~": "delete",
  "\u001b[Z": "shift_tab",
  "\u001b[1;2A": "shift_up",
  "\u001b[1;2B": "shift_down",
  "\u001b[1;2C": "shift_right",
  "\u001b[1;2D": "shift_left",
  "\u001b[1;2H": "shift_home",
  "\u001b[1;2F": "shift_end",
  "\u001b[1;3C": "alt_right",
  "\u001b[1;3D": "alt_left",
  "\u001b[1;4C": "shift_alt_right",
  "\u001b[1;4D": "shift_alt_left",
  "\u001b[1;5C": "ctrl_right",
  "\u001b[1;5D": "ctrl_left",
  "\u001b[1;6C": "shift_ctrl_right",
  "\u001b[1;6D": "shift_ctrl_left",
  "\u001b[1;9C": "super_right",
  "\u001b[1;9D": "super_left",
  "\u001b[1;10C": "shift_super_right",
  "\u001b[1;10D": "shift_super_left",
  "\u001b[3;3~": "alt_delete",
  "\u001b[3;5~": "ctrl_delete",
  "\u001b\u007f": "alt_backspace",
  "\u001b\r": "alt_enter",
  "\u001bb": "alt_b",
  "\u001bd": "alt_d",
  "\u001bf": "alt_f",
  // Cmd's select all, copy and cut, as Ghostty passes them on when it has no selection of its own.
  "\u001b[97;9u": "super_a",
  "\u001b[99;9u": "super_c",
  "\u001b[120;9u": "super_x",
  "\u001b[I": "focus_in",
  "\u001b[O": "focus_out",
  "\u001b[200~": "paste_start",
  "\u001b[201~": "paste_end",
};
export type Key =
  | "alt_b"
  | "alt_backspace"
  | "alt_d"
  | "alt_delete"
  | "alt_enter"
  | "alt_f"
  | "alt_left"
  | "alt_right"
  | "ctrl_delete"
  | "ctrl_left"
  | "ctrl_right"
  | "delete"
  | "down"
  | "end"
  | "focus_in"
  | "focus_out"
  | "home"
  | "left"
  | "page_down"
  | "page_up"
  | "paste_end"
  | "paste_start"
  | "right"
  | "shift_alt_left"
  | "shift_alt_right"
  | "shift_ctrl_left"
  | "shift_ctrl_right"
  | "shift_down"
  | "shift_end"
  | "shift_home"
  | "shift_left"
  | "shift_right"
  | "shift_super_left"
  | "shift_super_right"
  | "shift_tab"
  | "shift_up"
  | "super_a"
  | "super_c"
  | "super_left"
  | "super_right"
  | "super_x"
  | "up";
export function parse(seq: string): Key | null {
  return (map[seq] as Key) ?? null;
}
/** Whether input for a pane is a mouse report, in any encoding a pane can ask for. */
export function mouseReport(seq: string) {
  return /^\x1b\[(?:<|M|\d+;\d+;\d+M)/.test(seq);
}
const named: Record<string, number> = {
  esc: 27,
  enter: 13,
  tab: 9,
  backspace: 127,
  left: 57350,
  right: 57351,
  up: 57352,
  down: 57353,
  home: 57356,
  end: 57357,
  delete: 57349,
  pageup: 57354,
  pagedown: 57355,
  space: 32,
};
export function logicalKey(name: string): LogicalKey {
  const parts = name.split("+");
  const key = parts.pop()!;
  const mods: Record<string, boolean> = {};
  for (const mod of parts) {
    if (!["ctrl", "alt", "shift"].includes(mod)) throw new Error("InvalidKey");
    mods[mod] = true;
  }
  const codepoint =
    named[key] ?? (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) < 127 ? key.charCodeAt(0) : null);
  if (codepoint === null) throw new Error("InvalidKey");
  return { codepoint, mods };
}
