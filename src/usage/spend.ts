/** Provider-reported monthly spend, in the currency's minor units. */
export interface Reading {
  used_minor: number;
  limit_minor: number | null;
  /** Null for the provider's credits, which Codex shows whole. */
  currency: string | null;
  exponent: number;
  period_start: number;
  reset_at: number;
}
export function amount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}
export function currencyExponent(currency: unknown): number | null {
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return null;
  return (
    new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? null
  );
}
/** Old previews and caches have no spend field. Reject incomplete readings. */
export function restore(value: unknown): Reading | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    !amount(v.used_minor) ||
    (v.limit_minor !== null && !amount(v.limit_minor)) ||
    (v.currency !== null && currencyExponent(v.currency) === null) ||
    typeof v.exponent !== "number" ||
    !Number.isInteger(v.exponent) ||
    v.exponent < 0 ||
    v.exponent > 6 ||
    !Number.isSafeInteger(v.period_start) ||
    !Number.isSafeInteger(v.reset_at) ||
    (v.period_start as number) < 0 ||
    (v.reset_at as number) <= (v.period_start as number)
  )
    return null;
  return {
    used_minor: v.used_minor,
    limit_minor: v.limit_minor,
    currency: v.currency as string | null,
    exponent: v.exponent,
    period_start: v.period_start as number,
    reset_at: v.reset_at as number,
  };
}
export function current(value: Reading, now: number): boolean {
  return now >= value.period_start && now < value.reset_at;
}
export function percent(value: Reading): number | null {
  if (value.limit_minor === null) return null;
  if (value.limit_minor === 0) return value.used_minor > 0 ? 100 : 0;
  return (value.used_minor / value.limit_minor) * 100;
}
export function money(value: Reading, minor: number): string {
  const major = minor / 10 ** value.exponent;
  const compact = major >= 1000,
    digits = value.currency === null ? 0 : value.exponent;
  const figure = new Intl.NumberFormat("en-US", {
    ...(value.currency !== null && { style: "currency", currency: value.currency }),
    notation: compact ? "compact" : "standard",
    minimumFractionDigits: compact || Number.isInteger(major) ? 0 : digits,
    maximumFractionDigits: compact ? 1 : digits,
  })
    .formatToParts(major)
    .map(part => (part.type === "compact" && part.value === "K" ? "k" : part.value))
    .join("");
  // Credits take a stack of coins, one cell wide, where money takes its sign.
  return value.currency === null ? `⛁${figure}` : figure;
}
export function amounts(value: Reading): string {
  const used = money(value, value.used_minor);
  return value.limit_minor === null ? used : `${used} / ${money(value, value.limit_minor)}`;
}
