import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { readdir, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directory } from "./integration";
function request(path: string, session: string, name?: string): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection(path),
      finish = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
    let bytes = "";
    socket.setTimeout(1500, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("end", () => finish(false));
    socket.on("connect", () => socket.write(JSON.stringify({ session, name }) + "\n"));
    socket.on("data", data => {
      bytes += data;
      if (bytes.length > 1024) return finish(false);
      if (bytes.includes("\n")) {
        try {
          finish(JSON.parse(bytes).ok === true);
        } catch {
          finish(false);
        }
      }
    });
  });
}
export async function channel(session: string, _connected = false, account = "") {
  const uid = process.getuid?.() ?? 0;
  const hash = createHash("sha256")
    .update(directory(account) + "\n" + session)
    .digest("hex")
    .slice(0, 24);
  const prefix = `corgi-pi-${uid}-${hash}-`;
  for (const name of await readdir(tmpdir())) {
    if (!name.startsWith(prefix) || !name.endsWith(".sock")) continue;
    const path = join(tmpdir(), name);
    try {
      const s = await lstat(path);
      if (!s.isSocket() || s.uid !== uid) continue;
    } catch {
      continue;
    }
    if (await request(path, session))
      return async (name: string) => {
        if (!(await request(path, session, name))) throw Error("PiRenameFailed");
      };
  }
  return null;
}
