//! Manage agents: the accounts agents start in and the saved commands, under
//! a search, then an Available to add section that restores accounts or signs in to
//! an agent or saves a command. It draws in a box its host gives it, takes
//! keys and clicks, and answers with an `Action` for the host to carry out;
//! what it lists comes from the host's `Model`. The launcher shows it in
//! its card; settings shows it beside its section list.
import * as palette from "./palette";
import { Style, keycap } from "./palette";
import { type Provider, adapter } from "./providers";
import { Rect } from "./layout";
import { Dialog, View as DialogView, writeField } from "./name_dialog";
import { Entry as CommandEntry, Semantics, Resolution } from "./launch/command";
import * as keys from "./keys";
import { Writer, displayWidth, writeEllipsis, ellipsis, sat, clamp } from "./text";
import { Grid } from "./cell_grid";
import { KeyHold } from "./key_hold";
import { milliTimestamp } from "./clock";
import * as worktreeRemoval from "./worktree_removal";
import * as launcherUsage from "./launcher_usage";
import * as agentForm from "./agent_form";
import type { Options } from "./agent_options";
import { Slide } from "./card_transition";

/** An account an agent starts in, as the list shows it. */
export type Agent = {
  provider: Provider;
  /** Its folder; "" for the default. */
  account: string;
  /** "" for the default, which goes by its agent's name. */
  name: string;
  /** Its row's name, such as `Claude Code · work`. */
  label: string;
  /** Who signed in, or why that's unknown. */
  who: string;
  signed_out: boolean;
  shown: boolean;
  /** It shows in the current workspace's launcher, once it's in the launcher. */
  here: boolean;
  /** Corgi made its folder. */
  managed: boolean;
  usage: launcherUsage.Cell;
};
/** What the host has to list. */
export type Model = {
  agents: Agent[];
  /** The saved commands' slots; an empty one lists nothing. */
  commands: CommandEntry[];
  /** The current workspace's name, which the Show column's toggles apply to. */
  workspace: string;
  /** Whether saved command `index` shows in the current workspace's launcher. */
  here(index: number): boolean;
  /** The agents a new account can be added for. */
  add: Provider[];
  /** The account a saved command's agent runs in, for its form. */
  account(info: Semantics): string;
  /** A name for an account, from who signed in to it. */
  suggest(agent: Agent): string;
  options(agent: Agent): Options;
};
/** What a key or click asks the host to do. */
export type Action =
  | { kind: "close" }
  | { kind: "back" }
  | { kind: "show"; agent: Agent }
  | { kind: "show_command"; index: number }
  | { kind: "here"; agent: Agent; shown: boolean }
  | { kind: "here_command"; index: number; shown: boolean }
  | { kind: "configure"; agent: Agent; name: string; options: Options }
  | { kind: "remove"; agent: Agent }
  | { kind: "remove_command"; index: number }
  | { kind: "add"; provider: Provider }
  | { kind: "save" };

type Item =
  | { kind: "agent"; agent: Agent }
  | { kind: "command"; index: number }
  | { kind: "add"; provider: Provider }
  | { kind: "custom" };
function itemKey(item: Item): string {
  switch (item.kind) {
    case "agent":
      return `agent:${item.agent.provider}:${item.agent.account}`;
    case "command":
      return `command:${item.index}`;
    case "add":
      return `add:${item.provider}`;
    case "custom":
      return "custom";
  }
}
/** The key of an agent's row, to open the list on it. */
export const agentKey = (provider: Provider, account: string) => `agent:${provider}:${account}`;
/** Whether each word of `query` shows in `text`, ignoring case. */
function matches(query: string, text: string): boolean {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every(word => hay.includes(word));
}
function cleanControls(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, " ");
}
type Hint = [key: string, label: string];
type Removal = {
  item: Item;
  label: string;
  detail: string;
  note: string;
  section: "have" | "add";
  index: number;
  phase: "held" | "removing" | "removed";
  committed_at: number;
};

/** A saved command's form: its command line and name, as Corgi resolves them. */
export class Form {
  editor = Object.assign(Dialog.init({ agent_command: 0 }, ""), { selected: false });
  name_editor = Object.assign(Dialog.init({ rename: 0 }, ""), { selected: false });
  name_focused = false;
  show_command = false;
  name_customized = false;
  /** The command it edits; null for a new one. */
  edit_index: number | null = null;
  save_error = "";
  draft = new CommandEntry();
  draft_changed = 0;
  request_id = 0;
  resolution_checked = 0;
  resolution = new Resolution();
  save_requested = false;

