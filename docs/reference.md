# Wrangler reference

A small terminal multiplexer for agents, written in Zig, using **Ghostty's native Zig VT module**. Wrangler owns the PTYs and background runtime. No tmux, worktrees, or workspace model.

## Run

Requires **Zig 0.15.2**, pinned to the Ghostty revision in `build.zig.zon`. The host's Zig 0.16 is not compatible with this dependency. `scripts/zig` selects a matching compiler from `ZIG`, PATH, or the local `.tools/` download.

```sh
./go.sh                        # ReleaseSafe build, then start or attach
./go.sh --restart              # rebuild, stop the old runtime, then start / attach
./scripts/zig build test
python3 tests/smoke.py          # real PTYs + socket tests; mock providers, no inference
```

After building, the executable is `zig-out/bin/wrangler`. Its directory is added to each pane's PATH, so `wrangler` works inside the terminal. Ordinary `go.sh` preserves the running runtime. Use `go.sh --restart` from outside Wrangler to load a new build: it stops that runtime's shells and agents and discards its in-memory snapshots. The build completes before shutdown, so a failed build leaves the current runtime running. With no runtime running, `--restart` starts normally. Put the flag first; further arguments are passed through, e.g. `./go.sh --restart start` restarts detached.

One runtime has a flat list of tabs. Tabs contain binary split trees; pane IDs identify processes and stay stable when you move them. The runtime survives closing the client or losing SSH. **It does not restore sessions after the runtime itself exits or after reboot.**

## Tabs and panes

`prefix` means press Ctrl-B, release, then the next key. **Ctrl-B immediately opens a compact command menu**: press a displayed shortcut or click its row. Escape, the menu's `x`, or a click outside dismisses it. Resize has its own clickable direction menu. In short terminals, use the menu's previous/next buttons, the wheel, or PageUp/PageDown to see more commands.

Click **+** after the visible tabs, choose **New tab** from a menu, or press `prefix c` to open the **new tab** dialog. The directory name is prefilled and selected. Save (Enter) creates the tab in that directory; Cancel (Escape or clicking outside) creates nothing. The + button remains visible when tabs overflow. The CLI/control API still creates tabs immediately.

**Rename tab** uses the same bordered dialog. Type to replace the selection, or move the cursor with Left/Right, Home/End and edit with Backspace/Delete. Ctrl-C, Ctrl-U, or **Clear** empties the field; saving an empty field keeps the default name. Save, Clear, and Cancel are clickable. Cancel leaves the existing name unchanged.

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

`wrangler action move-tab left|right` reorders tabs. `wrangler action join N` moves the focused pane into tab N. New tabs and splits created from the UI inherit the shell's current directory.

Exiting a shell immediately removes its pane; an empty tab disappears too. Wrangler keeps the last **eight closed panes** in memory, including terminal output and scrollback, the tab name, and the last observed working directory. `prefix u` (or `wrangler action undo-close`) restores the most recent one into a new tab with a **fresh shell**, not the old process or agent session. Closing the last pane leaves an empty view where you can create a tab or undo. Snapshots survive detach/reattach but disappear when the runtime shuts down.

This is an initial implementation of Herdr's core tab/pane operations. Copy mode is intentionally smaller: it does not yet reproduce all of Herdr's vi word motions, keyboard selection, smart-case search, or configurable bindings. There is one interactive client per runtime; a second attach is rejected rather than stealing input ownership. Limits: 24 tabs, 64 panes, 16 native provider processes, 10,000 scrollback lines per terminal.

## Agent integration

Inside a pane:

```sh
wrangler agent claude
wrangler agent codex
wrangler agent claude --resume SESSION_ID
wrangler agent claude --remote-control
wrangler agent codex resume SESSION_ID
```

Wrangler execs the real provider CLI with additional **session-local hooks**. It leaves your user/project configuration files and permission policies intact. Claude gets `--settings`; Codex gets inline hook configuration through `-c`. Provider flags, login, model selection, inference, resume, and native remoting remain available.

Codex requires trusting new hook definitions in its `/hooks` UI. Wrangler does not bypass hook trust or approvals. Managed policies that disable session hooks still apply. Hook collection is best effort and silent; unsupported or disabled hooks leave state unknown, rather than guessing from screen text.

`wrangler hooks claude|codex` prints configuration for inspection or your own integration. You can launch the plain provider commands too, but those do not gain Wrangler's session-local hooks automatically.

Codex is found automatically: working executables on PATH first, then common user/system installation locations, then macOS app bundles in `~/Applications` and `/Applications` (including Codex and ChatGPT). Candidates must successfully answer `--version`; broken package wrappers, missing binaries, and hung commands are skipped. Both terminal agents and native App Server sessions use this lookup. Run `wrangler which codex` to see the selected executable. No environment variables or configuration files are required.

Optional explicit `WRANGLER_CODEX_BIN` / `WRANGLER_CLAUDE_BIN` overrides remain available for development, set before starting the runtime.

Hook evidence drives working, waiting, idle, and done. Session IDs and event timestamps reject late updates from a previous session; child-agent hooks cannot overwrite the parent's lifecycle. Permissions and explicit user questions are waiting states. Tool names provide bounded activity labels. No transcript scraping or background summarization inference.

