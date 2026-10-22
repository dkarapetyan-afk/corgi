import { expect, test } from "bun:test";
import * as agentManager from "./agent_manager";
import * as palette from "./palette";
import { Entry as CommandEntry } from "./launch/command";
import { Rect } from "./layout";
import { Cell } from "./launcher_usage";
import { Terminal } from "./pane/terminal";
import { Writer } from "./text";

const agent = (fields: Partial<agentManager.Agent>): agentManager.Agent => ({
  provider: "claude",
  account: "",
  name: "",
  label: "Claude Code",
  who: "me@example.com",
  signed_out: false,
  shown: true,
  here: true,
  managed: false,
  usage: Cell.status("—"),
  ...fields,
});
const work = agent({ account: "/a/2", name: "work", label: "Claude Code · work", who: "me@acme.com", managed: true });
function model(): agentManager.Model {
  const commands = Array.from({ length: 6 }, () => new CommandEntry());
  commands[0].set('claude --model opus -p "review this diff"');
  commands[0].name = "review-bot";
  return {
    agents: [
      agent({ provider: "codex", label: "Codex" }),
      agent({}),
      work,
      agent({ account: "/o/side", name: "side", label: "Claude Code · side", who: "Not signed in", signed_out: true }),
    ],
    commands,
    workspace: "corgi",
    here: () => true,
    add: ["codex", "claude"],
    account: () => "me@example.com",
    suggest: a => (a === work ? "acme" : "example"),
  };
}
/** What `v` draws in a box like the launcher's card, as text. */
function screen(v: agentManager.View, m: agentManager.Model, now?: number) {
  const b = new Rect(0, 0, 82, v.height(m)),
    w = new Writer();
  v.draw(w, b, m, now);
  const host = new Terminal(90, 30);
  host.feed(w.s);
  const lines = host.text().split("\n");
  host.destroy();
  return { lines, b, raw: w.s };
}
const type = (v: agentManager.View, m: agentManager.Model, text: string) => {
  let action: agentManager.Action | null = null;
  for (const ch of text) action = v.key(ch.charCodeAt(0), m) ?? action;
  return action;
};

