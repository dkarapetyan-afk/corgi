# Developing Corgi inside Corgi

The work is split into three commits/milestones. Stop after each milestone for a
manual restart and user check before continuing.

1. **Runtime interface (this milestone).** Session resources live in
   `runtime.zig`; protocol 1 exposes session data and terminal surfaces separately
   from presentation. The existing daemon-rendered UI and legacy commands still
   work. This milestone does not change viewer focus behavior or enable handoff.
2. **Viewer-owned UI.** Move composition, menus, dialogs, and interaction into
   the viewer. Workspace/tab order and split arrangement remain shared. Selected
   workspace, selected tab, focused pane, and transient presentation state belong
   to each viewer. Keep selection by ID and reconcile it when another viewer
   closes or moves its target. PTY sizing must account for which panes each
   viewer actually displays; a hidden viewer selection must not steal input or
   resize unrelated panes.
3. **Live daemon handoff.** Drain accepted writes, pause I/O, transfer PTYs and
   native-session pipes to a replacement executable, restore state, commit
   ownership, and reconnect viewers. Preserve process IDs; rollback before
   commit on failure. Never turn a failed reload into a destructive restart.

Normal shutdown remains destructive until milestone 3. An already-running old
daemon cannot gain export support just because a new executable has been built.

## Protocol 1

The Unix socket still accepts newline-delimited JSON. Existing operations retain
their behavior. New operations require either `"protocol":1` on each request or
an earlier `{"op":"hello","protocol":1}` on the same connection. The hello
reply includes `protocol`, `server_pid`, and a list of supported operation names
in `capabilities`. Unsupported versions are rejected before performing operations.
Future viewers must negotiate capabilities, tolerate additional response fields,
and treat missing capabilities as unavailable rather than restarting the daemon.

Examples (these inspect/control the selected `CORGI_SOCKET`):

```sh
corgi rpc '{"op":"hello","protocol":1}'
corgi rpc '{"op":"session.snapshot","protocol":1}'
corgi rpc '{"op":"pane.surface","protocol":1,"pane":1}'
```

| Operation | Required target/data | Result |
| --- | --- | --- |
| `session.snapshot` | None | A `type: "session"` snapshot |
| `session.subscribe` | None | Initial session snapshot, then coalesced replacement snapshots |
| `pane.surface` | `pane` | A `type: "surface"` response |
| `pane.input` | `pane`, `data` string | Write the supplied terminal bytes to that pane |
| `pane.create` | `workspace` | Create a tab and return `pane` without selecting it |
| `pane.split` | `pane`, `axis: "right"` or `"down"` | Split that pane and return the new `pane` without selecting it |
| `pane.close` | `pane` | Close that pane and retain its closed-output snapshot |
| `tab.rename` | `tab`, `title` | Rename that tab; empty title restores automatic numbering |
| `split.resize` | `pane`, `direction: "left"`, `"right"`, `"up"`, or `"down"` | Adjust the enclosing split without changing selection |

Creation accepts optional `cwd`, `command`, and `title`; the workspace directory
is the default. Pane input is already-encoded terminal input, not UI shortcuts,
paste wrapping, or automatic keyboard-protocol translation. It requires an
explicit target on every request. A future viewer must hold the starting pane ID
for the duration of a bracketed paste.

Session snapshots include stable workspace/tab/pane IDs, names, directories,
split trees, pane PIDs and sizes, agent metadata, native sessions, and the number
of retained closed panes. A split tree contains either `{"pane":ID}` or
`{"split":{"axis":"horizontal"|"vertical","ratio":500,"first":NODE,"second":NODE}}`.
Ratios are thousandths. No selected workspace/tab/pane or zoom state appears in
this shared snapshot. The legacy UI still stores its selection in layout models
internally until milestone 2 moves it out.

Snapshots carry `server_pid` and a runtime `revision`. Revisions can skip and
include output/presentation invalidations; clients replace the snapshot rather
than interpreting them as a durable event log. A subscription does not attach a
viewer, create a shell, or change sizing/focus. It remains open across idle
periods. Slow subscribers get coalesced updates after their pending message is
flushed. Reconnect and obtain a new initial snapshot after connection loss.
The one-shot `corgi rpc` CLI reads only the first reply; subscriptions require a
persistent socket client. Do not mix subscriptions with legacy `attach`.

Surface responses carry the same server/revision fields and a `surface` object:
`pane`, `cols`, `rows`, `lines`, and a nullable zero-based `{x,y}` cursor. Each line
contains SGR-styled terminal text, starts with its own style, and ends in SGR
reset. It contains no cursor movement or surrounding Corgi UI. The viewer places
these lines and controls cursor visibility. The surface is the latest completed
Ghostty render (possibly empty before the first completed synchronized redraw).
It currently uses the legacy shared scroll viewport; per-viewer scrolling is
part of milestone 2. Reading a surface does not select or acknowledge the pane.

## Terminal restoration findings

`src/checkpoint_probe.zig` characterizes the pinned Ghostty formatter through
in-memory replay into a fresh terminal. It is test-only, not a live checkpoint
implementation.

- With all formatter extras, retained primary history can exceed 8 KiB and
  replay with current input modes and keyboard flags. The handoff need not copy
  Herdr's 8 KiB truncation.
- Global extras such as tabstops can move the replay cursor after the screen
  formatter restores it. The probe restores cursor coordinates last, using the
  default origin mode; non-default origin/margins still need validation.
- Formatting the active alternate screen preserves its contents and active
  mode, but omits the inactive primary screen. Handoff needs both screens.
- Current Kitty keyboard flags survive, but the push/pop stack does not.
- A partial escape such as `ESC [ 31 ;` is not part of formatted terminal state.
  Passing the remainder to a fresh parser corrupts its interpretation.

Milestone 3 must preserve both screens, keyboard stack, and incomplete parser
input (including UTF-8 and OSC/DCS), or explicitly reject a handoff that cannot
be restored safely. A text/ANSI dump alone is insufficient. Validate cursor
save/restore, wrapping, origin/margins, colors, resize, native request buffers,
and imported-child exit detection as part of that milestone.

## Milestone 1 manual check

After saving work, run `./go.sh --restart` from outside Corgi. This is an ordinary
restart and ends the existing runtime's panes. Check tabs/splits, tab dragging
and rename, workspace switching, enhanced keyboard input, paste, wheel scroll,
mouse selection, agent indicators, and detach/reattach. Multiple viewers still
share selection in this milestone. The new independent selections arrive in 2.
