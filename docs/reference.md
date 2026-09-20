# Corgi reference

A small terminal multiplexer for agents, written in Zig, using **Ghostty's native Zig VT module**. Corgi owns the PTYs and background runtime. No tmux, worktrees, or workspace model.

## Run

Requires **Zig 0.15.2**, pinned to the Ghostty revision in `build.zig.zon`. The host's Zig 0.16 is not compatible with this dependency. `scripts/zig` selects a matching compiler from `ZIG`, PATH, or the local `.tools/` download.

```sh
./go.sh                        # ReleaseSafe build, then start or attach
./go.sh --restart              # rebuild, stop the old runtime, then start / attach
./scripts/zig build test
python3 tests/smoke.py          # real PTYs + socket tests; mock providers, no inference
```

After building, the executable is `zig-out/bin/corgi`. Its directory is added to each pane's PATH, so `corgi` works inside the terminal. Ordinary `go.sh` preserves the running runtime. Use `go.sh --restart` from outside Corgi to load a new build: it stops that runtime's shells and agents and discards its in-memory snapshots. The build completes before shutdown, so a failed build leaves the current runtime running. With no runtime running, `--restart` starts normally. Put the flag first; further arguments are passed through, e.g. `./go.sh --restart start` restarts detached.

One runtime has a flat list of tabs. Tabs contain binary split trees; pane IDs identify processes and stay stable when you move them. The runtime survives closing the client or losing SSH. **It does not restore sessions after the runtime itself exits or after reboot.**

Multiple viewers can attach at once. They share tabs, focus, menus, scrollback position, and keyboard/mouse control. The shared layout uses the smallest attached width and height, and expands when a smaller viewer detaches or disconnects. `prefix q` detaches only the viewer that typed it. Closing the last pane detaches everyone. Additional viewers preserve the current view and terminal theme; color updates come from the earliest connected viewer that is still attached.

## Tabs and panes

`prefix` means press Ctrl-B, release, then the next key. **Ctrl-B immediately opens a compact command menu**: press a displayed shortcut or click its row. Escape, the menu's `x`, or a click outside dismisses it. Resize has its own clickable direction menu. In short terminals, use the menu's previous/next buttons, the wheel, or PageUp/PageDown to see more commands.

Click **+** after the visible tabs, choose **New tab** from a menu, or press `prefix c` to open the **new tab** dialog. The empty name field previews the new tab's position as a number. Save (Enter) creates an unnamed tab in the current directory unless you type a custom name; Cancel (Escape or clicking outside) creates nothing. Unnamed tabs store no name: their displayed numbers are recomputed as tabs move or close. The + button remains visible when tabs overflow. The CLI/control API still creates tabs immediately, unnamed unless an explicit title is supplied.

Headers show either the custom name or the automatic number, centered in a minimum width of 10 columns. Narrow terminals clip the active tab as needed while keeping **+** accessible.

**Rename tab** uses the same bordered dialog. Type to replace the selection, or move the cursor with Left/Right, Home/End and edit with Backspace/Delete. Ctrl-C, Ctrl-U, or **Clear** empties the field; saving an empty field removes the custom name and restores automatic numbering. The number shown in an empty field is a preview, not saved text. A number you explicitly type is a custom name and stays fixed. Save, Clear, and Cancel are clickable. Cancel leaves the existing name unchanged.

Right-click a tab title for Herdr's tab menu: **New tab**, **Rename**, and **Close**. Actions target the clicked tab; opening or dismissing the menu does not switch tabs. Click a row, or use Up/Down (or j/k) and Enter. Escape or a click outside dismisses it. New tab inherits that tab's current directory and prompts for a name; Close confirms before ending all of that tab's panes.

| Action | Key |
| --- | --- |
| New tab | `prefix c` |
| Split right / down | `prefix v` / `prefix -` |
| Focus left / down / up / right | `prefix h/j/k/l` |
| Swap in a direction | `prefix H/J/K/L` |
| Zoom / unzoom | `prefix z` |
| Resize mode | `prefix r`, then `h/j/k/l`; any other key exits |
| Next / previous tab | `prefix n/p` |
| Jump to tab | `prefix 1–9` |
| Rename tab | `prefix T` |
| Close pane / tab (confirmation) | `prefix x` / `prefix X` |
| Reopen last closed pane | `prefix u` |
| Break pane into its own tab | `prefix !` |
| Scroll/copy mode | `prefix [` |
| Jump to attention | `prefix a` |
| Mute / unmute sounds | `prefix m` |
| Detach, keep processes alive | `prefix q` |
| Help | `prefix ?` |
| Send literal Ctrl-B | `prefix Ctrl-B` |

Click tabs and panes to focus. Drag split dividers to resize. Drag terminal text to select and copy through OSC 52. Mouse-aware terminal applications receive translated mouse input through Ghostty; hold Shift to select text instead. Right-click opens the command menu when the terminal application is not handling the mouse. Wheel scrolling enters scroll mode. In scroll mode: `j/k`, Ctrl-U/D, PageUp/Down, `g/G`, `/` literal search, `n/N` repeat, `y` or Enter copies the selection (or viewport), `q` exits. Output keeps running while you scroll.

