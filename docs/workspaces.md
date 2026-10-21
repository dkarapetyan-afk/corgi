# Workspaces, activity and worktrees

A workspace groups tabs and agents around a folder. Its sidebar shows activity,
optional resource readings and linked Git worktrees.

## Follow activity

| Indicator | Meaning |
| --- | --- |
| Working | Agents currently running a turn |
| Needs input | Agents waiting for an answer or approval |
| Unread | Agents with a completed turn you have not acknowledged |
| Tool count | Reported tool calls while you were away |

Away counts clear while a focused viewer watches the workspace. Working,
needs-input and unread are separate live counts; a new turn does not erase an
unread result. Counts depend on observable provider events, not terminal output
volume, and incomplete provider data can leave gaps.

**Jump to attention** (`prefix f` in the Corgi preset) visits waiting agents
before completed ones. Visiting acknowledges attention without answering the
agent. Completion sounds stay quiet for a pane focused in a watching viewer;
input requests can still sound. **prefix m** toggles sound in the Corgi preset.

Hover an agent to inspect its activity, children, usage and background commands.
A `≥` marks partial usage coverage; **Last reported** means a task list may
be stale. These are observations, not process controls or a billing statement.
[Agent internals](agents.md) explains how Corgi obtains them.

**Corgi setup → Clever Corgi** selects the inference provider and switches
activity summaries, worktree briefs and Smart Links. Auto chooses a provider
from launch history and keeps it once it answers. These features use the
provider login and consume model usage. Activity labels and link names are
inferences; they do not establish agent lifecycle or verify page titles.

## Inspect resource use

Hover the workspace's resource row for CPU, memory and disk history plus a
process table. Click a metric's header to sort. **Corgi setup → Resources**
turns readings on or off; sampling stops when no viewer displays them.

CPU uses one core as 100%, so a workspace can exceed 100%. Memory is summed
physical footprint on macOS or RSS on Linux; shared mappings may overlap.
Disk rates cover attributed disk traffic, not network traffic. Missing metrics
are omitted rather than shown as zero. **CPU busy** is a host/workspace
utilization heuristic, not proof that a particular process is stalled.

Attribution follows pane/headless-session processes and descendants. Brief,
detached, remote or container processes may escape it. Partial readings are
estimates; resource collection does not call a model.

## Create or choose a worktree

In the [agent picker](agent-launcher.md), press `w` to choose an existing
checkout or enter a new branch, base branch and folder. The default base is
the repository's local default branch; choose another with **From**.

The worktree is created only when an agent, saved command or terminal launches.
Escaping the picker leaves nothing behind. An existing branch/folder or an
invalid branch name returns you to the form without launching.

**Corgi setup → Source control** sets the folder template. The default is
`$PROJECT_ROOT/.worktrees/$NAME`; `../$PROJECT_NAME-$NAME` puts it beside the
project. Supported variables are `$PROJECT_ROOT`, `$PROJECT_NAME`, `$NAME`
and `$HOME`; a leading `~` also means home. The branch's slashes become
hyphens in `$NAME`. Relative paths start at the primary checkout.
A new worktree inside the project is locally ignored through `.git/info/exclude`.

## Browse and compare worktrees

Hover the sidebar's worktree count or run `corgi action worktrees`.
Arrows or the wheel browse; Enter focuses its agents. For an empty worktree,
Enter restores recent conversations asleep, waking the focused one, or opens
the picker if there are none. Agent membership follows observed working
directories and successful edits; uncertain observations can retain a previous
association.

The count excludes the primary checkout and missing prunable registrations.
Corgi does not prune Git metadata or fetch remote updates for this view.

| Reading | Interpretation |
| --- | --- |
| Ahead / behind | Commit counts against the local default branch |
| Included in main | Ancestry proves the checkout's HEAD is reachable there; squash merges are not inferred |
| Changed files | Local staged, unstaged, untracked or conflicted changes |
| Stale | A refresh failed; retained data may be out of date |

The comparison uses the local counterpart of `origin/HEAD`, then `main`,
`master` or `trunk`; without one, comparison is unavailable.
Enabled worktree briefs summarize commits and diffs while the overview is
open. Press `r` to refresh them. Review changes with `e` or the worktree
heading's menu; see [Review changes](reference.md#review-changes).

## Remove a worktree

Pin the overview, select a worktree, then hold Backspace/Delete. The footer
states what will be lost and which agents close. Release before completion
to cancel the hold.

Removal closes that worktree's agents and runs `git worktree remove --force`:
**uncommitted files are discarded; the branch and its commits stay**.
Locked worktrees and checkouts containing an open workspace are refused.

Once Git is deleting, Esc stops Git but cannot restore files already removed.
A stopped removal can therefore leave a partially deleted checkout. Read the
result in the footer before retrying or using that checkout.