test("it lists what there is, then what can be added, and opens on the account it's given", () => {
  const m = model(),
    v = new agentManager.View();
  v.open(agentManager.agentKey("claude", "/a/2"));
  expect(v.focus).toBe("search");
  expect(screen(v, m).raw).toContain("\x1b[?25h");
  v.key(9, m);
  const { lines, b } = screen(v, m);
  expect(screen(v, m).raw).toContain("\x1b[?25l");
  expect(lines[0]).toMatch(/^╭─ ← New tab ─ Manage agents ─+ +esc +close ─╮/);
  expect(lines[4]).toMatch(/│ +Agent +Account +Show in corgi +│/);
  expect(lines.slice(6, 11)).toEqual([
    expect.stringMatching(/│ +Codex +me@example.com +✓ +│/),
    expect.stringMatching(/│ +Claude Code +me@example.com +✓ +│/),
    expect.stringMatching(/│› +Claude Code · work +me@acme.com +✓ +│/),
    expect.stringMatching(/│ +Claude Code · side +Not signed in +✓ +│/),
    expect.stringMatching(/│ +review-bot +claude --model opus -p "review th… +✓ +│/),
  ]);
  expect(lines.slice(12, 16)).toEqual([
    expect.stringMatching(/│  Available to add +│/),
    expect.stringMatching(/│ +\+ New Codex account +│/),
    expect.stringMatching(/│ +\+ New Claude Code account +│/),
    expect.stringMatching(/│ +\+ Custom command +│/),
  ]);
  expect(lines[b.h - 2]).toMatch(/↵ +rename +space +hide in corgi +hold ⌫ +delete/);
  expect(b.h).toBe(19);
});

test("typing searches names, accounts and commands, and the selection stays while it's listed", () => {
  const m = model(),
    v = new agentManager.View();
  v.open(agentManager.agentKey("claude", "/a/2"));
  type(v, m, "acme");
  let { lines } = screen(v, m);
  expect(lines[2]).toMatch(/│  acme +│/);
  expect(lines[6]).toMatch(/│ +Claude Code · work +me@acme.com/);
  // Nothing to add says "acme", so that section goes.
  expect(lines.some(l => l.includes("Available to add"))).toBe(false);
  // Space and Backspace belong to search, including when it becomes empty.
  v.key(127, m);
  v.key(127, m);
  v.key(127, m);
  v.key(127, m);
  type(v, m, "codex");
  ({ lines } = screen(v, m));
  expect(lines[6]).toMatch(/│ +Codex /);
  expect(lines.find(l => l.includes("Available to add"))).toBeDefined();
  expect(v.key(32, m)).toBeNull();
  expect(v.query.raw()).toBe("codex ");
  type(v, m, "zz");
  expect(screen(v, m).lines[6]).toContain('No added agents match "codex zz".');
});

test("Enter renames an account in place, and an empty name takes the one its email suggests", () => {
  const m = model(),
    v = new agentManager.View();
  v.open(agentManager.agentKey("claude", "/a/2"));
  v.key(9, m);
  expect(v.key(13, m)).toBeNull();
  expect(v.rename?.name()).toBe("work");
  let { lines, b } = screen(v, m);
  expect(lines[8]).toMatch(/│› +Claude Code · work +me@acme.com/);
  expect(lines[b.h - 2]).toMatch(/↵ +save +tab +use acme +esc +cancel/);
  // The name starts selected, so typing replaces it.
  type(v, m, "big");
  expect(v.key(13, m)).toEqual({ kind: "rename", agent: work, name: "big" });
  v.fail("There's an account by that name already.");
  ({ lines } = screen(v, m));
  expect(lines[b.h - 2]).toContain("There's an account by that name already.");
  for (let i = 0; i < 3; i++) v.key(127, m);
  expect(v.key(13, m)).toEqual({ kind: "rename", agent: work, name: "acme" });
  v.key(9, m);
  expect(v.rename?.name()).toBe("acme");
  v.renamed();
  expect(v.rename).toBeNull();
  // Esc lets a rename go.
  v.key(13, m);
  v.key(27, m);
  expect(v.rename).toBeNull();
});

test("the default account renames too, and left empty goes by its agent's name", () => {
  const m = model(),
    v = new agentManager.View(),
    claude = m.agents[1];
  v.open(agentManager.agentKey("claude", ""));
  v.key(9, m);
  const before = screen(v, m);
  expect(before.lines[before.b.h - 2]).toMatch(/↵ +rename/);
  expect(v.key(13, m)).toBeNull();
  const { lines, b } = screen(v, m);
  expect(lines[7]).toMatch(/│› +Claude Code · +me@example.com/);
  expect(lines[b.h - 2]).toMatch(/↵ +no name +tab +use example +esc +cancel/);
  expect(v.key(13, m)).toEqual({ kind: "rename", agent: claude, name: "" });
  v.key(9, m);
  expect(v.key(13, m)).toEqual({ kind: "rename", agent: claude, name: "example" });
  // One that has a name starts with it.
  v.renamed();
  m.agents[1] = { ...claude, name: "example", label: "Claude Code · example" };
  v.key(13, m);
  expect(v.rename?.name()).toBe("example");
});

/** Hold long enough to commit, returning the one removal action. */
function hold(v: agentManager.View, m: agentManager.Model, start = 0, forward = false) {
  const press = (now: number) => (forward ? v.sequence("\x1b[3~", m, now) : v.key(127, m, now));
  const actions: agentManager.Action[] = [];
  const first = press(start);
  if (first) actions.push(first);
  for (let elapsed = 400; elapsed <= 1700; elapsed += 50) {
    const action = press(start + elapsed);
    if (action) actions.push(action);
  }
  return actions;
}

test("clearing search and continuing to hold Backspace never starts removal", () => {
  const m = model(),
    v = new agentManager.View();
  v.open(agentManager.agentKey("claude", "/a/2"));
  type(v, m, "work");
  expect(hold(v, m)).toEqual([]);
  expect(v.query.name()).toBe("");
  expect(v.removal).toBeNull();
  expect(v.focus).toBe("search");
  expect(v.key(32, m)).toBeNull();
  expect(v.query.raw()).toBe(" ");
});

test("Tab and Down leave search on the current result, and arrows wrap inside the list", () => {
  const m = model(),
    v = new agentManager.View();
  v.open();
  type(v, m, "work");
  const selected = v.at;
  v.sequence("\x1b[B", m);
  expect([v.focus, v.at]).toEqual(["list", selected]);
  expect(v.key(32, m)).toEqual({ kind: "here", agent: work, shown: false });
  expect(v.query.name()).toBe("work");
  v.sequence("\x1b[A", m);
  expect([v.focus, v.at]).toEqual(["list", selected]);
  v.key(9, m);
  expect(v.focus).toBe("search");
  v.sequence("\x1b[Z", m);
  expect(v.focus).toBe("list");
  v.key(9, m);
  v.key(13, m);
  expect(v.focus).toBe("list");
  expect(v.rename).toBeNull();
  v.open();
  v.sequence("\x1b[A", m);
  expect([v.focus, v.at]).toEqual(["list", "custom"]);
  v.sequence("\x1b[B", m);
  expect(v.at).toBe(agentManager.agentKey("codex", ""));
  v.sequence("\x1b[A", m);
  expect([v.focus, v.at]).toEqual(["list", "custom"]);
});

test("holding Backspace buries only the selected account and keeps its ending after removal", () => {
  const m = model(),
    v = new agentManager.View();
  v.open(agentManager.agentKey("claude", "/a/2"));
  v.key(9, m);
  v.key(127, m, 0);
  expect(screen(v, m, 0).lines.join("\n")).toContain("Signs out and deletes its folder");
  for (let now = 400; now <= 650; now += 50) v.key(127, m, now);
  expect(screen(v, m, 650).lines[8]).toContain("‹o");
  // Release restores the row and performs nothing.
  v.tick(m, 1400);
  expect(v.removal).toBeNull();
  expect(hold(v, m, 2000)).toEqual([{ kind: "remove", agent: work }]);
  m.agents.splice(2, 1);
  v.removed();
  expect(v.items(m).have).toHaveLength(5);
  for (let now = 3750; now <= 6000; now += 50) expect(v.key(127, m, now)).toBeNull();
  expect(v.removal).toBeNull();
  expect(v.items(m).have).toHaveLength(4);
  expect(v.items(m).add).not.toContainEqual({ kind: "agent", agent: work });
});

test.each([50, 125, 250])("continuous repeats every %i ms cannot remove a second row", interval => {
  const m = model(),
    v = new agentManager.View();
  m.agents = [work, { ...work, account: "/b", name: "second", label: "Claude Code · second" }];
  m.commands = [];
  m.add = [];
  v.open(agentManager.agentKey("claude", work.account));
  v.key(9, m);
  const removed: string[] = [];
  for (let now = 0; now <= 10000; now += interval) {
    const action = v.key(127, m, now);
    if (action?.kind !== "remove") continue;
    removed.push(action.agent.account);
    m.agents = m.agents.filter(a => a.account !== action.agent.account);
    v.removed();
  }
  expect(removed).toEqual([work.account]);
  expect(m.agents.map(a => a.account)).toEqual(["/b"]);
});

test("forward Delete holds on the list, and external accounts and commands say what stays", () => {
  const m = model(),
    v = new agentManager.View();
  v.open(agentManager.agentKey("claude", "/o/side"));
  v.key(9, m);
  v.sequence("\x1b[3~", m, 0);
  expect(screen(v, m, 0).lines.join("\n")).toContain("Removes account; keeps its folder");
  expect(hold(v, m, 2000, true)).toEqual([{ kind: "remove", agent: m.agents[3] }]);
  v.open("command:0");
  v.key(9, m);
  expect(hold(v, m)).toEqual([{ kind: "remove_command", index: 0 }]);
  expect(screen(v, m, 1700).lines.join("\n")).toContain("Deletes the saved command");
  v.removed("Could not save");
  expect(v.removal).toBeNull();
  expect(screen(v, m).lines.join("\n")).toContain("Could not save");
  v.open(agentManager.agentKey("claude", ""));
  v.key(9, m);
  expect(hold(v, m)).toEqual([{ kind: "remove", agent: m.agents[1] }]);
});

test("changing focus, the selected row, or its command cancels a hold", () => {
  for (const change of ["tab", "down", "command", "gone", "enter"] as const) {
    const m = model(),
      v = new agentManager.View();
    v.open("command:0");
    v.key(9, m);
    v.key(127, m, 0);
    v.key(127, m, 400);
    if (change === "tab") v.key(9, m, 450);
    if (change === "down") v.sequence("\x1b[B", m, 450);
    if (change === "command") m.commands[0].set("codex");
    if (change === "gone") m.commands[0] = new CommandEntry();
    if (change === "enter") expect(v.key(13, m, 450)).toBeNull();
    v.tick(m, 500);
    expect(v.removal).toBeNull();
  }
});

test("clicking search restores its caret, and list focus ignores paste", () => {
  const m = model(),
    v = new agentManager.View();
  v.open();
  type(v, m, "codex");
  v.key(9, m);
  v.paste(120, m);
  expect(v.query.name()).toBe("codex");
  v.click(b(v, m), 3, 2, m);
  expect(v.focus).toBe("search");
  v.sequence("\x1b[3~", m);
  expect(v.query.name()).toBe("odex");
  expect(v.removal).toBeNull();
  v.paste(120, m);
  expect(v.query.name()).toBe("xodex");
});

test("Available to add's agents sign in to a new account, and Custom command opens the form", () => {
  const m = model(),
    v = new agentManager.View();
  v.open("add:codex");
  v.key(9, m);
  expect(screen(v, m).lines[b(v, m).h - 2]).toMatch(/↵ +sign in to a new Codex account/);
  expect(v.key(13, m)).toEqual({ kind: "add", provider: "codex" });
  v.open("add:claude");
  v.key(9, m);
  v.key(14, m);
  expect(v.key(13, m)).toBeNull();
  expect(v.page).toBe("command");
  const { lines } = screen(v, m);
  expect(lines[0]).toMatch(/^╭─ New command ─/);
  expect(lines[2]).toContain("Command");
  expect(v.key(13, m)).toEqual({ kind: "save" });
  type(v, m, "codex");
  expect(v.form.editor.name()).toBe("codex");
  v.saved(3);
  expect([v.page, v.at]).toEqual(["list", "command:3"]);
  // A saved command's row edits it.
  v.open("command:0");
  v.key(9, m);
  v.key(13, m);
  expect([v.page, v.form.edit_index, v.form.name_editor.name()]).toEqual(["command", 0, "review-bot"]);
});
const b = (v: agentManager.View, m: agentManager.Model) => new Rect(0, 0, 82, v.height(m));

test("Esc returns from a command and cancels a rename or hold before closing the list", () => {
  const m = model(),
    v = new agentManager.View();
  v.open(agentManager.agentKey("claude", "/a/2"));
  type(v, m, "wo");
  expect(v.key(27, m)).toEqual({ kind: "close" });
  v.open(agentManager.agentKey("claude", "/a/2"));
  v.key(9, m);
  v.key(13, m);
  expect(v.key(27, m)).toBeNull();
  v.key(127, m);
  expect(v.key(27, m)).toBeNull();
  expect(v.key(27, m)).toEqual({ kind: "close" });
  v.open("custom");
  v.key(9, m);
  v.key(13, m);
  v.form.save_requested = true;
  expect(screen(v, m).lines[0]).toMatch(/esc +back/);
  expect(v.key(27, m)).toBeNull();
  expect(v.page).toBe("list");
  expect(v.at).toBe("custom");
  expect(v.form.save_requested).toBe(false);
  expect(v.key(27, m)).toEqual({ kind: "close" });
});

test("arrows move past the sections, and clicks select, act again, and close", () => {
  const m = model(),
    v = new agentManager.View();
  v.open("command:0");
  v.key(9, m);
  expect(v.sequence("\x1b[B", m)).toBeNull();
  expect(v.at).toBe("add:codex");
  v.sequence("\x1b[A", m);
  v.sequence("\x1b[A", m);
  expect(v.at).toBe(agentManager.agentKey("claude", "/o/side"));
  const box = b(v, m);
  expect(v.click(box, 20, 8, m)).toBeNull();
  expect(v.at).toBe(agentManager.agentKey("claude", "/a/2"));
  v.click(box, 20, 8, m);
  expect(v.rename?.name()).toBe("work");
  expect(v.click(box, 4, 6, m)).toBeNull();
  expect(v.at).toBe(agentManager.agentKey("codex", ""));
  expect(v.click(box, 20, 14, m)).toBeNull();
  expect(v.click(box, 20, 14, m)).toEqual({ kind: "add", provider: "claude" });
  expect(v.click(box, box.w - 8, 0, m)).toEqual({ kind: "close" });
});

test("Left and the title return to New tab while text fields keep their arrow keys", () => {
  const m = model(),
    v = new agentManager.View();
  v.open();
  expect(v.sequence("\x1b[D", m)).toEqual({ kind: "back" });
  type(v, m, "work");
  expect(v.sequence("\x1b[D", m)).toBeNull();
  expect(v.query.cursor).toBe(3);
  v.key(9, m);
  expect(v.sequence("\x1b[D", m)).toEqual({ kind: "back" });
  expect(v.click(b(v, m), 4, 0, m)).toEqual({ kind: "back" });
  v.key(13, m);
  expect(v.sequence("\x1b[D", m)).toBeNull();
});

test("a short host scrolls to the selected row and clicks the same visible row", () => {
  const m = model(),
    v = new agentManager.View(),
    b = new Rect(2, 1, 82, 13);
  v.open("custom");
  v.focus = "list";
  const w = new Writer();
  v.draw(w, b, m);
  const host = new Terminal(90, 20);
  try {
    host.feed(w.s);
    const lines = host.text().split("\n"),
      y = lines.findIndex(line => line.includes("+ Custom command"));
    expect(y).toBeGreaterThanOrEqual(b.y + 6);
    expect(y).toBeLessThan(b.y + b.h - 3);
    expect(
      lines
        .slice(b.y + b.h)
        .join("")
        .trim(),
    ).toBe("");
    v.click(b, b.x + 10, y, m);
    expect(v.page).toBe("command");
  } finally {
    host.destroy();
  }
});

test("default accounts and previously hidden commands stay searchable and Enter adds them back", () => {
  const m = model(),
    v = new agentManager.View();
  m.agents[0].shown = false;
  m.commands[0].hidden = true;
  v.open();
  const items = v.items(m);
  expect(items.have).toHaveLength(3);
  expect(items.add.slice(0, 2)).toEqual([
    { kind: "agent", agent: m.agents[0] },
    { kind: "command", index: 0 },
  ]);
  const { lines } = screen(v, m),
    text = lines.join("\n");
  expect(text.indexOf("Codex")).toBeGreaterThan(text.indexOf("Available to add"));
  // Rows out of the launcher have no workspace toggle.
  expect(lines.find(line => line.includes("+ Codex"))).not.toMatch(/[✓·]/);
  expect(v.key(9, m)).toBeNull();
  v.at = agentManager.agentKey("codex", "");
  expect(v.key(32, m)).toBeNull();
  v.key(9, m);
  type(v, m, "review-bot");
  v.key(9, m);
  expect(v.key(13, m)).toEqual({ kind: "show_command", index: 0 });
  expect(v.page).toBe("list");
  m.commands[0].hidden = false;
  expect(v.items(m).have).toEqual([{ kind: "command", index: 0 }]);
  expect(v.items(m).add).toEqual([]);
});

test("space and the Show column hide a row in this workspace only, which then reads dimmed", () => {
  const m = model(),
    v = new agentManager.View();
  m.here = index => index !== 0;
  m.agents[2] = { ...work, here: false };
  v.open(agentManager.agentKey("claude", "/a/2"));
  v.key(9, m);
  expect(v.key(32, m)).toEqual({ kind: "here", agent: m.agents[2], shown: true });
  const { lines, b, raw } = screen(v, m);
  expect(lines[8]).toMatch(/│› +Claude Code · work +me@acme.com +· +│/);
  expect(lines[10]).toMatch(/│ +review-bot +claude .* +· +│/);
  expect(lines[b.h - 2]).toMatch(/space +show in corgi/);
  expect(raw).toContain(palette.fg("muted") + "\x1b[9;6HClaude Code · work");
  // A click on the toggle selects its row and flips it; elsewhere on the row only selects.
  const x = lines[4].indexOf("Show in corgi");
  expect(v.click(b, x, 6, m)).toEqual({ kind: "here", agent: m.agents[0], shown: false });
  expect(v.at).toBe(agentManager.agentKey("codex", ""));
  expect(v.click(b, x, 10, m)).toEqual({ kind: "here_command", index: 0, shown: true });
  expect(v.click(b, 8, 7, m)).toBeNull();
  // Narrow, the heading is the workspace's name alone; Esc still closes.
  m.workspace = "personal-projects";
  const narrow = new Rect(0, 0, 50, v.height(m)),
    w = new Writer();
  v.draw(w, narrow, m);
  expect(w.s).toContain("Account\x1b[5;35Hpersonal-pr…");
  expect(w.s).not.toContain("Show in");
  expect(v.key(27, m)).toEqual({ kind: "close" });
});

test("only default accounts move to Available after removal", () => {
  const m = model(),
    v = new agentManager.View();
  v.open(agentManager.agentKey("claude", ""));
  v.key(9, m);
  expect(hold(v, m)).toEqual([{ kind: "remove", agent: m.agents[1] }]);
  expect(screen(v, m, 1700).lines.join("\n")).toContain("Default account stays available to add");
  m.agents[1] = { ...m.agents[1], shown: false };
  v.removed();
  v.tick(m, 4000);
  expect(v.items(m).have.some(i => i.kind === "agent" && i.agent === m.agents[1])).toBe(false);
  expect(v.items(m).add[0]).toEqual({ kind: "agent", agent: m.agents[1] });
  expect(hold(v, m, 5000)).toEqual([]);
  expect(v.key(13, m)).toEqual({ kind: "show", agent: m.agents[1] });
});

test.each(["agent", "command"])("previously hidden %s can be permanently deleted in Available", kind => {
  const m = model(),
    v = new agentManager.View();
  m.agents[2] = { ...work, shown: false };
  m.commands[0].hidden = true;
  v.open(kind === "agent" ? agentManager.agentKey("claude", work.account) : "command:0");
  v.key(9, m);
  expect(hold(v, m)).toEqual([
    kind === "agent" ? { kind: "remove", agent: m.agents[2] } : { kind: "remove_command", index: 0 },
  ]);
  if (kind === "agent") m.agents.splice(2, 1);
  else m.commands[0] = new CommandEntry();
  v.removed();
  expect(v.items(m).have).toHaveLength(3);
  expect(v.items(m).add).toHaveLength(5);
  v.tick(m, 4000);
  expect(v.items(m).add).toHaveLength(4);
});

test("slow cleanup shows the moving worktree deletion bar after the corgi leaves", () => {
  const m = model(),
    v = new agentManager.View();
  v.open(agentManager.agentKey("claude", work.account));
  v.key(9, m);
  expect(hold(v, m)).toEqual([{ kind: "remove", agent: work }]);
  expect(screen(v, m, 1800).lines.join("\n")).not.toContain("Deleting...");
  v.tick(m, 4000);
  const first = screen(v, m, 4000).lines;
  expect(first[8]).toMatch(/Deleting\.\.\. +[━─]+/);
  expect(screen(v, m, 4300).lines[8]).not.toBe(first[8]);
  m.agents.splice(2, 1);
  v.removed();
  v.tick(m, 4500);
  expect(screen(v, m, 4500).lines.join("\n")).not.toContain("Deleting...");
});
