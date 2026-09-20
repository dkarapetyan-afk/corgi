# Wrangler

A minimal terminal multiplexer for coding agents, written in Zig with Ghostty's terminal engine.

Requires **Zig 0.15.2** on your PATH (or set `ZIG=/path/to/zig`). Tested on macOS Apple Silicon.

From this directory:

```sh
./go.sh
```

This builds Wrangler and starts or attaches to its background runtime. No configuration required.

- **Ctrl-B** opens the clickable command menu and shows shortcuts.
- Click **+** to create a tab; right-click a tab to rename or close it. Unnamed tabs show their current position; clear a name to return to automatic numbering.
- **Ctrl-B**, then **v** or **-** splits right or down.
- **Ctrl-B**, then **q** detaches while keeping your shells running. Run `./go.sh` to return.
- Closing the last tab returns to your outer terminal. Closed-pane snapshots remain available after reattaching.
- The **agent sidebar** shows live status and activity. Click an agent to jump to its pane; **Ctrl-B**, then **b** toggles the sidebar.

Run agents normally inside a pane:

```sh
codex
claude
```

Wrangler detects agents automatically, including Bun and Node launches, and sets up hooks in existing Codex/Claude settings directories. Existing settings are preserved, with a backup before editing. Codex may ask you to trust the hooks in `/hooks`.

To load code changes, run `./go.sh --restart` from outside Wrangler. This ends the old runtime's shells and agents; sessions do not survive a runtime restart.

Tests: `./scripts/zig build test` and `python3 tests/smoke.py` (after building).

See the [reference](docs/reference.md) for all controls and agent APIs.