`corgi action move-tab left|right` reorders tabs. `corgi action join N` moves the focused pane into tab N. New tabs and splits created from the UI inherit the shell's current directory.

Exiting a shell immediately removes its pane; an empty tab disappears too. Corgi keeps the last **eight closed panes** in memory, including terminal output and scrollback, the tab name, and the last observed working directory. `prefix u` (or `corgi action undo-close`) restores the most recent one into a new tab with a **fresh shell**, not the old process or agent session. Closing the last tab automatically detaches and returns to the outer terminal. Run `./go.sh` to reattach with a new shell, then `prefix u` to restore a snapshot. Snapshots and native agent sessions remain in the background runtime until it shuts down.

This is an initial implementation of Herdr's core tab/pane operations. Copy mode is intentionally smaller: it does not yet reproduce all of Herdr's vi word motions, keyboard selection, smart-case search, or configurable bindings. There is one interactive client per runtime; a second attach is rejected rather than stealing input ownership. Limits: 24 tabs, 64 panes, 16 native provider processes, 10,000 scrollback lines per terminal.

## Agent integration

The left sidebar lists agents across all tabs in tab order. Each entry has two rows: a colored status circle followed by the working directory, then an activity icon beneath the circle and the agent name. The activity icon is blank when idle, 🧠 while thinking, and 🔧 during a known tool call or its approval prompt. Paths under your home use `~`; long paths are shortened from the left so the current directory remains visible. Hook-reported directories take precedence over the foreground process directory; native sessions show their launch directory. Tab names, tool names, and routine lifecycle messages are omitted.

The indicators match Herdr's dot style: yellow filled circle for working, red filled circle for blocked, teal filled circle for an unseen completion, green hollow circle for idle, and a muted dot for unknown. Corgi adds a muted purple circle for initialization, with no activity icon; ended native sessions use a muted hollow circle. Click either row to focus its pane and acknowledge attention. Ordinary shells are omitted. Use the header arrow or `prefix b` to collapse/expand it; it also hides automatically in narrow or short terminals. Scroll with the wheel or the footer arrows when the list fills the screen.

Terminal agents are discovered from each pane's foreground process group, including native binaries and CLI scripts launched with Bun, Node, or Python. Ordinary shells are omitted, and an agent disappears when its process returns to the shell. Native App Server/stream sessions appear separately and use their protocol events. Clicking a native entry shows the command to inspect its events; it does not answer or dismiss pending approvals. State changes update the sidebar even when the agent's tab is hidden.

Inside a pane:

```sh
claude
codex
claude --resume SESSION_ID
claude --remote-control
codex resume SESSION_ID
```

At runtime startup, Corgi merges its hooks into `~/.codex/hooks.json` and `~/.claude/settings.json` when those provider directories exist. `CODEX_HOME` and `CLAUDE_CONFIG_DIR` are respected. It preserves other settings and hook handlers, saves the original file beside it as `.corgi-backup`, and writes atomically. Repeated startup does not duplicate hooks or rewrite unchanged files. Malformed files and symlinks are left untouched, with a diagnostic in the status bar/server log. Restart Corgi after first installing a provider. Hook setup applies to newly launched agent sessions.

The installed commands use the pane's `CORGI_BIN`, `CORGI_SOCKET`, and `CORGI_PANE`; they do nothing outside Corgi. No aliases or executable shims are needed. Provider flags, login, model selection, inference, resume, and native remoting remain available. Permission policies and project configuration are unchanged.

Codex requires trusting new hook definitions in its `/hooks` UI. Corgi does not bypass hook trust, approvals, or disabled-hook settings. Until hooks arrive, strong visible prompt signals supply debounced working/waiting/idle status. New processes remain in initialization until their first recognized prompt or hook: title spinners alone never mean working, and fallback turn detection waits for the first stable idle prompt. Hook events take precedence once received; output activity alone never means a turn finished.

`corgi hooks claude|codex` prints hook configuration for inspection or your own integration. `corgi agent claude|codex ...` remains an optional executable-discovery launcher; it no longer injects duplicate hooks.

The optional launcher and native App Server sessions find Codex automatically: working executables on PATH first, then common user/system installation locations, then macOS app bundles in `~/Applications` and `/Applications` (including Codex and ChatGPT). Candidates must successfully answer `--version`; broken package wrappers, missing binaries, and hung commands are skipped. Run `corgi which codex` to see the selected executable. Plain `codex` uses your shell's usual command resolution.

Optional explicit `CORGI_CODEX_BIN` / `CORGI_CLAUDE_BIN` overrides remain available for development, set before starting the runtime.

Hook evidence drives working, waiting, idle, and done. Session IDs and event timestamps reject late updates from a previous session; child-agent hooks cannot overwrite the parent's lifecycle. Permissions and explicit user questions are waiting states. Tool names provide bounded activity labels. No transcript scraping or background summarization inference.

