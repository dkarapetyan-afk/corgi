# Using Corgi

Corgi keeps terminals and agents running in workspaces. Each workspace has a
folder, tabs and split panes. Start with the [installation guide](../README.md);
building and working on Corgi are covered in [HACKING](../HACKING.md).

## Set up and import

Run `corgi` to start or attach. `corgi onboard` reopens setup; inside Corgi,
click the corgi badge or press **prefix i**. Choose a shortcut preset and a
Ctrl+B or Ctrl+A prefix. The cmux preset is available on macOS.

**prefix** means press the prefix, release it, then press the next key.
Press it twice to send it to the program. **prefix ?** opens the current
keymap; **Corgi setup → Keymap** changes it. Command shortcuts need host
forwarding. Setup can install a Ghostty configuration block on local macOS;
it affects Ghostty globally and requires a Ghostty configuration reload.

The import step lists real sessions, regardless of the shortcut preset.
Select workspaces and review what will happen before importing, or choose
**Skip import**. Expanding a workspace's preview does not change its selection.

| Source | What comes across | What happens to the source |
| --- | --- | --- |
| tmux | Folders, window names, split layout and recent output; editable restart commands where available | Programs keep running in tmux. Corgi opens shells; suggestions do not run automatically. |
| Herdr copy | Layout, folders and known agent resume suggestions | Source sessions keep running. Suggestions do not execute automatically. |
| Herdr handoff | The whole source session, including its running processes and PTYs | Ownership moves to Corgi. Start Corgi outside the Herdr session being moved. Requires compatible Herdr support. |
| cmux (macOS) | Saved workspaces, readable surfaces, folders and approximate layouts where needed; browser URLs as text | Processes remain in cmux. Corgi starts new shells. |

Copying cannot transfer arbitrary application memory or a shell's environment.
Import notes identify partial recovery; a failed import does not complete setup.
Even an isolated Corgi environment imports from real source sessions.

## Tabs and panes

**prefix c** opens the [agent and terminal picker](agent-launcher.md).
**prefix N** creates a workspace; choose its name and folder, then hold Enter
to create it. Missing folders can be created from the folder picker.

Click a tab, pane or sidebar agent to focus it. Drag split dividers to resize.
Right-click tabs, panes and agents for their actions; hold Shift when an
application captures the mouse. Drag workspace or agent rows to reorder them.
Workspace and agent order is shared; rearranging agents does not move panes.

Use **prefix w** to choose a workspace, **prefix a** to choose an agent, and
**prefix g** to search agents in the Corgi preset. Arrow focus crosses between
the sidebar, panes and review panel. **prefix b** hides or shows the sidebar.
[Workspace activity and worktrees](workspaces.md) explains its indicators.

Drag terminal text to copy it; hold Shift over mouse-aware applications.
The wheel enters scroll mode. There, `j/k`, PageUp/PageDown and `g/G` move,
`/` searches, `n/N` repeat the search, `y` or Enter copies, and `q` exits.
Output continues while you scroll.

Closing a tab or pane ends its processes. **prefix u** reopens the latest
recoverable closed agent in the workspace, resuming its conversation; closed
shells and unsaved application memory cannot be restored. **prefix q** detaches
this viewer and leaves the runtime running.

Viewers share processes and layout but keep their own selection and zoom.
A pane takes its size from the last-used viewer displaying it; other viewers
clip or pad it. Hidden panes keep their last size.

After a crash or reboot, Corgi restores saved layout and output. Recorded agent
sessions return dormant and resume when their pane gets focus; other panes
start new shells. Recovery cannot restore arbitrary process memory. See
[reload and recovery details](../HACKING.md).

### All shortcuts

This is the table printed by `corgi keys`. Keys without `prefix` are held
with their modifiers. In resize mode, `h/j/k/l` resize and another key exits.
tmux tab numbering starts at zero; other presets start at one.

