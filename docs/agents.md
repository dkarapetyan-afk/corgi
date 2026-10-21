# Provider integration

Start with [HACKING.md](../HACKING.md#architecture) for the runtime map.
[Launching agents](agent-launcher.md) and [workspaces](workspaces.md) describe
the user interface. This page covers the contracts behind it.

## Conversation ownership

The daemon owns one [conversation actor](../src/conversations.ts) per provider
and session ID. An actor holds lifecycle, completion/read receipts, transcript
identity and activity independently of whether a pane currently shows it.

An attachment represents a terminal or headless transport's current selection.
Switching from A to B changes the attachment, not A's identity. Attachments that
select the same actor share its receipts. Before identity is known, screen
observations may supply provisional status. Process replacement clears the old
source associations.

Workers receive snapshots and return observations; the daemon applies them to
the addressed actor after checking identity and generation. Delayed results from
before a selection change must not update its replacement, including A → B → A.
Headless approvals retain their original conversation and transport ownership.

`corgi headless start PROVIDER PROMPT` sends the first prompt and waits for
the provider's session ID. Later `send`, `events` and `stop` commands take
`PROVIDER SESSION`; Corgi does not return another numeric session ID.
Startup stays asynchronous and its pending reply survives live handoff.
The numeric transport handles in snapshots and saved state are internal
bookkeeping for viewer selection and ordering. See [CONTEXT.md](../CONTEXT.md).

`conversation.list` and `session.snapshot` expose actors separately from panes.
Pane acknowledgements include conversation identity and binding generation so
stale selections cannot mark a different conversation read. Runtime-local actor
IDs survive checkpoint restoration but are not globally unique.

## Providers

Each provider is one plain object, `adapter` in
`src/providers/<name>/index.ts`, and everything specific to it lives in that
directory. [providers.ts](../src/providers.ts) lists them in UI order; the
first is the one Corgi offers before the user picks one. Core code asks
`adapter(id)` and never names a provider. A provider calls its own modules
rather than looking itself up.

[adapter.ts](../src/providers/adapter.ts) is the contract. Every provider says
what it is (names, command, install locations, `owns`), the few `caps` core has
to know, how to read its hooks and launcher commands, how to start, resume,
attach to and fork a session, and how it runs headless sessions, the
tool-less summarizer and its hook integration. Optional members exist only
where a provider has one: a title reader, hook origin, transcripts, an
observer of its own protocol, rename, and the launcher's account and history.
Shared helpers sit beside the contract: the hook codec, screen readings and
watcher, hook settings files, typed command lines and observer snapshots.

Each provider judges its own clues through a `Watcher`, one per provider and
account. It routes each hook to the pane whose conversation it is, since only
the provider knows when a hook names the wrong pane, and reads its panes'
screens for what its hooks leave out: a state before any hook speaks, a
compaction, a turn interrupted without a hook, a prompt answered, a
permission prompt shown. Core keeps what the watcher remembers about each
pane and applies what it decides.

Headless sessions and summaries run through a `Client` the adapter starts,
which runs the provider however it does (Claude and Codex as a child process,
on [stdio.ts](../src/providers/stdio.ts)) and speaks its protocol. Core sends
it `Input`, a prompt, an answer to a request or an interrupt, and takes back
`Event`s: conversations, turns, messages, tools, requests and usage. Provider
JSON never leaves the adapter. A summary is a prompt and the last message
before its turn ends. `save` keeps what a checkpoint or handoff needs, and a
handoff passes the client's `handles` to the next daemon.

A provider's `index.ts` must not statically import a module that imports
`./providers` while loading (discovery, inference, usage, launch). Those load
with `import()`, or loading fails with "Cannot access 'adapter' before
initialization". `providers/sim` exists only in tests; `sim.register()` adds it
so a test finds code that still assumes Claude or Codex. `native/hook.zig` and
`native/zig/detection.zig` keep small copies of the hook origin and executable
checks, since they run without the adapters.

## Resuming and forking

A resume or fork starts the agent with the permission mode and model its hooks
last reported. The resume hint keeps them across reloads and closed agents.
Until a hook reports, an agent the launcher started keeps the launch's yolo
choice.

For an agent typed into a pane's shell, Corgi reads the process's command line
and environment. `launch.keep` saves the options and variables that pick an
account, MCP servers or features, and drops the session, prompt, model and
permission flags. Kept variables, credentials included, go into the 0600
checkpoint and the pane's environment, never onto a command line. Codex's hooks
report any run that never asks as bypassing permissions, so a typed Codex
command's own approval and sandbox options win over a reported bypass. macOS
hides the environment of system binaries, so an agent started through a system
`/bin/sh` script keeps only its options.

## Observations and lifecycle

Hooks, transcript readers, the Codex observer, headless transports and terminal
screens supply different evidence. Fresh structured evidence takes precedence
over screen inference. An unavailable source is not a completion event; idle
screen text alone must not create completion receipts or sounds.

- A hook `SessionStart` can select a conversation. Later events for a known
  conversation may update it without switching the pane back to it.
- Background Claude processes can inherit `CORGI_PANE`; that alone does not
  authorize them to take over the pane's selected conversation.
- Completion checking validates the transcript's session and turn. A Stop
  hook or assistant message alone is not proof that the turn finished.
- Headless events use explicit conversation identity. A transport exiting does
  not imply that its conversation ended.
- Live reload preserves bindings. Cold recovery preserves identity and receipts
  but requires fresh evidence for active lifecycle state.

Claude can be paused awaiting a background command or scheduled wakeup. Keep
that distinct from completed or awaiting user input. Source-specific handling
belongs in [agents.ts](../src/agents.ts), [observer_service.ts](../src/observer_service.ts)
and the provider adapters, not UI label comparisons.

## Children, usage and context

Parent links must be provider-consistent, deduplicated and cycle checked.
Codex child listings and Claude subagent observations feed the conversation
registry. Failed discovery must not erase previously known children. Keep child
identity separate from whichever parent a transport currently displays.

Three measurements have different lifetimes:

| Measurement | Meaning |
| --- | --- |
| Workspace away counters | New tool/token activity since a focused viewer last watched the workspace. |
| Live usage | Observed input/output for an agent and its descendants; watching does not reset it. |
| Context occupancy | Latest model-call context relative to its reported or inferred window. |

Count each child's own usage once; cached input is part of input, not additional
tokens. Initial transcript history normally establishes a baseline. Missing
history, counter resets or source gaps mean partial coverage (`≥`), not an
invented total; unknown usage remains unknown. These observations are distinct
from provider account rate limits.

Context comes from provider records, not summed lifetime usage. Model aliases
and platform-specific IDs normalize at the provider boundary; unknown IDs stay
recognizable. Provider-specific assumptions and exceptions belong in the
adapters. Live meters are not a durable ledger.

## Inference and data boundaries

Activity summaries, worktree briefs and link names share a private inference
worker. Its provider can differ from the agent being observed. Saved inference
settings override environment defaults; [inference/setup.ts](../src/inference/setup.ts)
owns that precedence and [inference/harness.ts](../src/inference/harness.ts) owns
the persistent provider conversations.

Requests carry bounded current evidence. Activity summaries receive commentary
and tool descriptions, not tool output; link naming can include visible terminal
text. Worktree briefs use commits and a trimmed diff. Names and summaries are
model guesses, never lifecycle evidence or verified page titles.

Helper conversations must remain outside the visible agent registry and produce
no attention notifications. The harness restricts provider tools and MCP access;
unexpected approvals fail requests. Timeouts and protocol failures discard the
affected conversation. Callers must tolerate lost model history and validate
returned text before applying it to the current actor/turn.

Hook installation edits provider configuration atomically, keeps backups and
preserves unrelated settings. It respects `CODEX_HOME` and `CLAUDE_CONFIG_DIR`.
Account previews use provider interfaces; Claude owns its credentials and login
UI. See [agent-launcher.md](agent-launcher.md) for account behavior and
[reference.md](reference.md) for inspecting or uninstalling integrations.

Summary diagnostics contain private evidence in the runtime's local `server.log`.
Checkpoints contain retained terminal output. Crash reporting is a separate
release-build facility; see [debugging](../HACKING.md#debug). Do not treat these
files as safe public attachments.

## Tests

Use adjacent unit tests for reducers, stale observations, receipts, usage and
provider decoding. [tests/provider_sim.ts](../tests/provider_sim.ts) supplies
controlled provider doubles for process-level scenarios, including reordered
events; they are not complete vendor emulators.

[tests/README.md](../tests/README.md) owns build/run commands. Relevant suites
include `conversations`, `codex_titles`, `subagents`, `activity_summary`,
`inference_reload` and `reloads`. [evals/README.md](../evals/README.md) covers
optional live summary evaluation. Ordinary tests do not contact models.
