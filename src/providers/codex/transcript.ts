//! Codex's rollouts: the records it writes, and what they say about a turn
//! ending or a thread's activity.
import { field, str } from "../common";
import type { Transcript } from "../adapter";
export const Method = [
  "turn/started",
  "turn/completed",
  "thread/started",
  "thread/tokenUsage/updated",
  "item/started",
  "item/completed",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/call",
  "item/tool/requestUserInput",
] as const;
export const RolloutKind = ["session_meta", "turn_context", "event_msg", "response_item"] as const;
export const EventKind = [
  "task_started",
  "task_complete",
  "turn_complete",
  "turn_aborted",
  "token_count",
  "message",
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "local_shell_call",
  "web_search_call",
] as const;
export class Rollout {
  type: string | null = null;
  timestamp = "";
  payload: any = null;
  static decode(v: any) {
    return Object.assign(new Rollout(), {
      type: RolloutKind.includes(str(v, "type") as any) ? str(v, "type") : null,
      timestamp: str(v, "timestamp"),
      payload: field(v, "payload"),
    });
  }
  payloadType() {
    const t = str(this.payload, "type");
    return EventKind.includes(t as any) ? t : null;
  }
}
export const transcript: Omit<Transcript, "reader"> = {
  // A rollout opens with the thread it belongs to.
  verify(head, session) {
    if (head === null) throw Error("NoIdentity");
    const rollout = Rollout.decode(head);
    if (rollout.type !== "session_meta" || str(rollout.payload, "id") !== session) throw Error("WrongSession");
  },
  completion(agent, v) {
    const rollout = Rollout.decode(v);
    if (rollout.type !== "event_msg" || !agent.turn.len || str(rollout.payload, "turn_id") !== agent.turnId())
      return null;
    const kind = rollout.payloadType();
    if (kind === "turn_aborted") return "interrupted";
    if (kind === "task_complete" || kind === "turn_complete")
      return field(rollout.payload, "error") !== null ? "failed" : "completed";
    return null;
  },
  fallback(r, agent, now) {
    // Fresh app-server metadata outranks the rollout.
    if (agent.metadata_at && now - agent.metadata_at <= 5000000) return false;
    if (r.name.len) agent.setName(r.name.text());
    const p = r.progress;
    if (!p || agent.state !== "working" || p.ended || !p.turn.len) return false;
    if (!agent.turn.len && agent.last_seq === r.seq) agent.setTurn(p.turn.text());
    if (agent.turnId() !== p.turn.text()) return false;
    agent.activity_generation = Bun.hash.wyhash(p.commentary.text(), 0n);
    return true;
  },
};
