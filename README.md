# Corgi

A multiplexer terminal agent manager, heavily inspired by [herdr](https://github.com/herdrdev/herdr), powered by [Ghostty](https://github.com/ghostty-org/ghostty).


## Development

Requires **Zig 0.15.2** on your PATH (or set `ZIG=/path/to/zig`). Tested on macOS Apple Silicon.

From this directory:

```sh
./go.sh
```

This builds Corgi and starts or attaches to its background runtime.

Multiple terminals can attach to the same runtime. They share the current view and controls; the layout fits the smallest attached terminal. Detaching one viewer leaves the others connected.

- **Ctrl-B** opens the clickable command menu and shows shortcuts.
- Click **+** to create a tab; right-click a tab to rename or close it. Unnamed tabs show their current position; clear a name to return to automatic numbering.
- Drag a tab to reorder it; the vertical marker shows where it will land. Release outside the tab bar or press Escape to cancel.
- **Ctrl-B**, then **v** or **-** splits right or down.
- **Ctrl-B**, then **q** detaches while keeping your shells running. Run `./go.sh` to return.
- With one workspace, closing the last tab returns to your outer terminal. With multiple workspaces, an empty workspace stays open so you can switch or create a tab. Closed-pane snapshots remain available after reattaching.
- The left sidebar is split equally: **workspaces** above, **agents in the selected workspace** below. Click the workspace header **+** to create one; enter just its name to inherit the current workspace’s default folder. Click a workspace to switch, or right-click to rename it. **Ctrl-B w** creates a workspace with just a name, inheriting the current workspace’s folder; **Ctrl-B W** edits it; **Ctrl-B { / }** switches. New tabs and splits use its default folder. Existing panes keep their working directories.
- The **agent sidebar** shows a colored status circle and working directory, with an activity icon and agent name underneath. Click an agent to jump to its pane; **Ctrl-B**, then **b** toggles the sidebar.

Workspaces retain their tabs, focused panes, and running processes while switching or detaching. Workspace names, default folders, and the selected workspace are saved automatically across runtime restarts. Tabs and running processes end on restart. No Git worktrees are involved.

```sh
corgi workspace new Backend ~/dev/backend
corgi workspace list
corgi workspace switch 1
corgi workspace edit 1 Personal ~/dev/personal
corgi workspace close 2  # only when empty
```

Run agents normally inside a pane:

```sh
codex
claude
```

Corgi detects agents automatically, including Bun and Node launches, and sets up hooks in existing Codex/Claude settings directories. Existing settings are preserved, with a backup before editing. Codex may ask you to trust the hooks in `/hooks`.

To load code changes, run `./go.sh --restart` from outside Corgi. This ends the old runtime's shells and agents; sessions do not survive a runtime restart.

Tests: `./scripts/zig build test` and `python3 tests/smoke.py` (after building).

See the [reference](docs/reference.md) for all controls and agent APIs.
