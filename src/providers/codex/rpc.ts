//! JSON-RPC to a Codex app server over its stdio: requests Corgi sends and
//! the replies that settle them. Everything else the server says is left for
//! the caller to decode.
import { Stdio } from "../stdio";
import { field, str } from "../common";
import { cancelled, type Stopping } from "../../stopping";
import type { Saved } from "../adapter";
type Waiting = { resolve: (value: any) => void; reject: (error: Error) => void };
export class Rpc {
  next_id = 1n;
  private waiting = new Map<string, Waiting>();
  /** What the server said that no reply settled, until `take`. */
  private unclaimed: unknown[] = [];
  constructor(readonly io: Stdio) {}
  static spawn(executable: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
    return new Rpc(Stdio.spawn([executable, "app-server", "--listen", "stdio://", ...args], { cwd, env }));
  }
  /** Sends a request; it settles once `take` or `request` reads the reply. */
  call(method: string, params: unknown): Promise<any> {
    const id = this.next_id++;
    this.io.write({ id, method, params });
    return new Promise((resolve, reject) => this.waiting.set(String(id), { resolve, reject }));
  }
  notify(method: string, params?: unknown) {
    this.io.write(params === undefined ? { method } : { method, params });
  }
  respond(id: unknown, reply: { result: unknown } | { error: unknown }) {
    this.io.write({ id, ...reply });
  }
  private pump() {
    for (const value of this.io.read()) {
      const id = field(value, "id");
      if (id !== null && !str(value, "method") && this.waiting.has(String(id))) {
        const waiting = this.waiting.get(String(id))!;
        this.waiting.delete(String(id));
        if (field(value, "error") !== null) waiting.reject(Error("HarnessRejected"));
        else waiting.resolve(value);
      } else this.unclaimed.push(value);
    }
    if (this.io.exited && this.waiting.size) {
      for (const waiting of this.waiting.values()) waiting.reject(Error("HarnessExited"));
      this.waiting.clear();
    }
  }
  /** What the server said since the last call, besides replies to requests. */
  take(): unknown[] {
    this.pump();
    const out = this.unclaimed;
    this.unclaimed = [];
    return out;
  }
  /** Sends a request and waits for its reply, reading as it goes. */
  async request(method: string, params: unknown, stopping: Stopping | undefined, deadline: number) {
    let settled = false,
      value: any,
      failure: Error | null = null;
    void this.call(method, params).then(
      reply => {
        settled = true;
        value = reply;
      },
      error => {
        settled = true;
        failure = error;
      },
    );
    for (;;) {
      this.pump();
      await Promise.resolve();
      if (failure) throw failure;
      if (settled) return value;
      if (cancelled(stopping) || this.io.closed) throw Error("Cancelled");
      if (Date.now() >= deadline) throw Error("Timeout");
      if (this.io.exited) throw Error("HarnessExited");
      await this.io.wait(deadline);
    }
  }
  save(live: boolean): Saved {
    const saved = this.io.save(live);
    return { state: { ...(saved.state as object), next_id: this.next_id }, handles: saved.handles };
  }
  static restore(saved: Saved, live: boolean) {
    const rpc = new Rpc(Stdio.restore(saved, live));
    rpc.next_id = BigInt((saved.state as any)?.next_id ?? 1);
    return rpc;
  }
}
