# Starting and resuming agents

Use **New ▾** in the sidebar or **prefix c** to open the picker. It starts an
agent or terminal in a new tab. You can also run `claude` or `codex` in any
pane; Corgi discovers them automatically.

## Start an agent

Choose a provider and press Enter. **New** repeats the workspace's last provider,
falling back to the last provider used anywhere, then Codex. **New terminal**
(or `t` in the picker) starts a shell without changing that choice.

The picker title names the destination. It follows the focused agent's checkout
when that agent works in a linked worktree; otherwise it uses the focused pane's
directory, falling back to the workspace directory. Press `w` to choose or
plan a worktree; see [Create or choose a worktree](workspaces.md#create-or-choose-a-worktree).
Nothing is created merely by browsing.

Built-in providers appear when installed and not known to be signed out.
An inconclusive account check does not hide them. Use `corgi which codex` or
`corgi which claude` to inspect binary discovery. `CORGI_CODEX_BIN` and
`CORGI_CLAUDE_BIN` can select explicit executables before runtime startup.

Each provider has its own **YOLO** checkbox, initially off. Click it or press
`y` on that row to change it; this does not launch anything. The choice is
remembered across viewers and recovery:

| Provider | Flag enabled by YOLO |
| --- | --- |
| Codex | `--dangerously-bypass-approvals-and-sandbox` |
| Claude Code | `--dangerously-skip-permissions` |

With YOLO off, the provider's normal permission settings apply. Launcher model
previews reflect provider configuration; Corgi does not override the interactive
agent's model with its own activity-summary model.

## Resume or find a conversation

The picker lists recent closed conversations from its destination folder.
Enter resumes one in a new tab. **Show more** or `/` opens the full history;
search matches titles and prompts/messages. Tab broadens the scope from this
folder to the workspace to everywhere. Esc clears search, then collapses it.
Selecting a conversation already running focuses its existing pane.

A recoverable recently closed agent returns with its saved command and output.
Otherwise Corgi uses the provider's resume command and the launcher's provider
flags. Resuming does not change the provider that **New** repeats.
A Claude session still running in Claude's background daemon is attached
instead; closing that tab leaves the background session running.

**prefix u** reopens the last recoverable closed agent in the workspace.
Corgi keeps up to eight; closed shells and agents without a known session ID
cannot be reopened this way. Recovery after a crash restores recorded agents
asleep; focusing their panes starts the resume command.

History excludes SDK runs and subagents. The short recent list also omits
commit-only conversations, which search can still find. Conversations whose
folders no longer exist cannot be resumed from this list. An agent that exits
with an error leaves its last output and exit code visible until its tab closes.

## Save a launch command

Choose **Manage agents** or press `m` in the picker:

1. Paste a command and review its resolved command, account, model and permissions.
2. Adjust its suggested name, then choose **Add**.
3. Use **Edit**, the Show checkbox or **Delete** to change the saved entry.

Editing a built-in creates a custom entry and hides its default row.
Up to six commands can be saved, each up to 2,048 bytes. Names and visibility
are shared across viewers and survive reload and recovery.

For example, `MY_PROJECT=demo claude --model opus` preserves the environment
assignment and arguments. Preview resolves aliases and simple forwarding
functions from shell startup configuration; saving freezes that expansion.
Later alias changes do not change an existing saved command. Editing and
saving its command source resolves it again.

Preview does not execute the agent command. Complex shell functions are rejected;
paste their underlying command instead. Launch uses an interactive, non-login
shell, so definitions belong in `.bashrc`, `.zshrc` or fish configuration,
not only in another running shell. Normal variable expansion happens at launch.

Custom commands keep their own options and account/profile settings.
Built-in YOLO toggles do not rewrite them. A custom profile is not hidden merely
because the default provider account is signed out.

## Accounts and usage

The picker shows available model, account, plan and rate-limit information.
Unknown configuration stays **Provider default**; unknown account information
stays unknown. Opening the picker does not send a model prompt.

Usage percentages mean **used**, followed by a reset countdown where available.
Missing limits are omitted; a reported zero remains visible. Recent cached
readings can remain visible after a failed refresh. Once too old, they show
**Unavailable** with a reason; an unsupported usage query does not itself
make the provider unusable.

Explicit accounts or profiles in saved commands get separate previews.
A cached public identity is a hint, not proof that its credentials still work.
Corgi's account cache stores metadata, not credentials; provider tools retain
responsibility for login. See [settings and troubleshooting](reference.md#settings-and-troubleshooting)
and [agent internals](agents.md) for further details.
