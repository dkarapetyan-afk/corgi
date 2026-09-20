# Wrangler

A minimal terminal multiplexer for coding agents, written in Zig with Ghostty's terminal engine.

Requires **Zig 0.15.2** on your PATH (or set `ZIG=/path/to/zig`). Tested on macOS Apple Silicon.

From this directory:

```sh
./go.sh
```

This builds Wrangler and starts or attaches to its background runtime. No configuration required.

- **Ctrl-B** opens the clickable command menu and shows shortcuts.
- Click **+** to create a tab; right-click a tab to rename or close it.
- **Ctrl-B**, then **v** or **-** splits right or down.
- **Ctrl-B**, then **q** detaches while keeping your shells running. Run `./go.sh` to return.
- The **agent sidebar** shows live status and activity. Click an agent to jump to its pane; **Ctrl-B**, then **b** toggles the sidebar.

Launch an installed agent inside a pane to enable Wrangler's hooks and attention sounds:

```sh
wrangler agent codex
wrangler agent claude
```

Codex is discovered automatically. Provider login and hook-trust prompts still apply.

To load code changes, run `./go.sh --restart` from outside Wrangler. This ends the old runtime's shells and agents; sessions do not survive a runtime restart.

Tests: `./scripts/zig build test` and `python3 tests/smoke.py` (after building).

See the [reference](docs/reference.md) for all controls and agent APIs.