  /** Opens on command `index` of `commands`, or empty for a new one. */
  edit(index: number | null, commands: CommandEntry[]): void {
    this.draft = new CommandEntry();
    this.request_id = 0;
    this.resolution = new Resolution();
    this.save_requested = false;
    this.save_error = "";
    this.edit_index = index;
    const source = index !== null ? commands[index].inputText() : "";
    this.editor = Dialog.init({ agent_command: 0 }, source);
    this.name_focused = false;
    this.show_command = false;
    this.name_customized = index !== null;
    this.name_editor = Dialog.init({ rename: 0 }, index !== null ? commands[index].label() : "");
    if (index !== null) {
      try {
        this.draft.set(source);
      } catch {}
      const resolved = new Resolution();
      resolved.pending = false;
      resolved.command = commands[index];
      resolved.semantics = commands[index].semantics;
      this.resolution = resolved;
    }
  }
  input(): Dialog {
    return this.name_focused ? this.name_editor : this.editor;
  }
  /** Rows it takes: its fields, what Corgi resolved, and its buttons. */
  height(): number {
    return 18 + (this.show_command ? 2 : 0);
  }
  /** The row its fields start on, and its buttons'. */
  private static top = (b: Rect) => b.y + 2;
  private actions = (b: Rect) => Form.top(b) + 12 + (this.show_command ? 2 : 0);

  draw(w: Writer, b: Rect, model: Model): void {
    const at = (x: number, y: number) => `\x1b[${y + 1};${x + 1}H`,
      panel = new Style({ fg: "text", bg: "surface" }).sgr(),
      dim = palette.fg("faint"),
      top = Form.top(b),
      width = sat(b.w, 10);
    for (let i = 0; i < 2; i++) {
      const y = top + i * 4,
        focused = this.name_focused === (i === 1);
      w.write(at(b.x + 3, y) + dim + (i === 0 ? "Command" : "Name"));
      const border = focused ? palette.fg("accent") : palette.fg("line");
      for (let line = 0; line < 3; line++) {
        w.write(at(b.x + 3, y + line + 1) + border + (line === 0 ? "┌" : line === 2 ? "└" : "│"));
        if (line !== 1) w.write("─".repeat(width + 2));
        else w.splat(" ", width + 2);
        w.write(line === 0 ? "┐" : line === 2 ? "┘" : "│");
      }
      w.write(panel);
      field(
        w,
        i === 0 ? this.editor : this.name_editor,
        i === 0 ? "Paste a command…" : "Suggested automatically",
        b.x + 5,
        y + 2,
        width,
        focused,
      );
    }
    w.write(panel);
    if (this.editor.len > 0 || (this.editor.failed && this.save_error)) {
      const same = this.draft.text() === this.editor.name(),
        resolved =
          same && !this.editor.failed && !this.resolution.pending && this.resolution.error_message.length === 0,
        status =
          this.editor.failed && this.save_error.length > 0
            ? this.save_error
            : this.editor.overflow
              ? "Command too long"
              : !same || this.resolution.pending
                ? "Resolving command…"
                : this.resolution.error_message.length > 0
                  ? this.resolution.error_message
                  : model.account(this.resolution.semantics);
      const info = this.resolution.semantics,
        provider = info.provider ? adapter(info.provider).label : "Custom agent";
      w.write(at(b.x + 3, top + 9));
      writeEllipsis(w, resolved ? `${provider} · ${status}` : status, b.w - 8);
      w.write(at(b.x + 3, top + 10) + dim);
      if (resolved) {
        const mode = info.yolo ? info.mode : "";
        writeEllipsis(
          w,
          `${info.modelLabel()}${info.model.length > 0 && mode.length > 0 ? " · " : ""}${mode}`,
          b.w - 26,
        );
        w.write(at(b.x + b.w - 18, top + 10) + `[${this.show_command ? "Hide" : "Show"} command]`);
        if (this.show_command) {
          w.write(at(b.x + 3, top + 12) + "Runs: ");
          writeEllipsis(w, cleanControls(this.resolution.command.text()), b.w - 14);
        }
      }
    }
    w.write(panel + at(b.x + b.w - 20, this.actions(b)) + `[Cancel]  [${this.edit_index !== null ? "Save" : "Add"}]`);
  }
  /** Where the caret goes, 0-based. */
  caret(b: Rect): { x: number; y: number } {
    const editor = this.input(),
      width = sat(b.w, 10),
      offset = DialogView.scroll(editor, width),
      column = Math.min(sat(width, 1), displayWidth(editor.bytes(offset, editor.cursor)));
    return { x: b.x + 5 + column, y: Form.top(b) + 2 + (this.name_focused ? 4 : 0) };
  }
  /** A click at (`x`, `y`): a field takes the caret; its buttons save, cancel, or show what runs. */
  click(b: Rect, x: number, y: number): "save" | "cancel" | null {
    const top = Form.top(b),
      actions = this.actions(b);
    if (y === actions && x >= sat(b.x + b.w, 10)) return "save";
    if (y === actions && x >= sat(b.x + b.w, 20)) return "cancel";
    if (y === top + 10 && x >= sat(b.x + b.w, 18)) this.show_command = !this.show_command;
    else if (y === top + 2 || y === top + 6) {
      this.name_focused = y === top + 6;
      const width = sat(b.w, 10),
        editor = this.input(),
        offset = DialogView.scroll(editor, width);
      editor.position(editor.byteAtColumn(offset, sat(x, b.x + 5)));
    }
    return null;
  }
}
/** A field on `selected`: its text, its selection while focused, or the placeholder. */
function field(
  w: Writer,
  editor: Dialog,
  placeholder: string,
  x: number,
  y: number,
  width: number,
  focused: boolean,
  bg: palette.Token = "selected",
  hint: palette.Token = "text",
): void {
  const plain = new Style({ fg: "text", bg }).sgr();
  w.write(`\x1b[${y + 1};${x + 1}H` + plain);
  w.splat(" ", width);
  w.write(`\x1b[${y + 1};${x + 1}H`);
  if (editor.len === 0) {
    w.write(palette.fg(hint));
    writeEllipsis(w, placeholder, width);
  } else writeField(w, editor, DialogView.scroll(editor, width), width, plain, { selecting: focused });
  w.write(new Style({ fg: "text", bg: "surface" }).sgr());
}

