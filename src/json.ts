// Preserve the integer tokens used by Zig's u64 IDs, hashes and counters.
export function parse(text: string): any {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value === "number" && !Number.isSafeInteger(value) && context?.source && /^-?\d+$/.test(context.source))
      return BigInt(context.source);
    return value;
  });
}
export function stringify(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, value) => (typeof value === "bigint" ? JSON.rawJSON(String(value)) : value),
    space,
  );
}
export function clone<T>(value: T): T {
  return parse(stringify(value));
}
export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("UnexpectedToken");
  return value as Record<string, any>;
}

// Vendor records tolerate missing or mistyped fields. Own wire formats use
// the strict protocol/checkpoint decoders instead.
export function field(value: unknown, key: string): any {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, key)
    ? ((value as Record<string, unknown>)[key] ?? null)
    : null;
}
export function str(value: unknown, key: string): string {
  const item = field(value, key);
  return typeof item === "string" ? item : "";
}
