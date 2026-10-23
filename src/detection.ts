import path from "node:path";
import { readdirSync } from "node:fs";
import { Agent, Provider, Text, type State } from "./agents";
import type { PaneMemory, PromptMemory } from "./providers/adapter";
import { n, ptr, processArgs } from "./native_bridge";
import { processJob, processTree } from "./os";
export type Job = { pid: number; provider: Provider };
/** A local bridge owns the identity; the provider itself may run elsewhere. */
export type Claim = { provider: Provider; owner: number; parent: number };
export function claim(provider: Provider, owner: number): Claim {
  const job = owner > 1 ? processJob(owner) : null;
  if (!job) throw Error("InvalidOwner");
  return { provider, owner, parent: job.ppid };
}
export function claimAlive(claim: Claim): boolean {
  return processJob(claim.owner)?.ppid === claim.parent;
}
export const process_buffer = 1024 * 1024;
export function identify(argv: string[]): Provider | null {
  return locate(argv)?.provider ?? null;
}
/** The provider `argv` runs, and where its program or script sits in it,
 * past any interpreter. */
export function locate(argv: string[]): { provider: Provider; at: number } | null {
  if (!argv.length) return null;
  const direct = Provider.owning(argv[0]);
  if (direct) return { provider: direct, at: 0 };
  const exe = path.basename(argv[0]);
  if ((!["node", "bun", "sh", "bash", "zsh"].includes(exe) && !/^python/i.test(exe)) || argv.length < 2) return null;
  let i = 1;
  if (exe === "bun" && argv[i] === "run") i++;
  while (i < argv.length && argv[i].startsWith("-")) {
    const flag = argv[i++];
    if (flag === "--") break;
    if (!(exe === "bun" && ["--bun", "-b"].includes(flag)) && !["-u", "--no-warnings"].includes(flag)) return null;
  }
  if (exe === "bun" && argv[i] === "run") i++;
  if (i >= argv.length) return null;
  const provider = Provider.owning(argv[i]);
  return provider ? { provider, at: i } : null;
}
export function backgroundJob(pid: number) {
  const info = processJob(pid);
  return !!info && (info.tpgid <= 0 || info.pgid !== info.tpgid);
}
export function interruptKey(bytes: string | Uint8Array) {
  const s = typeof bytes === "string" ? bytes : Buffer.from(bytes).toString();
  return s === "\x1b" || s.includes("\x03") || /\x1b\[(?:27|99;5)(?:[;:][\d;:]*|)u/.test(s);
}
/** What a provider's watcher keeps about a conversation's prompts. */
export class PromptWatch implements PromptMemory {
  seen = false;
  covered = 0;
  open = 0;
}
/** Which provider a pane runs, and what its watcher keeps about the pane. */
export class Tracker implements PaneMemory {
  claim: Claim | null = null;
  /** The current process has acquired structured lifecycle evidence. */
  structured = false;
  /** The screen has shown work since its last confirmed idle screen. */
  screen_worked = false;
  get screen_only() {
    return !this.structured && (this.claim !== null || this.pid > 0);
  }
  get allow_initial_work() {
    return this.screen_only;
  }
  followStructured() {
    this.structured = true;
    this.screen_worked = false;
  }
  pid = 0;
  missing = 0;
  candidate: State | null = null;
  confirmations = 0;
  ready = false;
  idle_since = 0;
  interrupt_key_at = 0;
  observeInput(bytes: string | Uint8Array, now: number) {
    if (interruptKey(bytes)) this.interrupt_key_at = now;
  }
  /** Follows the pane's foreground process; true while the screen may speak
   * for its agent, which nothing else reports yet. */
  update(agent: Agent, job: Job | null) {
    if (!job) {
      if (this.pid && ++this.missing >= 2) {
        agent.reset();
        Object.assign(this, new Tracker());
      }
      return false;
    }
    this.missing = 0;
    if (this.pid !== job.pid || agent.provider !== job.provider) {
      if (this.pid || agent.provider !== job.provider) agent.reset();
      this.pid = job.pid;
      this.structured = false;
      this.screen_worked = false;
      this.candidate = null;
      this.confirmations = 0;
      this.ready = false;
      agent.provider = job.provider;
      if (!agent.last_seq) agent.state = "initializing";
    }
    if (agent.last_seq) this.followStructured();
    return !agent.last_seq;
  }
  /** Shows what the watcher confirmed the screen says; true when it should ring. */
  show(agent: Agent, shown: { state: State; tool: boolean }, watched: boolean) {
    const next = shown.state;
    agent.tool_active = shown.tool;
    if (agent.state === next) return false;
    if (next === "idle") this.ready = true;
    const now = Date.now() * 1000;
    if (this.screen_only) {
      if (next === "working" && !this.screen_worked) {
        this.screen_worked = true;
        this.interrupt_key_at = 0;
        agent.beginTurn("");
      } else if (next === "idle" && this.screen_worked) {
        this.screen_worked = false;
        const interrupted = this.interrupt_key_at > 0 && now - this.interrupt_key_at <= 5000000;
        return agent.endTurn("", interrupted ? "interrupted" : "completed", "screen", now);
      } else if (next === "idle") agent.attention = agent.observation.unread() ? "finished" : "none";
    }
    agent.state = next;
    agent.changed_at = now;
    agent.activity = new Text();
    agent.observation.source = "screen";
    if (next === "working") agent.attention = agent.observation.unread() ? "finished" : "none";
    if (next === "blocked") {
      if (!watched) agent.attention = "needs_input";
      return true;
    }
    return false;
  }
}

export function foreground(fd: number): Job | null {
  const pgid = n.probe_foreground(fd);
  if (pgid <= 0) return null;
  const inspect = (pid: number) => {
    const info = processArgs(pid);
    return info.complete ? identify(info.argv) : null;
  };
  const leader = inspect(pgid);
  if (leader) return { pid: pgid, provider: leader };
  // The group's other members, found with getpgid rather than by reading
  // every process's /proc stat, as detection.zig does.
  const pids = new Int32Array(process.platform === "darwin" ? 128 : 4096);
  const count = n.probe_group_pids(pgid, ptr(pids), pids.length);
  for (let i = 0; i < Math.min(pids.length, count); i++) {
    const pid = pids[i];
    if (pid <= 0 || pid === pgid) continue;
    const provider = inspect(pid);
    if (provider) return { pid, provider };
  }
  return null;
}

/** A foreground group's members, found among the panes' own processes, or
 * with getpgid across the host where the kernel can't list children. */
function groupMembers(pgid: number, roots: number[]): number[] | null {
  const tree = processTree(roots);
  if (tree) return tree.filter(pid => processJob(pid)?.pgid === pgid).sort((a, b) => a - b);
  const pids = new Int32Array(4096);
  const count = n.probe_group_pids(pgid, ptr(pids), pids.length);
  if (count < 0 || count === pids.length) return null;
  return [...pids.subarray(0, count)];
}

export function foregroundJobs(terminals: { fd: number; pid: number }[]) {
  const result = new Map<number, Job | null>();
  if (process.platform === "darwin") {
    for (const { fd } of terminals) result.set(fd, foreground(fd));
    return result;
  }
  const groups = new Map<number, number[]>();
  for (const { fd } of terminals) {
    const pgid = n.probe_foreground(fd);
    result.set(fd, null);
    if (pgid <= 0) continue;
    const argv = processArgs(pgid);
    const provider = argv.complete ? identify(argv.argv) : null;
    if (provider) {
      result.set(fd, { pid: pgid, provider });
      continue;
    }
    const members = groups.get(pgid) ?? [];
    members.push(fd);
    groups.set(pgid, members);
  }
  if (!groups.size) return result;
  for (const [pgid, fds] of [...groups]) {
    const roots = terminals.filter(t => fds.includes(t.fd)).map(t => t.pid);
    const members = groupMembers(pgid, roots);
    if (!members) continue;
    for (const pid of members) {
      if (pid <= 0 || pid === pgid) continue;
      const argv = processArgs(pid);
      const provider = argv.complete ? identify(argv.argv) : null;
      if (!provider) continue;
      for (const fd of fds) result.set(fd, { pid, provider });
      break;
    }
    groups.delete(pgid);
  }
  if (!groups.size) return result;
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry),
        job = processJob(pid);
      if (!job || pid === job.pgid || !groups.has(job.pgid)) continue;
      const argv = processArgs(pid),
        provider = argv.complete ? identify(argv.argv) : null;
      if (!provider) continue;
      for (const fd of groups.get(job.pgid)!) result.set(fd, { pid, provider });
      groups.delete(job.pgid);
      if (!groups.size) break;
    }
  } catch {}
  return result;
}