/** The list and its agent and saved-command editors. */
export class View {
  page: "list" | "command" | "agent" = "list";
  agent_form = new agentForm.Form();
  transition = new Slide();
  back_label = "New tab";
  private first = 0;
  focus: "search" | "list" = "search";
  query = Dialog.init({ rename: 0 }, "");
  /** The selected row's key. */
  at = "";
  /** The row being buried, kept until the corgi has left. */
  removal: Removal | null = null;
  private hold = new KeyHold(worktreeRemoval.hold_ms, worktreeRemoval.heal_ms);
  /** What went wrong with the last action, in place of the keys. */
  error = "";
  form = new Form();

  /** Opens on the list, at the row `at` names. */
  open(at = ""): void {
    this.page = "list";
    this.first = 0;
    this.focus = "search";
    this.query = Dialog.init({ rename: 0 }, "");
    this.at = at;
    this.transition = new Slide();
    this.removal = null;
    this.hold = new KeyHold(worktreeRemoval.hold_ms, worktreeRemoval.heal_ms);
    this.error = "";
  }
  /** The rows the search leaves: what there is, then what can be added. */
  items(model: Model): { have: Item[]; add: Item[] } {
    const q = this.query.name();
    const found: Item[] = [
      ...model.agents.filter(a => matches(q, `${a.label} ${a.who}`)).map(agent => ({ kind: "agent" as const, agent })),
      ...model.commands.flatMap((c, index): Item[] =>
        c.command.length > 0 && matches(q, `${c.label()} ${c.text()}`) ? [{ kind: "command", index }] : [],
      ),
    ];
    const have = found.filter(item => this.inLauncher(item, model)),
      available = found.filter(item => !this.inLauncher(item, model)),
      r = this.removal;
    if (r && r.phase !== "held" && matches(q, `${r.label} ${r.detail}`)) {
      // Keep the burial in its original section until the corgi leaves.
      for (const items of [have, available]) {
        const index = items.findIndex(item => itemKey(item) === itemKey(r.item));
        if (index >= 0) items.splice(index, 1);
      }
      const items = r.section === "have" ? have : available;
      items.splice(Math.min(r.index, items.length), 0, r.item);
    }
    const add: Item[] = [
      ...available,
      ...model.add
        .filter(p => matches(q, `add new account ${adapter(p).label}`))
        .map(provider => ({ kind: "add" as const, provider })),
      ...(matches(q, "add custom command") ? [{ kind: "custom" as const }] : []),
    ];
    return { have, add };
  }
  private all(model: Model): Item[] {
    const { have, add } = this.items(model);
    return [...have, ...add];
  }
  /** The selected row: the one `at` names, else the first. */
  selected(model: Model): Item | null {
    const all = this.all(model);
    return all.find(i => itemKey(i) === this.at) ?? all[0] ?? null;
  }
  height(model: Model): number {
    if (this.page === "command") return this.form.height();
    if (this.page === "agent") return this.agent_form.height();
    const { have, add } = this.items(model);
    return 9 + Math.max(1, have.length) + (add.length > 0 ? 2 + add.length : 0);
  }
  minimumHeight(): number {
    return this.page === "command" ? this.form.height() : this.page === "agent" ? 20 : 10;
  }
  /** The field that has the keyboard, which takes pastes. */
  input(): Dialog {
    if (this.page === "command") return this.form.input();
    return this.page === "agent" ? this.agent_form.input() : this.query;
  }
  typing(): boolean {
    return this.page === "agent" ? this.agent_form.typing() : this.page === "command" || this.focus === "search";
  }
  paste(byte: number, model: Model): void {
    if (!this.typing()) return;
    if (this.page === "command" && this.form.name_focused) this.form.name_customized = true;
    this.input().pasteByte(byte);
    if (this.page === "list") this.searched(model);
  }
  /** An action didn't take: retain its draft and show why. */
  fail(message: string): void {
    if (this.page === "agent") this.agent_form.error = message;
    else this.error = message;
  }
  configured(now = milliTimestamp()): void {
    this.cancelAgent(now);
    this.error = "";
  }
  /** Back on the list once a command saved, on its row. */
  saved(index: number): void {
    this.page = "list";
    this.focus = "list";
    this.at = itemKey({ kind: "command", index });
  }
  /** Opens a command's form: `index`'s, or a new one's. */
  command(index: number | null, model: Model): void {
    this.page = "command";
    this.form.edit(index, model.commands);
  }