Provider contracts: [Codex hooks](https://developers.openai.com/codex/hooks), [Claude hooks](https://code.claude.com/docs/en/hooks).

## A ding with somewhere to go

- **Needs you:** macOS Glass sound; sticky `! needs you` marker.
- **Turn finished:** quieter Pop sound; sticky `+ done` marker.
- `prefix a` visits waiting panes first, oldest first, then completed panes. Visiting acknowledges the marker without changing the agent's actual state.
- The focused pane stays quiet while the attached terminal has focus. Focus reporting depends on the outer terminal supporting it.
- Duplicate hooks don't ring twice. Bursts are coalesced, with at least 1.5 seconds between sounds and waiting taking precedence.
- Muting suppresses sounds while retaining the attention queue. `WRANGLER_BELL=terminal` selects BEL; `WRANGLER_BELL=off` disables client sounds. Other platforms use BEL.

Sounds play on the attached machine. A detached runtime retains attention markers but does not send desktop notifications. Native protocol sessions also contribute to the attention count; `prefix a` identifies the session and command to inspect it.

## Native agent protocols

For integrations that should not type into a terminal, Wrangler can own durable provider processes independently of panes:

```sh
wrangler native start codex
# => {"ok":true,"session":1,"provider":"codex"}
wrangler native send 1 '{"id":1,"method":"thread/start","params":{}}'
wrangler native events 1
# Read the returned provider thread.id, then:
wrangler native send 1 '{"id":2,"method":"turn/start","params":{"threadId":"THREAD_ID","input":[{"type":"text","text":"Explain this project"}]}}'
wrangler native events 1 10    # events after Wrangler sequence 10
wrangler native list
wrangler native stop 1
```

This path uses **Codex App Server**, not Exec Server. Wrangler performs the initialize/initialized handshake and queues requests until it completes. The provider's JSON-RPC messages remain intact: thread start/resume/fork, turn start/steer/interrupt, models, approvals, and supported remote-control methods are available through the same transport. See the [App Server protocol](https://developers.openai.com/codex/app-server).

For Claude, `wrangler native start claude` launches its bidirectional streaming CLI with the host permission channel. Send SDK-compatible control/user messages with `native send`, inspect stream events with `native events`. For example, initialize with:

```sh
wrangler native send 2 '{"type":"control_request","request_id":"init-1","request":{"subtype":"initialize"}}'
wrangler native send 2 '{"type":"user","message":{"role":"user","content":"Explain this project"}}'
```

Native sessions expose protocol messages, not a custom chat UI. Approval/user-input requests remain in `pending_requests` until you send an explicit matching provider response. **Nothing auto-approves.** The event journal retains the latest 128 messages within 4 MiB and exposes `first_seq`/`next_seq` so consumers can detect eviction. Each event's `line` is the original JSON message, encoded as a string. Pending requests are stored separately, so event rotation cannot silently discard an unanswered approval. These are process-local buffers, not disk archives. Provider protocol/version compatibility remains the provider's responsibility; Claude's control channel is less stable than its documented terminal interface.

## Control API

All operations use newline-delimited JSON on a private Unix socket. By default: `/tmp/wrangler-UID/control.sock`. Set `WRANGLER_SOCKET` to select another runtime in its own private directory. Direct `serve` runs the server in the foreground; ordinary startup handles locking and stale socket recovery.

```sh
wrangler new 'bun run dev'
wrangler split right
wrangler list
wrangler send 3 'run the tests' --enter
wrangler read 3
wrangler focus 3
wrangler action rename api
wrangler action attention
wrangler shutdown              # ends this runtime and all its processes
```

`send` writes literal terminal input; `--enter` explicitly submits it. It is not a semantic provider RPC. `rpc JSON` exposes the underlying operations used by the CLI: `new`, `split`, `list`, `focus`, `close`, `send`, `read`, `action`, `hook`, `native.start/list/send/events/stop`, `ping`, `shutdown`. Pane and native-session IDs are separate namespaces.

For remote terminals, run Wrangler on the host through SSH (`ssh -t host wrangler`); the runtime persists there when the connection drops. Provider remoting can also be enabled through the native CLI/App Server interfaces. Wrangler itself does not expose an unauthenticated TCP listener.

## Layout

- `layout.zig`: pure split tree, tab and pane identity, geometry, navigation.
- `terminal.zig`: PTYs, Ghostty parser/render state, selections and search.
- `server.zig`: runtime, input routing, bounded Unix-socket clients.
- `render.zig` / `client.zig`: terminal presentation, attach, clipboard, sound.
- `commands.zig`: command menu layout, shortcut labels, and mouse targets.
- `name_dialog.zig`: tab name editor and dialog rendering/mouse targets.
- `agents.zig` / `integration.zig`: hook lifecycle evidence and provider launch configuration.
- `discovery.zig`: automatic provider executable discovery and bounded version checks.
- `native.zig`: durable App Server / Claude JSONL transports and retained approvals.
- `os.zig`: Unix/macOS boundary.

macOS arm64 is the exercised platform. Cross-compilation to x86_64 Linux passed; Linux runtime behavior still needs validation. Windows, graphics-protocol rendering, daemon restart recovery, and multi-client terminal views are not implemented.