| Action | Corgi | tmux | Herdr | cmux |
| --- | --- | --- | --- | --- |
| New tab (agent picker) | `prefix c`, `Ctrl+T` | `prefix c` | `prefix c` | `Cmd+T`, `prefix c` |
| Next tab | `prefix n` | `prefix n` | `prefix n` | `Cmd+Shift+]`, `prefix n` |
| Previous tab | `prefix p` | `prefix p` | `prefix p` | `Cmd+Shift+[`, `prefix p` |
| Select tab | `prefix 1–9` | `prefix 0–9` | `prefix 1–9` | `Ctrl+1–9`, `prefix 1–9` |
| Rename tab | `prefix T`, `prefix ,` | `prefix ,` | `prefix T` | `Cmd+R`, `prefix T`, `prefix ,` |
| Close tab | `prefix X` | `prefix &` | `prefix X` | `prefix X` |
| New workspace | `prefix N` | `prefix N` | `prefix N` | `Cmd+N`, `prefix N` |
| Edit workspace | `prefix W` | `prefix $` | `prefix W` | `Cmd+Shift+R`, `prefix W` |
| Next workspace | `prefix }` | `prefix }` | `prefix }` | `prefix }` |
| Previous workspace | `prefix {` | `prefix {` | `prefix {` | `prefix {` |
| Choose workspace | `prefix w` | `prefix s` | `prefix w`, `prefix g` | `Cmd+P`, `prefix w` |
| Select workspace |  |  |  | `Cmd+1–9` |
| Close workspace |  |  | `prefix D` | `Cmd+Shift+W` |
| Find agent | `prefix g` | `prefix G` | `prefix f` | `Cmd+Shift+P`, `prefix g` |
| Choose agent | `prefix a` |  |  | `prefix a` |
| Next agent | `prefix ]` |  |  | `prefix ]` |
| Previous agent | `prefix [` |  |  | `prefix [` |
| Last visited agent | `prefix Tab` |  |  | `prefix Tab` |
| Jump to attention | `prefix f`, `F1` | `prefix F` | `prefix o` | `Cmd+Shift+U`, `prefix f` |
| New agent | `prefix A`, `prefix Ctrl+A` | `prefix a` | `prefix a` | `prefix A`, `prefix Ctrl+A` |
| Mute / unmute sounds | `prefix m` | `prefix m` | `prefix m` | `prefix m` |
| Focus left | `prefix ←`, `prefix h` | `prefix ←` | `prefix h` | `Cmd+Opt+←`, `prefix ←`, `prefix h` |
| Focus down | `prefix ↓`, `prefix j` | `prefix ↓` | `prefix j` | `Cmd+Opt+↓`, `prefix ↓`, `prefix j` |
| Focus up | `prefix ↑`, `prefix k` | `prefix ↑` | `prefix k` | `Cmd+Opt+↑`, `prefix ↑`, `prefix k` |
| Focus right | `prefix →`, `prefix l` | `prefix →` | `prefix l` | `Cmd+Opt+→`, `prefix →`, `prefix l` |
| Swap left | `prefix H`, `prefix Shift+←` |  | `prefix H` | `prefix H`, `prefix Shift+←` |
| Swap down | `prefix J`, `prefix Shift+↓` |  | `prefix J` | `prefix J`, `prefix Shift+↓` |
| Swap up | `prefix K`, `prefix Shift+↑` |  | `prefix K` | `prefix K`, `prefix Shift+↑` |
| Swap right | `prefix L`, `prefix Shift+→` |  | `prefix L` | `prefix L`, `prefix Shift+→` |
| Next pane |  | `prefix o` | `prefix Tab` |  |
| Previous pane |  |  | `prefix Shift+Tab` |  |
| Split right | `prefix v`, `prefix %` | `prefix %` | `prefix v` | `Cmd+D`, `prefix v`, `prefix %` |
| Split down | `prefix -`, `prefix "` | `prefix "` | `prefix -` | `Cmd+Shift+D`, `prefix -`, `prefix "` |
| Resize mode | `prefix r` |  | `prefix r` | `prefix r` |
| Resize left |  | `prefix Ctrl+←` |  | `Ctrl+Shift+H` |
| Resize down |  | `prefix Ctrl+↓` |  | `Ctrl+Shift+J` |
| Resize up |  | `prefix Ctrl+↑` |  | `Ctrl+Shift+K` |
| Resize right |  | `prefix Ctrl+→` |  | `Ctrl+Shift+L` |
| Zoom / unzoom pane | `prefix z` | `prefix z` | `prefix z` | `Cmd+Shift+Enter`, `prefix z` |
| Move pane to a new tab | `prefix !` | `prefix !` | `prefix !` | `prefix !` |
| Close pane | `prefix x` | `prefix x` | `prefix x` | `Cmd+W`, `prefix x` |
| Reopen last closed agent | `prefix u`, `Ctrl+Shift+T`, `Cmd+Shift+T` | `prefix u` | `prefix u` | `Cmd+Shift+T`, `prefix u` |
| Scroll / copy mode | `prefix s` | `prefix [` | `prefix [` | `Cmd+Shift+M`, `prefix s` |
| Paste copied text |  | `prefix ]` |  |  |
| Detach | `prefix q`, `prefix d` | `prefix d` | `prefix q` | `prefix q`, `prefix d` |
| Toggle sidebar | `prefix b` | `prefix b` | `prefix b` | `Cmd+B`, `prefix b` |
| Review changes | `prefix e` | `prefix e` | `prefix e` | `prefix e` |
| Setup | `prefix i`, `prefix C` | `prefix C` | `prefix s` | `Cmd+,`, `prefix i`, `prefix C` |
| All shortcuts | `prefix ?` | `prefix ?` | `prefix ?` | `prefix ?` |