  private move(model: Model, delta: number): void {
    this.cancelRemoval();
    const all = this.all(model);
    if (all.length === 0) return;
    if (this.focus === "search") {
      this.focus = "list";
      if (delta < 0) this.at = itemKey(all[all.length - 1]);
      return;
    }
    const now = all.findIndex(i => itemKey(i) === this.at);
    this.at = itemKey(all[(Math.max(0, now) + delta + all.length) % all.length]);
  }
  /** After the search changed, the selected row stays while it's listed;
   * else the first row takes it, what there is before what can be added. */
  private searched(model: Model): void {
    const { have, add } = this.items(model);
    if ([...have, ...add].some(i => itemKey(i) === this.at)) return;
    const first = have[0] ?? add[0];
    if (first) this.at = itemKey(first);
  }
  private inLauncher(item: Item, model: Model): boolean {
    if (item.kind === "agent") return item.agent.shown;
    return item.kind === "command" && !model.commands[item.index].hidden;
  }
  private removable(item: Item, model: Model): boolean {
    if (item.kind === "agent") return item.agent.account.length > 0 || item.agent.shown;
    return item.kind === "command" && model.commands[item.index].command.length > 0;
  }
  /** Whether a row in the launcher shows in this workspace; null for the rows that aren't. */
  private hereOf(item: Item, model: Model): boolean | null {
    if (!this.inLauncher(item, model)) return null;
    if (item.kind === "agent") return item.agent.here;
    return item.kind === "command" ? model.here(item.index) : null;
  }
  private toggleHere(item: Item | null, model: Model): Action | null {
    if (!item || this.removal || this.hereOf(item, model) === null) return null;
    if (item.kind === "agent") return { kind: "here", agent: item.agent, shown: !item.agent.here };
    return item.kind === "command" ? { kind: "here_command", index: item.index, shown: !model.here(item.index) } : null;
  }
  private act(item: Item, model: Model, now = milliTimestamp()): Action | null {
    switch (item.kind) {
      case "agent": {
        if (!item.agent.shown) return { kind: "show", agent: item.agent };
        this.transition.start(1, now);
        this.agent_form.open(item.agent, model.options(item.agent), model.suggest(item.agent));
        this.page = "agent";
        return null;
      }
      case "command":
        if (model.commands[item.index].hidden) return { kind: "show_command", index: item.index };
        this.command(item.index, model);
        return null;
      case "add":
        return { kind: "add", provider: item.provider };
      case "custom":
        this.command(null, model);
        return null;
    }
  }
  private toggleFocus(): void {
    this.cancelRemoval();
    this.focus = this.focus === "search" ? "list" : "search";
  }
  private cancelRemoval(now = milliTimestamp()): void {
    if (this.removal?.phase !== "held") return;
    this.hold.quiet(now);
    this.hold.reset();
    this.removal = null;
  }
  /** A hold never follows a selection or a command that changed underneath it. */
  private sameRemoval(item: Item | null, model: Model): boolean {
    const r = this.removal;
    if (!r || !item || !this.removable(item, model) || itemKey(item) !== itemKey(r.item)) return false;
    if (item.kind === "agent" && r.item.kind === "agent")
      return item.agent.managed === r.item.agent.managed && item.agent.label === r.label;
    return (
      item.kind === "command" &&
      model.commands[item.index].text() === r.detail &&
      model.commands[item.index].label() === r.label
    );
  }
  private remove(item: Item | null, model: Model, now: number): Action | null {
    if (this.removal && this.removal.phase !== "held") {
      this.hold.quiet(now);
      return null;
    }
    if (this.removal && !this.sameRemoval(item, model)) this.cancelRemoval(now);
    if (this.hold.quieted(now)) {
      this.hold.quiet(now);
      return null;
    }
    if (!item || item.kind === "add" || item.kind === "custom") return null;
    if (!this.removable(item, model)) return null;
    if (!this.removal) {
      const a = item.kind === "agent" ? item.agent : null,
        c = item.kind === "command" ? model.commands[item.index] : null;
      this.removal = {
        item,
        label: a?.label ?? c!.label(),
        detail: a?.who ?? c!.text(),
        note: a
          ? !a.account
            ? "Default account stays available to add"
            : a.managed
              ? "Signs out and deletes its folder"
              : "Removes account; keeps its folder"
          : "Deletes the saved command",
        section: this.inLauncher(item, model) ? "have" : "add",
        index: this.items(model)[this.inLauncher(item, model) ? "have" : "add"].findIndex(
          i => itemKey(i) === itemKey(item),
        ),
        phase: "held",
        committed_at: 0,
      };
    }
    if (!this.hold.press(now)) return null;
    this.removal.phase = "removing";
    this.removal.committed_at = now;
    return item.kind === "agent"
      ? { kind: "remove", agent: item.agent }
      : { kind: "remove_command", index: item.index };
  }
  removed(error: string | null = null): void {
    if (error !== null) {
      this.removal = null;
      this.hold.reset();
      this.fail(error);
    } else if (this.removal) this.removal.phase = "removed";
  }
  /** Advances release/healing and keeps the ending on screen after removal. */
  tick(model: Model, now = milliTimestamp()): boolean {
    const slide = this.transition.tick(now),
      row = this.agent_form.tick(now),
      motion = slide || row;
    const r = this.removal;
    if (!r) return motion;
    if (r.phase === "held") {
      if (!this.sameRemoval(this.selected(model), model)) this.cancelRemoval(now);
      else {
        this.hold.advance(now);
        if (!this.hold.active) this.removal = null;
      }
    } else if (r.phase === "removed" && now - r.committed_at >= worktreeRemoval.finale_ms.bury) {
      this.removal = null;
      this.hold.reset();
      this.searched(model);
    }
    return true;
  }

