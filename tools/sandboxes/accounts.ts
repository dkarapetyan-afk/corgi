/**
 * The accounts sandbox: Claude signed in twice, as the default account and
 * as an account Omarchy keeps, which Corgi finds in Omarchy's list, with an
 * agent in each. The fake agents' first run in a new folder signs in, as
 * the real ones' do, so Add account in the launcher works here.
 *
 * - Personal: an agent on the default account.
 * - Work: an agent typed with CLAUDE_CONFIG_DIR set to Omarchy's folder.
 * - shell: for `corgi account list`, `add` and `remove`.
 */
import { join } from "node:path";
import { table, type Sandbox, type World } from "../sandbox";

/** Where Omarchy lists its accounts, and keeps the folder of its Work one. */
const omarchy = (s: Sandbox) => join(s.home, ".local/state/omarchy/agents/accounts");
const work = (s: Sandbox) => join(omarchy(s), "claude", "work");

export const world: World = {
  seed(s) {
    const app = join(s.dir, "app");
    s.run(["mkdir", "-p", app]);
    s.git(app, "init", "-q");
    s.write(join(app, "README.md"), s.pristine("README.md"));
    s.commit(app, "corgi: snapshot for the accounts sandbox");
    s.write(join(s.home, ".claude/.claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "me@example.com" } }));
    s.write(join(s.home, ".claude/CLAUDE.md"), "Answer in one line.\n");
    s.write(
      join(work(s), ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "me@work.example.com" }, hasCompletedOnboarding: true }),
    );
    s.write(
      join(omarchy(s), "claude.json"),
      JSON.stringify({
        active: "main",
        accounts: [
          { id: "main", label: "Main", home: "", primary: true },
          { id: "work", label: "Work", home: work(s), primary: false },
        ],
      }),
    );
  },

  arrange(s) {
    const app = join(s.dir, "app");
    const before: { id: number; model?: { tabs?: unknown[] } }[] = s.corgi(["workspace", "list"])?.workspaces ?? [];
    const made: { workspace: number; tab: number } = s.corgi(["workspace", "new", "app", "--cwd", app]);
    s.corgi(["tab", "rename", String(made.tab), "shell"]);
    const tab = (name: string, command: string) =>
      s.corgi([
        "tab",
        "new",
        "--workspace",
        String(made.workspace),
        "--name",
        name,
        "--cwd",
        app,
        "--command",
        command,
      ]);
    tab("Personal", "claude");
    tab("Work", `CLAUDE_CONFIG_DIR=${work(s)} claude`);
    for (const w of before)
      if (w.id !== made.workspace && (w.model?.tabs?.length ?? 0) === 0)
        s.corgi(["workspace", "close", String(w.id)], false);
  },

  intro(s) {
    return [
      "Claude signed in twice: the default account and Omarchy's Work account, an agent in each.",
      ...table([
        [`${s.prefixName} c`, "the launcher: Claude Code, then Claude Code · Work, each with its own usage"],
        ["m", "in the launcher: Add account opens a tab that signs in a new one; any word is a code"],
        ["hover", "an agent in the sidebar: the Work agent's card names its account"],
        ["shell", "corgi account list, corgi account add claude side, corgi account remove side"],
      ]),
    ];
  },
};