## Review changes

**prefix e** opens the review panel for the focused pane's checkout. Press it
again to focus the panel, and a third time to close it. Esc returns to the pane;
drag the panel's left edge to resize.

| Task | Key |
| --- | --- |
| Review commits and uncommitted changes together | Default view |
| Compare the working copy with HEAD | `u` |
| Pick one commit | `g` |
| Move between file list and diff | Tab |
| Move between hunks | `[` / `]` |
| Search / toggle wrapping | `/` / `w` |
| Select lines / add a note | `v` / `c` |
| Paste notes into the pane / copy notes | `s` / `y` |
| Pin the checkout while changing agents | `p` |
| Show all review keys | `?` |

The default comparison includes changes since the branch diverged from the
default branch. On that branch, it includes work not yet pushed.
**Review changes** on a worktree heading starts a Reviewer agent there and
pins the panel to that checkout.

Pasting notes does not press Enter. For a pane without bracketed paste,
such as a bare shell, notes are copied instead. Notes belong to the viewer
and disappear when it exits. The panel reads Git without modifying the
repository; binary and oversized files show a notice instead of a diff.

## Script Corgi

Commands return JSON; `--text` makes supported output readable. Take IDs from
`corgi list`. `current` means the pane running the command, not UI focus.

```sh
corgi list --text
corgi tab new --workspace 1 --name Tests --command 'bun test src'
corgi pane split current --right
corgi pane read 3 --lines 100 --text
corgi pane send 3 --stdin --enter < /path/to/prompt.txt
corgi focus 3 --viewer 1
```

`pane send` types literal input; `--enter` submits it. `pane close` and
`tab close` terminate their target processes without prompting. Layout changes
do not focus a viewer; `focus` requires an explicit `--viewer` from `list`.
Commands do not implicitly start a missing runtime.

Use `corgi --help` and each command's `--help` for syntax, or `corgi --skill`
for the [bundled scripting guide](../assets/corgi-skill.md).
[Agent internals](agents.md) covers hooks and native provider sessions.

## Settings and troubleshooting

Prefer **Corgi setup** for changes. **Panes → Shell** selects the shell for new
panes; **Theme** changes appearance; **Clever Corgi** controls model-backed
features and Smart Links. Settings and launcher commands survive restarts.

For a standard runtime, state lives under `$XDG_STATE_HOME/corgi`, defaulting
to `~/.local/state/corgi`:

| File or folder | Purpose |
| --- | --- |
| `viewer.json` | Setup completion, keymap, appearance and worktree folder preferences |
| `workspaces.json` | Saved workspace configuration |
| `settings.json` | Runtime settings, including shell and inference choices |
| `recovery/` | Saved layout, terminal output and agent recovery context |
| `account-previews/`, `limit-history/` | Cached account/usage metadata and rate-limit history |

An explicit `CORGI_SOCKET` selects another runtime; its workspace/settings
files live beside the socket. Viewer preferences remain shared. Developer
environments can isolate these paths; see [HACKING](../HACKING.md).
Saved inference choices override inference environment defaults.

| Symptom | First check |
| --- | --- |
| A shortcut goes to the terminal or does nothing | Open `prefix ?`, check the preset and prefix, then check host key forwarding. Reload Ghostty after setup changes its bindings. |
| Mouse selection or links do not work | Hold Shift for terminal selection; use Cmd+Shift-click for Ghostty's native link handling on macOS. |
| Image paste fails, especially over SSH | Open **Corgi setup → Terminal capabilities**. The paste notice identifies missing terminal support, tmux interference or clipboard permission. Text paste is independent. |
| An agent is missing or status is wrong | Run `corgi which codex` or `corgi which claude`, then `corgi integration status`. Codex hooks need trust in `/hooks`; newly installed hooks need a new agent session. |
| Usage says Unavailable | Check the provider's login and the reason shown in the launcher; usage failures do not necessarily prevent launching. |
| Installed Corgi seems out of date | `corgi update status` shows installed/running versions; `corgi update --check` checks for a release without installing it. |
| A release needs reverting | `corgi update rollback` switches to the retained previous release, when available. |

Update commands apply to installed releases. Development or unmanaged builds
use the workflow in [HACKING](../HACKING.md).

For remote work, run `ssh -t host corgi`; detaching or losing the connection
leaves the runtime on that host. Image paste and sound behavior depend on the
outer terminal; plain SSH uses the terminal bell for notifications.

For a bug report, include `corgi --version`, OS, terminal, whether SSH/tmux is
involved, and the shortest reproduction. The runtime's `server.log` sits beside
its socket (normally `/tmp/corgi-UID/server.log`). Logs and recovery files can
contain conversation and terminal contents; inspect excerpts before sharing.
Use the [sandbox and probe workflow](../HACKING.md) for reproducible UI cases.