  /** A key, as a byte. */
  key(byte: number, model: Model, now = milliTimestamp()): Action | null {
    this.tick(model, now);
    if (this.page === "command") return this.formKey(byte);
    if (this.page === "agent") return this.agentResult(this.agent_form.key(byte, now), now);
    const item = this.selected(model);
    this.error = "";
    if (byte === 27 && this.removal?.phase === "held") {
      this.cancelRemoval(now);
      return null;
    }
    if (byte !== 8 && byte !== 127) this.cancelRemoval(now);
    switch (byte) {
      case 27:
        return { kind: "close" };
      case 13:
        if (this.focus === "search") {
          this.focus = "list";
          return null;
        }
        if (this.removal) return null;
        return item ? this.act(item, model, now) : null;
      case 9:
        this.toggleFocus();
        return null;
      case 14:
        this.move(model, 1);
        return null;
      case 16:
        this.move(model, -1);
        return null;
      case 32:
        if (this.focus === "list") return this.toggleHere(item, model);
        break;
      case 8:
      case 127:
        if (this.focus === "list") return this.remove(item, model, now);
        break;
    }
    if (this.focus === "list") {
      if (byte < 33 || byte === 127) return null;
      this.focus = "search";
    }
    this.query.key(byte);
    this.searched(model);
    return null;
  }
  private cancelAgent(now: number): null {
    this.transition.start(-1, now);
    this.page = "list";
    this.focus = "list";
    return null;
  }
  private agentResult(result: "save" | "cancel" | null, now: number): Action | null {
    if (result === "cancel") return this.cancelAgent(now);
    const form = this.agent_form;
    return result === "save" && form.agent
      ? { kind: "configure", agent: form.agent, name: form.label(), options: form.options() }
      : null;
  }
  private formKey(byte: number): Action | null {
    const f = this.form;
    switch (byte) {
      case 9:
        f.name_focused = !f.name_focused;
        return null;
      case 27:
        return this.cancelCommand();
      case 13:
        return { kind: "save" };
      default:
        if (f.name_focused) f.name_customized = true;
        f.input().key(byte);
        return null;
    }
  }
  private cancelCommand(): null {
    this.form.save_requested = false;
    this.page = "list";
    return null;
  }
  /** A key that came as an escape sequence: arrows move, the rest edit the field. */
  sequence(seq: string, model: Model, now = milliTimestamp()): Action | null {
    this.tick(model, now);
    const key = keys.parse(seq);
    if (this.page === "agent") {
      this.agent_form.sequence(seq);
      return null;
    }
    if (this.page === "list" && this.focus === "list" && key === "delete")
      return this.remove(this.selected(model), model, now);
    this.cancelRemoval(now);
    if (this.page === "list" && (key === "up" || key === "down")) {
      this.move(model, key === "up" ? -1 : 1);
      return null;
    }
    if (this.page === "list" && key === "shift_tab") {
      this.toggleFocus();
      return null;
    }
    if (this.page === "list" && key === "left" && (this.focus === "list" || this.query.len === 0))
      return { kind: "back" };
    if (!this.typing()) return null;
    const before = this.query.name();
    this.input().sequence(seq);
    if (this.page === "list" && this.query.name() !== before) this.searched(model);
    return null;
  }
  /** A click at (`x`, `y`) in the box `b`. */
  click(b: Rect, x: number, y: number, model: Model): Action | null {
    if (y === b.y && this.page === "list" && x >= b.x + 2 && x < b.x + 2 + this.backLabel(b).length)
      return { kind: "back" };
    if (y === b.y && x >= View.closeX(b) && x < View.closeX(b) + 13)
      return this.page === "command"
        ? this.cancelCommand()
        : this.page === "agent"
          ? this.cancelAgent(milliTimestamp())
          : { kind: "close" };
    if (this.transition.active) return null;
    if (this.page === "agent") return this.agentResult(this.agent_form.click(b, x, y), milliTimestamp());
    if (this.page === "command") {
      const hit = this.form.click(b, x, y);
      if (hit === "save") return { kind: "save" };
      if (hit === "cancel") return this.cancelCommand();
      return null;
    }
    if (y === b.y + 2 && x >= b.x + 3 && x < b.x + b.w - 4) {
      this.cancelRemoval();
      this.focus = "search";
      const offset = DialogView.scroll(this.query, sat(b.w, 7));
      this.query.position(this.query.byteAtColumn(offset, x - b.x - 3));
      return null;
    }
    const row = this.rows(b, model).find(r => r.y === y);
    if (!row || x <= b.x || x >= b.x + b.w - 1) return null;
    const key = itemKey(row.item),
      again = this.focus === "list" && key === this.at && !this.removal,
      here = View.here(b, model);
    this.cancelRemoval();
    this.focus = "list";
    this.at = key;
    this.error = "";
    if (this.removal) return null;
    const toggle = x >= here.x && x < here.x + displayWidth(here.label) ? this.toggleHere(row.item, model) : null;
    return toggle ?? (again ? this.act(row.item, model) : null);
  }

