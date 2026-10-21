import { field, str, Text } from "../common";
import { Info, Window, used, windows } from "../../usage/account";
import { plan } from "./index";
/** The account an app server's `account/read` reports. */
export function account(value: any) {
  const info = new Info(),
    email = str(value, "email"),
    api = str(value, "type") === "apiKey";
  info.signed_in = value !== null;
  info.account = new Text(api ? "API key" : email || (!value ? "Not signed in" : "Signed in"));
  info.plan = api ? new Text("API") : plan(str(value, "planType"));
  if (api) info.limits = "metered";
  return info;
}
function window(value: unknown) {
  const percent = used(field(value, "usedPercent"));
  if (percent === null) return null;
  const minutes = field(value, "windowDurationMins"),
    reset = field(value, "resetsAt");
  return new Window({
    minutes: Number.isInteger(minutes) && minutes > 0 ? minutes : null,
    used: percent,
    reset_at: Number.isInteger(reset) && reset > 0 ? reset : null,
  });
}
/** The limits in an `account/rateLimits/read` reply's snapshot. */
export function limits(value: unknown) {
  return windows([window(field(value, "primary")), window(field(value, "secondary"))]);
}