Provider contracts: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude hooks](https://code.claude.com/docs/en/hooks).

## A ding with somewhere to go

- **Needs you:** macOS Glass sound; sticky `! needs you` marker.
- **Turn finished:** quieter Pop sound; sticky `+ done` marker.
- `prefix a` visits waiting panes first, oldest first, then completed panes. Visiting acknowledges the marker without changing the agent's actual state.
- The focused pane stays quiet while the attached terminal has focus. Focus reporting depends on the outer terminal supporting it.
- Duplicate hooks don't ring twice. Bursts are coalesced, with at least 1.5 seconds between sounds and waiting taking precedence.
- Muting suppresses sounds while retaining the attention queue. `CORGI_BELL=terminal` selects BEL; `CORGI_BELL=off` disables client sounds. Other platforms use BEL.

Sounds play on the attached machine. A detached runtime retains attention markers but does not send desktop notifications. Native protocol sessions also contribute to the attention count; `prefix a` identifies the session and command to inspect it.

## Native agent protocols

For integrations that should not type into a terminal, Corgi can own durable provider processes independently of panes:

```sh
corgi native start codex
# => {"ok":true,"session":1,"provider":"codex"}
corgi native send 1 '{"id":1,"method":"thread/start","params":{}}'
corgi native events 1
# Read the returned provider thread.id, then:
corgi native send 1 '{"id":2,"method":"turn/start","params":{"threadId":"THREAD_ID","input":[{"type":"text","text":"Explain this project"}]}}'
corgi native events 1 10    # events after Corgi sequence 10
corgi native list
corgi native stop 1
```

This path uses **Codex App Server**, not Exec Server. Corgi performs the initialize/initialized handshake and queues requests until it completes. The provider's JSON-RPC messages remain intact: thread start/resume/fork, turn start/steer/interrupt, models, approvals, and supported remote-control methods are available through the same transport. See the [App Server protocol](https://developers.openai.com/codex/app-server).

For Claude, `corgi native start claude` launches its bidirectional streaming CLI with the host permission channel. Send SDK-compatible control/user messages with `native send`, inspect stream events with `native events`. For example, initialize with:

```sh
corgi native send 2 '{"type":"control_request","request_id":"init-1","request":{"subtype":"initialize"}}'
corgi native send 2 '{"type":"user","message":{"role":"user","content":"Explain this project"}}'
```

Native sessions expose protocol messages, not a custom chat UI. Approval/user-input requests remain in `pending_requests` until you send an explicit matching provider response. **Nothing auto-approves.** The event journal retains the latest 128 messages within 4 MiB and exposes `first_seq`/`next_seq` so consumers can detect eviction. Each event's `line` is the original JSON message, encoded as a string. Pending requests are stored separately, so event rotation cannot silently discard an unanswered approval. These are process-local buffers, not disk archives. Provider protocol/version compatibility remains the provider's responsibility; Claude's control channel is less stable than its documented terminal interface.

## Control API

All operations use newline-delimited JSON on a private Unix socket. By default: `/tmp/corgi-UID/control.sock`. Set `CORGI_SOCKET` to select another runtime in its own private directory. Direct `serve` runs the server in the foreground; ordinary startup handles locking and stale socket recovery.

```sh
corgi new 'bun run dev'
corgi split right
corgi list
corgi send 3 'run the tests' --enter
corgi read 3
corgi focus 3
corgi action rename api
corgi action attention
corgi shutdown              # ends this runtime and all its processes
```

`send` writes literal terminal input; `--enter` explicitly submits it. It is not a semantic provider RPC. `rpc JSON` exposes the underlying operations used by the CLI: `new`, `split`, `list`, `focus`, `close`, `send`, `read`, `action`, `hook`, `native.start/list/send/events/stop`, `ping`, `shutdown`. Pane and native-session IDs are separate namespaces.

For remote terminals, run Corgi on the host through SSH (`ssh -t host corgi`); the runtime persists there when the connection drops. Provider remoting can also be enabled through the native CLI/App Server interfaces. Corgi itself does not expose an unauthenticated TCP listener.

## Layout

- `layout.zig`: pure split tree, tab and pane identity, geometry, navigation.
- `terminal.zig`: PTYs, Ghostty parser/render state, selections and search.
- `server.zig`: runtime, input routing, bounded Unix-socket clients.
- `render.zig` / `client.zig`: terminal presentation, attach, clipboard, sound.
- `commands.zig`: command menu layout, shortcut labels, and mouse targets.
- `name_dialog.zig`: tab name editor and dialog rendering/mouse targets.
- `sidebar.zig`: agent list presentation, scrolling, and mouse targets.
- `agents.zig` / `integration.zig`: hook lifecycle evidence and provider launch configuration.
- `discovery.zig`: automatic provider executable discovery and bounded version checks.
- `native.zig`: durable App Server / Claude JSONL transports and retained approvals.
- `os.zig`: Unix/macOS boundary.

macOS arm64 is the exercised platform. Cross-compilation to x86_64 Linux passed; Linux runtime behavior still needs validation. Windows, graphics-protocol rendering, daemon restart recovery, and multi-client terminal views are not implemented.