  /** Where the title's Esc hint starts, as the launcher's Manage button sits. */
  private static closeX = (b: Rect) => b.x + b.w - 15;
  /** The columns its rows' names and accounts start at. */
  private static columns(b: Rect) {
    const name = b.x + 5,
      who = name + Math.min(24, Math.floor(b.w / 3)),
      usage = b.w >= 100 ? b.x + Math.max(56, Math.floor(b.w * 0.52)) : null;
    return { name, who, usage };
  }
  /** The Show column, whose toggles apply to the current workspace: its heading, and where it starts.
   * A narrow box heads it with the workspace's name alone. */
  private static here(b: Rect, model: Model): { x: number; label: string } {
    const label = b.w < 60 ? ellipsis(View.workspace(model), 12) : ellipsis(`Show in ${View.workspace(model)}`, 18);
    return { x: b.x + b.w - 4 - displayWidth(label), label };
  }
  private static workspace = (model: Model) => model.workspace || "workspace";
  private backLabel(b: Rect): string {
    return b.w >= 56 ? ` ← ${this.back_label} ` : " ← ";
  }
  /** Keep the selected row inside the host's viewport, including short settings panes. */
  private listOffset(b: Rect, model: Model): number {
    const { have, add } = this.items(model),
      items = [...have, ...add],
      selected = this.selected(model),
      index = items.findIndex(item => selected !== null && itemKey(item) === itemKey(selected)),
      gap = Math.max(1, have.length) + 2,
      row = index < have.length ? index : gap + index - have.length,
      count = add.length > 0 ? gap + add.length : Math.max(1, have.length),
      room = Math.max(1, b.h - 9);
    if (this.focus === "list" && index >= 0) this.first = clamp(this.first, row - room + 1, row);
    this.first = clamp(this.first, 0, Math.max(0, count - room));
    return this.first;
  }
  /** Each visible row's line. Drawing and clicking use the same viewport. */
  private rows(b: Rect, model: Model): { item: Item; y: number }[] {
    const { have, add } = this.items(model),
      first = this.listOffset(b, model),
      out = have.map((item, i) => ({ item, y: b.y + 6 + i - first })),
      next = b.y + 6 + Math.max(1, have.length) + 2 - first;
    return [...out, ...add.map((item, i) => ({ item, y: next + i }))].filter(
      row => row.y >= b.y + 6 && row.y < b.y + b.h - 3,
    );
  }

