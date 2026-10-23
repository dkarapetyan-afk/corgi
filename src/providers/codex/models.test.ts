import { expect, spyOn, test } from "bun:test";
import { AppServer } from "./app_server";
import { read } from "./models";
import { Quit } from "../../subprocess";
import { Stdio } from "../stdio";
import { Codex } from "./headless";

test("Codex catalogs paginate every account's models without generating a model turn", async () => {
  const quit = new Quit(),
    folders: string[] = [],
    request = spyOn(AppServer.prototype, "request").mockImplementation(async function (
      this: AppServer,
      method,
      params,
      stopping,
    ) {
      expect(stopping).toBe(quit.abortSignal);
      folders.push(this.account);
      if (method === "account/read") return { result: { account: { type: "apiKey" } } };
      expect(method).toBe("model/list");
      const cursor = (params as { cursor: string | null }).cursor;
      return {
        result: {
          data: cursor
            ? [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }]
            : [{ model: "gpt-6-astra", displayName: "GPT-6 Astra" }],
          nextCursor: cursor ? null : "next",
        },
      };
    }),
    close = spyOn(AppServer.prototype, "close");
  try {
    const models = await read("/codex/nvidia", quit);
    expect(models.map(m => m.id)).toEqual(["gpt-6-astra", "gpt-6-luna"]);
    expect(models.every(m => !m.subscription)).toBe(true);
    expect(folders).toEqual(["/codex/nvidia", "/codex/nvidia", "/codex/nvidia"]);
    expect(close).toHaveBeenCalled();
  } finally {
    request.mockRestore();
    close.mockRestore();
  }
});

test("Codex catalog failure closes its private app server", async () => {
  const request = spyOn(AppServer.prototype, "request").mockRejectedValue(Error("Timeout")),
    close = spyOn(AppServer.prototype, "close");
  try {
    await expect(read("", new Quit())).rejects.toThrow("Timeout");
    expect(close).toHaveBeenCalled();
  } finally {
    request.mockRestore();
    close.mockRestore();
  }
});

test("Codex inference starts with the same account directory used for its catalog", () => {
  const spawn = spyOn(Stdio, "spawn").mockImplementation(() => new Stdio());
  try {
    const client = Codex.start(
      { account: "/codex/nvidia", cwd: "/project", executable: "codex" },
      { instructions: "Summarize", model: "gpt-6-luna", schema: null },
    );
    expect(spawn.mock.calls[0][1]?.env?.CODEX_HOME).toBe("/codex/nvidia");
    expect(spawn.mock.calls[0][1]?.cwd).toBe("/tmp");
    client.close();
  } finally {
    spawn.mockRestore();
  }
});
