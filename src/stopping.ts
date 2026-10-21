//! How a caller asks a long wait to give up: a flag, an abort signal, or a
//! shared atomic a worker reads.
export type Stopping = { load?: (...args: any[]) => boolean; value?: boolean } | AbortSignal | boolean;
export function cancelled(stopping?: Stopping) {
  if (typeof stopping === "boolean") return stopping;
  if (!stopping) return false;
  if ("aborted" in stopping) return stopping.aborted;
  return stopping.load?.() ?? stopping.value ?? false;
}