  draw(
    w: Writer,
    b: Rect,
    model: Model,
    now = milliTimestamp(),
    presentation: { framed?: boolean; focused?: boolean } = {},
  ): void {
    const body = new Writer();
    this.drawContent(body, b, model, now, presentation);
    this.transition.draw(w, body.s, b, b.w, 0, presentation.framed !== false);
  }
  private drawContent(
    w: Writer,
    b: Rect,
    model: Model,
    now = milliTimestamp(),
    presentation: { framed?: boolean; focused?: boolean } = {},
  ): void {
    const at = (x: number, y: number) => `\x1b[${y + 1};${x + 1}H`,
      panel = new Style({ fg: "text", bg: "surface" }).sgr(),
      faint = new Style({ fg: "faint", bg: "surface" }).sgr(),
      rule = new Style({ fg: "line", bg: "surface" }).sgr();
    for (let y = 0; presentation.framed !== false && y < b.h; y++) {
      w.write(at(b.x, b.y + y) + rule + (y === 0 ? "╭" : y === b.h - 1 ? "╰" : "│"));
      if (y === 0 || y === b.h - 1) w.write("─".repeat(b.w - 2));
      else w.splat(" ", b.w - 2);
      w.write(y === 0 ? "╮" : y === b.h - 1 ? "╯" : "│");
    }
    const title =
      this.page === "list"
        ? "Manage agents"
        : this.page === "agent"
          ? "Edit agent"
          : this.form.edit_index !== null
            ? `Edit ${model.commands[this.form.edit_index]?.label() ?? "command"}`
            : "New command";
    if (this.page === "list") w.write(at(b.x + 2, b.y) + faint + this.backLabel(b));
    w.write(
      at(b.x + (this.page === "list" ? 3 + this.backLabel(b).length : 2), b.y) +
        new Style({ fg: "strong", bg: "surface", bold: true }).sgr() +
        ` ${title} `,
    );
    w.write(
      at(View.closeX(b), b.y) + faint + " " + keycap + " esc " + faint + (this.page !== "list" ? " back " : " close "),
    );
    let caret: { x: number; y: number };
    if (this.page === "command") {
      this.form.draw(w, b, model);
      View.footer(w, b, [
        ["tab", "command / name"],
        ["↵", "save"],
        ["esc", "back"],
      ]);
      caret = this.form.caret(b);
    } else if (this.page === "agent") {
      this.agent_form.draw(w, b, now);
      View.footer(w, b, [
        ["tab", "next"],
        ["↵", this.agent_form.typing() ? "save" : "activate"],
        ["esc", "cancel"],
      ]);
      caret = this.agent_form.caret(b);
    } else caret = this.drawList(w, b, model, now, presentation.focused !== false);
    w.write(
      `\x1b[0m${at(caret.x, caret.y)}${this.typing() && presentation.focused !== false ? "\x1b[?25h" : "\x1b[?25l"}`,
    );
  }
  /** Draws the list; where the caret goes. */
  private drawList(w: Writer, b: Rect, model: Model, now: number, focused: boolean): { x: number; y: number } {
    const at = (x: number, y: number) => `\x1b[${y + 1};${x + 1}H`,
      faint = new Style({ fg: "faint", bg: "surface" }).sgr(),
      rule = new Style({ fg: "line", bg: "surface" }).sgr(),
      { name: name_x, who: who_x, usage: usage_x } = View.columns(b),
      here = View.here(b, model),
      { have, add } = this.items(model),
      chosen = this.selected(model),
      search_w = sat(b.w, 7);
    // The search, a placeholder until something's typed.
    const searching = focused && this.focus === "search";
    field(
      w,
      this.query,
      "Search",
      b.x + 3,
      b.y + 2,
      search_w,
      searching,
      searching ? "selected" : "surface",
      searching ? "muted" : "faint",
    );
    w.write(at(name_x, b.y + 4) + faint + "Agent" + at(who_x, b.y + 4) + "Account" + at(here.x, b.y + 4) + here.label);
    const usage_grid = new launcherUsage.Grid();
    for (const a of model.agents) usage_grid.add(a.usage);
    if (usage_x !== null) {
      w.write(at(usage_x, b.y + 4) + faint);
      writeEllipsis(w, "Usage (used) · resets in", here.x - 2 - usage_x);
    }
    w.write(at(b.x + 3, b.y + 5) + rule + "─".repeat(sat(b.w, 6)));
    const caret = { x: b.x + 3 + this.queryColumn(search_w), y: b.y + 2 };
    const first = this.listOffset(b, model);
    if (have.length === 0 && first === 0) {
      w.write(at(name_x, b.y + 6) + faint);
      writeEllipsis(
        w,
        this.query.len ? `No added agents match "${this.query.name()}".` : "No agents in launcher.",
        sat(b.x + b.w - 2, name_x),
      );
    }
    if (add.length > 0) {
      const y = b.y + 6 + Math.max(1, have.length) + 1 - first;
      if (y >= b.y + 6 && y < b.y + b.h - 3)
        w.write(at(b.x + 3, y) + new Style({ fg: "muted", bg: "surface", bold: true }).sgr() + "Available to add");
    }
    for (const { item, y } of this.rows(b, model)) {
      const on = focused && this.focus === "list" && chosen !== null && itemKey(item) === itemKey(chosen),
        style = on ? new Style({ fg: "strong", bg: "selected" }).sgr() : new Style({ fg: "text", bg: "surface" }).sgr(),
        quiet = palette.fg(on ? "muted" : "faint");
      w.write(at(b.x + 1, y) + style);
      w.splat(" ", b.w - 2);
      w.write(at(b.x + 1, y) + (on ? "›" : " "));
      if (this.removal && itemKey(item) === itemKey(this.removal.item)) {
        this.drawRemoval(w, b, y, now);
        continue;
      }
      if (!this.inLauncher(item, model)) w.write(at(b.x + 3, y) + "+");
      const who_w = sat(here.x - 2, who_x),
        shown_here = this.hereOf(item, model);
      if (shown_here !== null)
        w.write(at(here.x, y) + (shown_here ? "\x1b[1m" + palette.fg("strong") + "✓" : quiet + "·") + style);
      // A row hidden here reads dimmed, as the launcher here leaves it out.
      if (shown_here === false) w.write(quiet);
      switch (item.kind) {
        case "add":
          w.write(at(name_x, y));
          writeEllipsis(w, `New ${adapter(item.provider).label} account`, sat(b.x + b.w - 2, name_x));
          break;
        case "custom":
          w.write(at(name_x, y));
          writeEllipsis(w, "Custom command", sat(b.x + b.w - 2, name_x));
          break;
        case "command": {
          const c = model.commands[item.index];
          w.write(at(name_x, y));
          writeEllipsis(w, c.label(), sat(who_x, name_x + 2));
          w.write(at(who_x, y) + quiet);
          writeEllipsis(w, cleanControls(c.text()), who_w);
          break;
        }
        case "agent": {
          const a = item.agent;
          w.write(at(name_x, y));
          writeEllipsis(w, a.label, sat(who_x, name_x + 2));
          w.write(at(who_x, y) + (a.signed_out ? palette.fg("warm") : ""));
          writeEllipsis(w, cleanControls(a.who), usage_x === null ? who_w : usage_x - who_x - 2);
          if (usage_x !== null) {
            w.write(at(usage_x, y) + style);
            a.usage.write(w, usage_grid, here.x - 2 - usage_x, style, on);
          }
          break;
        }
      }
    }
    if (this.error) {
      w.write(at(b.x + 3, b.y + b.h - 2) + new Style({ fg: "hot", bg: "surface" }).sgr());
      writeEllipsis(w, this.error, sat(b.w, 6));
    } else if (this.removal) {
      const r = this.removal;
      w.write(at(b.x + 3, b.y + b.h - 3) + new Style({ fg: "strong", bg: "surface" }).sgr());
      writeEllipsis(w, `${r.phase === "held" ? "Hold ⌫ to remove" : "Removing"} ${r.label}`, sat(b.w, 6));
      w.write(at(b.x + 3, b.y + b.h - 2) + new Style({ fg: "muted", bg: "surface" }).sgr());
      writeEllipsis(w, `${r.note}${r.phase === "held" ? " · release to cancel" : ""}`, sat(b.w, 6));
    } else if (focused) View.footer(w, b, this.hints(chosen, model));
    return caret;
  }
  private queryColumn(width: number): number {
    const offset = DialogView.scroll(this.query, width);
    return Math.min(sat(width, 1), displayWidth(this.query.bytes(offset, this.query.cursor)));
  }
  private drawRemoval(w: Writer, b: Rect, y: number, now: number): void {
    const r = this.removal!,
      grid = new Grid(b.w - 2, 1, palette.colors.text),
      { name, who } = View.columns(new Rect(-1, 0, b.w, 1)),
      finale =
        r.phase === "held" ? 0 : Math.max(0.0001, Math.min(1, (now - r.committed_at) / worktreeRemoval.finale_ms.bury));
    grid.text(0, 0, "›", palette.colors.strong);
    grid.text(name, 0, ellipsis(r.label, sat(who, name + 2)), palette.colors.strong);
    grid.text(who, 0, ellipsis(cleanControls(r.detail), sat(b.w - 3, who)), palette.colors.muted);
    const area = { y: 0, lines: 1, left: 0, right: grid.w - 1, top: 0, bottom: 0 };
    worktreeRemoval.paint(grid, area, "bury", this.hold.progress, finale, now);
    if (r.phase === "removing" && finale >= 1) worktreeRemoval.progress(grid, area, now);
    grid.write(w, b.x + 1, y, new Style({ fg: "text", bg: "selected" }).sgr());
  }
  /** The keys the selected row takes. */
  private hints(item: Item | null, model: Model): Hint[] {
    if (this.focus === "search")
      return [
        ["tab / ↓", "list"],
        ["←", this.back_label.toLowerCase()],
        ["esc", "close"],
      ];
    switch (item?.kind) {
      case undefined:
        return [["esc", "close"]];
      case "add":
        return [["↵", `sign in to a new ${adapter(item.provider).label} account`]];
      case "custom":
        return [["↵", "new command"]];
      case "command":
      case "agent":
        if (!this.inLauncher(item, model))
          return [
            ["↵", "add to launcher"],
            ...(this.removable(item, model) ? [["hold ⌫", "delete"] as Hint] : []),
            ["tab", "search"],
          ];
        return [
          ["↵", "edit"],
          ["space", `${this.hereOf(item, model) ? "hide" : "show"} in ${ellipsis(View.workspace(model), 16)}`],
          ["hold ⌫", item.kind === "agent" && !item.agent.account ? "remove" : "delete"],
          ["tab", "search"],
        ];
    }
  }
  private static footer(w: Writer, b: Rect, hints: Hint[]): void {
    const panel = new Style({ fg: "faint", bg: "surface" }).sgr();
    w.write(`\x1b[${b.y + b.h - 1};${b.x + 3}H`);
    let used = 0;
    for (const [key, label] of hints) {
      const width = displayWidth(key) + displayWidth(label) + 3 + (used ? 2 : 0);
      if (used + width > b.w - 6) break;
      w.write((used ? panel + "  " : "") + keycap + ` ${key} ` + panel + ` ${label}`);
      used += width;
    }
  }
}
