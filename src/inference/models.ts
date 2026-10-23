import { Provider } from "../providers";
export class Selection {
  provider: Provider | null = null;
  model = "";
  account = "";
  static parse(value: unknown) {
    const out = new Selection();
    if (!value || typeof value !== "object") return out;
    const v = value as Record<string, unknown>,
      provider = Provider.parse(v.provider);
    if (
      provider &&
      typeof v.model === "string" &&
      v.model.length <= 512 &&
      !/[\s\x00-\x1f\x7f]/.test(v.model) &&
      typeof v.account === "string" &&
      v.account.length <= 4096 &&
      !/[\x00-\x1f\x7f]/.test(v.account)
    )
      Object.assign(out, { provider, model: v.model, account: v.account });
    return out;
  }
}
export class Option {
  provider: Provider = Provider.first;
  model = "";
  name = "";
  account = "";
  account_name = "";
  subscription = false;
  input_cost: number | null = null;
  output_cost: number | null = null;
}
export function options(value: unknown): Option[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(v => {
    const selection = Selection.parse(v);
    if (!selection.provider || !selection.model || typeof v.name !== "string") return [];
    const price = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);
    return [
      Object.assign(new Option(), selection, {
        provider: selection.provider,
        name: v.name.slice(0, 160),
        account_name: typeof v.account_name === "string" ? v.account_name : "",
        subscription: v.subscription === true,
        input_cost: price(v.input_cost),
        output_cost: price(v.output_cost),
      }),
    ];
  });
}
/** A typical short-summary request is input-heavy. Unknown prices sort last. */
export function cost(model: Option) {
  return model.input_cost === null || model.output_cost === null ? Infinity : 4 * model.input_cost + model.output_cost;
}
export function compare(a: Option, b: Option) {
  return (
    Number(b.subscription) - Number(a.subscription) ||
    (cost(a) === cost(b) ? 0 : cost(a) < cost(b) ? -1 : 1) ||
    a.model.localeCompare(b.model) ||
    a.account.localeCompare(b.account)
  );
}
