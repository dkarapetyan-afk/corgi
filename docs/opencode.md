# OpenCode

Choose **OpenCode** in New agent, or run `opencode` inside a Corgi pane.
Corgi discovers `~/.opencode/bin/opencode2` and the v2 `opencode` executable.
`CORGI_OPENCODE2_BIN` overrides discovery. OpenCode keeps its existing login;
Corgi neither copies credentials nor installs global hooks.

Corgi launches OpenCode with its tab list and details sidebar hidden, using
`OPENCODE_CLI_CONFIG_CONTENT`. An existing value of that variable takes precedence.

Manage agents lists OpenCode alongside the other agents, with default-row
renaming and global or per-workspace visibility. Account creation and guided
sign-in are not offered: manage OpenCode's existing login in OpenCode itself.

The adapter targets the v2 API, tested with OpenCode 2.1.2. It supports:

- New terminal sessions, history, resume, fork and rename. Fork requires a
  session with messages. Model and `--auto` choices survive resume.
- Session state, completion notifications, tool activity, model, token usage,
  context window use, edited files, activity evidence and direct subagents
  through the local API, refreshed as its event stream reports changes.
- Terminal compaction status, including completion and cancellation, through
  the same observer.
- Headless prompts, steering, interrupts, permission replies and forms.
  Form answers use a JSON object in the answer's `message` field, keyed by
  the field IDs in the pending request.
- Live daemon handoff without replaying prompts or restarting the API worker.
  Cold recovery retains the session ID for reopening in OpenCode.
- Private inference sessions with all tool permissions denied. They are
  deleted when Corgi closes the inference client. The selected model must
  permit tool-less requests; the OpenCode free tier rejected these during
  live testing. A stored login alone does not establish usable model access.

Clever Corgi's model picker lists OpenCode's enabled text models, with search,
catalog prices and subscription labels from active credentials. Tiny stateless,
tool-less requests check cheap candidates before Auto chooses one. Successes are
cached for ten minutes; failures retry after thirty seconds. Credential changes
clear both caches. Entering Clever Corgi refreshes connection metadata under a
shared three-minute throttle, invalidated by account changes. Each
refresh probes at most four providers and two models per provider. Free or
metered access is tried only when no subscription answers. These checks consume
a small amount of model usage, but create no sessions or use project contents.

Auto chooses the cheapest checked subscription by Corgi's input-heavy price
estimate, then checked free or metered access. Unpriced ChatGPT and Claude
subscriptions try their native adapters' cheap inference defaults first, rather
than an alphabetically first legacy model. Unknown prices sort last; untested
or rejected models never become Auto's fallback. Failed checks are marked in the
picker without treating them as proof that a provider is disconnected. The full
catalog remains available for explicit picks, keeping the exact provider and
model ID.

There are still parity gaps. Terminal identity is established by Corgi at
launch: switching conversations inside OpenCode's own UI, or starting its
absolute executable outside Corgi's alias, cannot reliably rebind the pane.
`--standalone` and `--server` are rejected for managed terminal launches because
the observer follows the local service. Custom account/configuration contexts
are not propagated to the daemon observer. Context-window utilization is the
last model call's tokens against the model's context limit in the catalog;
models the catalog does not list report none. Background terminals, headless
compaction status and nested subagent trees are not reported. Headless input follows Corgi's existing prompt interface (steering);
a separate queue control is not exposed.

The launcher reads the model OpenCode's TUI last selected and names it from
OpenCode's own catalog, so free models show their `Free` plan. The TUI saves
each `/model` pick to `model.json` at once, and Corgi watches that file, so
the row changes with the pick rather than with the session's next prompt.
The launcher and model picker share one account lookup: ChatGPT token-sharing
uses the native Codex account, because its credential keeps no readable identity.
Browser OAuth and other providers use their own credentials, never an unrelated
Codex login. The launcher also shows the shared ChatGPT plan and usage.

Corgi talks to OpenCode's background service directly, at the address and
password it advertises in `$XDG_STATE_HOME/opencode/service.json`. Launches,
renames, terminal observers and headless or inference sessions have the
installed CLI start the service when none answers. The CLI's `api` command
loses output past 64 KiB when it writes to a pipe and cannot follow the event
stream.

The model picker, the launcher and resume history never start the service.
While it is down and OpenCode keeps a provider login, they borrow a private
`opencode serve --stdio` server, which exits when its stdin closes, so it
never outlives Corgi, or 30 s after the last read. It uses the catalog the
service last fetched. Without a login they show nothing from OpenCode until
its service runs. History changes seen while the service is down wait for the
next full read, since a private server writes in the folder history watches.

The terminal observer and the API worker follow `/api/event` and refresh a
session when an event names it or one of its subagents. A sweep catches
anything missed (30 s for terminals, 10 s for the worker); while the stream
is down, they poll every second and every 300 ms. The worker's stdio pipes
are transferred during a daemon reload. Observers refresh only known session
IDs; names and terminal text are never read back as identity. Replies and
events are bounded to 8 MiB; oversized contexts fail instead of being
partially counted.

The usage overview takes OpenCode model names and base input/output rates from
`/api/model`, refreshed with the observer's catalog. Catalog rates stay scoped
to their provider and override Corgi's built-in estimates, including explicit
free models. When OpenCode omits rates (as it currently does for some subscription
models), known model IDs use the built-in fallback, ignoring the provider prefix
and reasoning variant. Other unpriced models stay unknown. The equivalent-token
column compares uncached input and output at base rates, not subscription charges
or an exact bill; cache charges and context-tier premiums are not included.

The defaulted `model_price` field extends conversation snapshots without changing
the runtime or viewer protocol version. Catalog metadata is refreshed after a
reload rather than saved, so checkpoint and handoff formats are unchanged.

Runtime protocol 3 adds the provider ID and provider-indexed settings;
management protocol 1 remains independent for discovery and upgrades. Saved
checkpoint and handoff versions are unchanged: the new provider entries
default when reading existing records. Schema snapshots cover the addition.

Run `bun test src/providers/opencode2` and
`bun integration.ts opencode --jobs 1` for deterministic checks. The integration
suite exercises approval, interrupt, token counters, an active-turn reload and
a terminal pane leaving Needs input when its prompt is answered. It runs a
fake service with an event stream and does not make model requests.

API reference: <https://dev.opencode.ai/v2/docs/api>.
