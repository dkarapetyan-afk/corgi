import { BoundedText } from "../../bounded_text";
import { Model } from "../model";
import { field, number, str } from "../common";
import { items, model } from "./api";

const Text = BoundedText(160);

/** Catalog dollars per million tokens, in the overview's fixed-point units. */
function rate(value: unknown): bigint | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const scaled = Math.round(value * 1000);
  return Number.isSafeInteger(scaled) && (value === 0 || scaled > 0) ? BigInt(scaled) : null;
}

export function read(value: unknown): Map<string, Model> {
  const out = new Map<string, Model>();
  for (const entry of items(value)) {
    const id = model(entry);
    if (!id) continue;
    const costs = field(entry, "cost"),
      base = Array.isArray(costs) ? costs.find(cost => !field(cost, "tier")) : null,
      input = rate(field(base, "input")),
      output = rate(field(base, "output")),
      name = str(entry, "name").replace(/[\x00-\x1f\x7f-\x9f]/g, ""),
      resolved = Model.resolve(str(entry, "id"));
    out.set(
      id,
      new Model({
        id: new Text(id),
        name: new Text(name),
        window: number(field(entry, "limit"), "context") ?? 0n,
        price:
          input !== null && output !== null
            ? { label: resolved.name.text() || name || str(entry, "id"), input, output }
            : null,
      }),
    );
  }
  return out;
}
