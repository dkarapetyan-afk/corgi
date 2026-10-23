//! A private OpenCode server for the reads Corgi makes while OpenCode's
//! background service is down. It takes its password from the environment
//! and exits once its stdin closes, so it never outlives Corgi; it stays a
//! little while for the next read.
import { randomBytes } from "node:crypto";
import { Stdio } from "../stdio";
import { str } from "../common";
import type { Endpoint } from "./api";
const linger_ms = 30000,
  startup_ms = 10000;
class Server {
  io: Stdio | null = null;
  busy = 0;
  timer: ReturnType<typeof setTimeout> | null = null;
  closed = false;
  ready: Promise<Endpoint>;
  constructor(executable: () => Promise<string>) {
    this.ready = this.start(executable);
  }
  private async start(executable: () => Promise<string>): Promise<Endpoint> {
    const path = await executable();
    if (this.closed) throw Error("Cancelled");
    const password = randomBytes(24).toString("base64url"),
      io = (this.io = Stdio.spawn([path, "serve", "--stdio", "--port", "0"], {
        cwd: "/tmp",
        // It reads the catalog the background service last fetched.
        env: {
          ...process.env,
          OPENCODE_PASSWORD: password,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_DISABLE_MODELS_FETCH: "1",
        },
      })),
      deadline = Date.now() + startup_ms;
    for (;;) {
      for (const value of io.read()) {
        const url = str(value, "url");
        if (/^https?:\/\//.test(url))
          return { url, authorization: "Basic " + Buffer.from("opencode:" + password).toString("base64") };
      }
      if (this.closed) throw Error("Cancelled");
      if (io.exited) throw Error("OpenCodeServiceUnavailable");
      if (Date.now() >= deadline) throw Error("Timeout");
      await io.wait(deadline);
    }
  }
  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.io?.close();
    if (shared === this) shared = null;
  }
}
let shared: Server | null = null;
/** The private server's address, kept until `release`. */
export async function hold(executable: () => Promise<string>, linger = linger_ms) {
  if (shared?.io?.exited) shared.close();
  const server = (shared ??= new Server(executable));
  server.busy++;
  if (server.timer) clearTimeout(server.timer);
  server.timer = null;
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    if (--server.busy || server.closed) return;
    server.timer = setTimeout(() => server.close(), linger);
    server.timer.unref();
  };
  try {
    return { endpoint: await server.ready, release };
  } catch (error) {
    release();
    server.close();
    throw error;
  }
}
/** Stops the private server, if one runs. */
export function close() {
  shared?.close();
}
