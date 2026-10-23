import { max } from "./tokens";
export type Price = { label: string; input: bigint; output: bigint };
/** Normalize optional catalog rates received in a viewer snapshot. */
export function parse(value: unknown): Price | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.label !== "string") return null;
  const rate = (v: unknown) => {
    if (typeof v === "bigint") return v >= 0n ? v : null;
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
    if (typeof v === "string" && /^\d{1,20}$/.test(v)) return BigInt(v);
    return null;
  };
  const input = rate(entry.input),
    output = rate(entry.output);
  return input !== null && output !== null ? { label: entry.label, input, output } : null;
}
const table: Array<{ id: string; price: Price }> = [
  {
    id: "claude-fable-5-1",
    price: { label: "fable", input: 10000n, output: 50000n },
  },
  {
    id: "claude-fable-5",
    price: { label: "fable", input: 10000n, output: 50000n },
  },
  {
    id: "claude-opus-5-5",
    price: { label: "opus", input: 4000n, output: 20000n },
  },
  {
    id: "claude-opus-5",
    price: { label: "opus", input: 5000n, output: 25000n },
  },
  {
    id: "claude-opus-4-1",
    price: { label: "opus", input: 15000n, output: 75000n },
  },
  {
    id: "claude-opus-4-20250514",
    price: { label: "opus", input: 15000n, output: 75000n },
  },
  {
    id: "claude-opus-4",
    price: { label: "opus", input: 5000n, output: 25000n },
  },
  {
    id: "claude-sonnet-5",
    price: { label: "sonnet", input: 2000n, output: 10000n },
  },
  {
    id: "claude-sonnet-4",
    price: { label: "sonnet", input: 3000n, output: 15000n },
  },
  {
    id: "claude-haiku-5-5",
    price: { label: "haiku", input: 100n, output: 500n },
  },
  {
    id: "claude-haiku-4-5",
    price: { label: "haiku", input: 1000n, output: 5000n },
  },
  {
    id: "gpt-6-astra",
    price: { label: "astra", input: 10000n, output: 50000n },
  },
  { id: "gpt-6.1-sol", price: { label: "sol", input: 2000n, output: 10000n } },
  { id: "gpt-6-sol", price: { label: "sol", input: 2000n, output: 10000n } },
  { id: "gpt-6-luna", price: { label: "luna", input: 100n, output: 500n } },
  {
    id: "gpt-5.3-codex",
    price: { label: "codex", input: 1750n, output: 14000n },
  },
  { id: "fable", price: { label: "fable", input: 10000n, output: 50000n } },
  { id: "opus", price: { label: "opus", input: 4000n, output: 20000n } },
  { id: "sonnet", price: { label: "sonnet", input: 2000n, output: 10000n } },
  { id: "haiku", price: { label: "haiku", input: 100n, output: 500n } },
];
export function lookup(model: string): Price | null {
  model = model.slice(model.indexOf("/") + 1).split("#")[0];
  let best: (typeof table)[number] | null = null;
  for (const entry of table) {
    if (!model.startsWith(entry.id) || (model.length > entry.id.length && /[0-9]/.test(model[entry.id.length])))
      continue;
    if (!best || entry.id.length > best.id.length) best = entry;
  }
  return best?.price ?? null;
}
export function equivalent(price: Price, reference: Price, uncached_input: bigint, output: bigint) {
  const n =
    (reference.input > 0n ? (uncached_input * price.input) / reference.input : 0n) +
    (reference.output > 0n ? (output * price.output) / reference.output : 0n);
  return n > max ? max : n;
}
