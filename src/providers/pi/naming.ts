import type { Agent } from "../../agents";
import { readAt, records, typed } from "../../launch/history";
import { field, str } from "../common";
import { messageText } from "./headless";
import { transcript } from "./transcript";
/** Only user-authored text, never project context, tool output or assistant guesses. */
export async function input(agent: Agent) {
  const head = records(await readAt(agent.transcriptPath(), 0, 128 * 1024));
  transcript.verify!(head[0], agent.sessionId());
  if (head.some(v => str(v, "type") === "session_info" && str(v, "name"))) return null;
  for (const v of head) {
    if (str(v, "type") !== "message") continue;
    const message = field(v, "message");
    if (str(message, "role") !== "user") continue;
    const text = messageText(message);
    if (typed(text)) return text;
  }
  return null;
}
