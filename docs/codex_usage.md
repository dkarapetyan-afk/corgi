# Codex account spend

Account previews read spend from the app server's `account/rateLimits/read`,
the request they already make for quota windows. It needs no extra key and
sends no model prompt. The figure is the snapshot's `individualLimit`: the
per-user credit limit a workspace admin sets, with credits used so far and
the reset time. It is not session cost or locally counted tokens.

Codex's own `/status` shows this as "Monthly credit limit" with "388 of
250,000 credits used". Corgi keeps the unit: it marks credits with a coin
stack where money has its sign, "⛁388 / ⛁250k", never dollars, since the
credit price depends on the workspace's contract. Like Codex, it rounds to whole credits. Malformed or
missing figures omit the reading.

The reply gives the reset but not the start of the period. Corgi takes the
period to be the month before the reset, ending on a shorter month's last day
when the reset falls on the 29th to 31st. Workspaces on credits report no
quota windows, so such an account counts as metered and the picker shows the
monthly bar in place of the 5h and 7d ones. An account that also reports
quota windows keeps them in the picker; the usage panel shows both.

The picker and usage panel stop displaying spend after ten minutes without a
successful refresh or once the reset passes. A Codex reading stores `null` as
its currency; older Corgis drop it on restore, and no protocol version or
saved-data migration is needed.
