# Claude account spend

Account previews use the existing Claude login and the existing read-only
`get_usage` control request. They send no model prompt and need no additional
key. The monthly figure comes from `rate_limits.extra_usage`, not session cost
or locally counted tokens. Older CLIs that do not support the request retain
the existing unavailable state.

The [SDK usage report](https://code.claude.com/docs/en/agent-sdk/typescript)
documents `used_credits` and `monthly_limit` in minor currency units. Corgi
uses the reported currency and decimal places, or the currency's standard
minor unit when decimal places are absent. Disabled or incomplete readings
are omitted. A null limit displays spend alone: it does not imply unlimited
organization spending.

[Claude Code's usage-credits display](https://code.claude.com/docs/en/costs#check-your-usage-credits-spend)
describes the figure as current-month spend against the applicable personal
limit; it does not show the whole-organization cap. Monthly spend limits
[reset at 00:00 UTC on the first of the calendar month](https://platform.claude.com/docs/en/manage-claude/spend-limits-api).
Corgi derives those calendar boundaries from the fetch time, rather than
treating them as a rolling thirty-day quota or an invoice anniversary.

The picker and usage panel stop displaying spend after ten minutes without a
successful refresh or at the next calendar month. An absent `spend` field in
an older preview or handoff defaults to null; no protocol version or saved-data
migration is needed.
