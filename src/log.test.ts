import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as log from "./log";
import * as json from "./json";

function capture() {
  return spyOn(process.stderr, "write").mockImplementation(() => true);
}
let output: ReturnType<typeof capture>;
beforeEach(() => {
  output = capture();
});
afterEach(() => {
  log.configure("test");
  output.mockRestore();
});

test("logging stays quiet before startup and outside the daemon", () => {
  const logger = log.getLogger("codex.account");
  logger.error("Before startup");
  for (const command of ["attach", "account", "agent", "__viewer-test"])
    for (const level of ["debug", "info", "warn", "error"] as const) {
      log.configure(command, { CORGI_LOG_LEVEL: level });
      logger[level]("Not a daemon");
    }
  expect(output).not.toHaveBeenCalled();
});

test("existing loggers follow daemon configuration and filter below the selected level", () => {
  const logger = log.getLogger("codex.account");
  for (const command of ["serve", "__handoff"])
    for (const minimum of ["debug", "info", "warn", "error", "invalid", undefined]) {
      output.mockClear();
      log.configure(command, { CORGI_LOG_LEVEL: minimum });
      logger.debug("Debug");
      logger.info("Info");
      logger.warn("Warning");
      logger.error("Error");
      const expected =
        minimum === "debug"
          ? ["debug", "info", "warn", "error"]
          : minimum === "warn"
            ? ["warn", "error"]
            : minimum === "error"
              ? ["error"]
              : ["info", "warn", "error"];
      expect(output.mock.calls.map(([line]) => String(line).split("(")[0])).toEqual(expected);
    }
});

test("logs keep structured fields, error details and exact bigint values on one line", () => {
  log.configure("serve", {});
  const err = Object.assign(new Error("Auth failed", { cause: new Error("Timed out") }), { code: "AUTH" }),
    fields = { err, account: "default", request: 18446744073709551615n };
  log.getLogger("codex.account").warn("Account read failed\nagain", fields);
  const line = String(output.mock.calls[0][0]);
  expect(line.startsWith("warn(codex.account): ")).toBe(true);
  expect(line.split("\n")).toHaveLength(2);
  const record = json.parse(line.slice("warn(codex.account): ".length));
  expect(record).toMatchObject({
    message: "Account read failed\nagain",
    account: "default",
    request: 18446744073709551615n,
    at: expect.any(Number),
    err: { name: "Error", message: "Auth failed", code: "AUTH", stack: err.stack, cause: { message: "Timed out" } },
  });
  expect(fields.err).toBe(err);
});

test("cycles are bounded without dropping repeated fields", () => {
  log.configure("serve", {});
  const shared = { value: 1 },
    err = new Error("Recursive cause");
  err.cause = err;
  log.getLogger("test").info("Cycles", { left: shared, right: shared, err });
  const record = json.parse(String(output.mock.calls[0][0]).slice("info(test): ".length));
  expect(record.left).toEqual(shared);
  expect(record.right).toEqual(shared);
  expect(record.err.cause).toBe("[Circular]");
});

test("bad fields and output failures do not interrupt the caller", () => {
  log.configure("serve", {});
  const logger = log.getLogger("test");
  logger.warn("Still useful", {
    toJSON() {
      throw Error("Broken field");
    },
  });
  expect(String(output.mock.calls[0][0])).toContain('"logging_error":"Could not serialize fields"');
  expect(String(output.mock.calls[0][0])).toContain('"message":"Still useful"');
  output.mockImplementationOnce(() => {
    throw Error("Closed stream");
  });
  expect(() => logger.error("Output failed")).not.toThrow();
});
