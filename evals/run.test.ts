import { test, expect } from "bun:test";
import { mkdtemp, writeFile, chmod, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("historical naming manifests report native titles without sending them to the driver", async () => {
  const dir = await mkdtemp(join(tmpdir(), "corgi-name-eval-"));
  try {
    const cases = join(dir, "cases.json"),
      driver = join(dir, "fixture.ts"),
      out = join(dir, "results");
    await writeFile(
      cases,
      JSON.stringify([
        {
          id: "history",
          category: "naming",
          steps: [
            {
              task: "name",
              evidence: "Add Pi sign-in",
              expect: "label",
              all: ["Pi"],
              reference: { provider: "claude", title: "Original native title", session: "private-session" },
            },
          ],
        },
      ]),
    );
    await writeFile(
      driver,
      `
      const plan = await Bun.file(process.argv.at(-1)).json();
      if (JSON.stringify(plan).includes("Original native title") || JSON.stringify(plan).includes("private-session")) throw Error("ReferenceLeak");
      for (const scenario of plan) for (const step of scenario.steps) console.log(JSON.stringify({ id:step.id,status:"label",label:"Pi account sign-in",raw:JSON.stringify({name:"Pi account sign-in"}),elapsed_ms:1 }));
    `,
    );
    const proc = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "run.ts"),
        "--cases",
        cases,
        "--driver",
        driver,
        "--model",
        "codex:fixture",
        "--out",
        out,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    expect(await proc.exited, await new Response(proc.stderr).text()).toBe(0);
    const report = JSON.parse(await readFile(join(out, "latest.json"), "utf8"));
    expect(report.metadata.casesPath).toBe(cases);
    expect(report.metadata.casesHash).toHaveLength(64);
    expect(await readFile(join(out, "latest.md"), "utf8")).toContain("Original native title");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner exits nonzero for failures/missing results and saves a reproducible scorecard", async () => {
  const dir = await mkdtemp(join(tmpdir(), "corgi-eval-test-"));
  try {
    const driver = join(dir, "fixture.ts");
    await writeFile(
      driver,
      `#!/usr/bin/env bun
const plan = await Bun.file(process.argv.at(-1)).json();
for (const scenario of plan) for (const step of scenario.steps) {
  if (process.env.EVAL_TEST_MISSING) continue;
  console.log(JSON.stringify({id:step.id,status:"abstained",label:null,action:"none",raw:'{"action":"none","label":null}',elapsed_ms:1}));
}
`,
    );
    await chmod(driver, 0o700);
    for (const [index, name, missing, code] of [
      [0, "make-alone", false, 0],
      [1, "running-tests", false, 1],
      [2, "make-alone", true, 1],
    ] as const) {
      const out = join(dir, String(index));
      const proc = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, "run.ts"),
          "--driver",
          driver,
          "--model",
          "codex:fixture",
          "--case",
          name,
          "--out",
          out,
        ],
        { env: { ...process.env, EVAL_TEST_MISSING: missing ? "1" : "" }, stdout: "ignore", stderr: "pipe" },
      );
      const error = new Response(proc.stderr).text();
      expect(await proc.exited, await error).toBe(code);
      const report = JSON.parse(await readFile(join(out, "latest.json"), "utf8"));
      expect(report.metadata.fixture).toBe(true);
      expect(report.metadata.hashes["src/activity/prompt.ts"]).toHaveLength(64);
      expect(report.results).toHaveLength(1);
      expect(report.results[0].failures.length === 0).toBe(code === 0);
      expect(await readFile(join(out, "latest.md"), "utf8")).toContain(code === 0 ? "1/1" : "0/1");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
