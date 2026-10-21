import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as build_id from "./build_id";
import { onPath } from "./discovery";
test("a bare provider name resolves past Corgi's own alias on PATH", () => {
  const root = mkdtempSync(join(tmpdir(), "corgi-discovery-")),
    alias = join(root, "alias"),
    real = join(root, "real");
  try {
    const self = build_id.executablePath(
      import.meta.filename,
      process.execPath,
      resolve(import.meta.dir, "../corgi"),
      process.env.CORGI_APP_EXE,
    );
    mkdirSync(alias);
    mkdirSync(real);
    symlinkSync(self, join(alias, "claude"));
    expect(onPath("claude", alias)).toBeNull();
    writeFileSync(join(real, "claude"), "#!/bin/sh\n", { mode: 0o755 });
    expect(onPath("claude", `${alias}:${real}`)).toBe(join(real, "claude"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
