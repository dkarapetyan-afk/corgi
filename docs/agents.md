# Provider integration

Start with [HACKING.md](../HACKING.md#architecture) for the runtime map.
[Launching agents](agent-launcher.md) and [workspaces](workspaces.md) describe
the user interface. This page covers the contracts behind it.

## Conversation ownership

The daemon owns one [conversation actor](../src/conversations.ts) per provider
and session ID. An actor holds lifecycle, completion/read receipts, transcript
identity and activity independently of whether a pane currently shows it.

An attachment represents a terminal or native transport's current selection.
Switching from A to B changes the attachment, not A's identity. Attachments that
select the same actor share its receipts. Before identity is known, screen
observations may supply provisional status. Process replacement clears the old
source associations.

Workers receive snapshots and return observations; the daemon applies them to
the addressed actor after checking identity and generation. Delayed results from
before a selection change must not update its replacement, including A → B → A.
Native approvals retain their original conversation and transport ownership.

`conversation.list` and `session.snapshot` expose actors separately from panes.
Pane acknowledgements include conversation identity and binding generation so
stale selections cannot mark a different conversation read. Runtime-local actor
IDs survive checkpoint restoration but are not globally unique.

## Observations and lifecycle

Provider metadata and parsing live in [providers/](../src/providers/), selected
through [providers.ts](../src/providers.ts). Extend that vocabulary rather than
adding provider-name checks or copies elsewhere.

Hooks, transcript readers, the Codex observer, native transports and terminal
screens supply different evidence. Fresh structured evidence takes precedence
over screen inference. An unavailable source is not a completion event; idle
screen text alone must not create completion receipts or sounds.

- A hook `SessionStart` can select a conversation. Later events for a known
  conversation may update it without switching the pane back to it.
- Background Claude processes can inherit `CORGI_PANE`; that alone does not
  authorize them to take over the pane's selected conversation.
- Completion checking validates the transcript's session and turn. A Stop
  hook or assistant message alone is not proof that the turn finished.
- Native events use explicit conversation identity. A transport exiting does
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
recognizable. Provider-specific assumptions and exceptions belong in
[usage/](../src/usage/) and the adapters. Live meters are not a durable ledger.

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
