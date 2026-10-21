import { test, expect } from "bun:test";
import * as conversation from "./conversation";
test("a Claude Stop lists its running subagents apart from its commands", () => {
  const entries = [
    {
      id: "b1",
      type: "shell",
      status: "running",
      description: "Run tests",
      command: "bun test",
    },
    {
      id: "a1",
      type: "subagent",
      status: "running",
      description: "Lane A: sidebar",
      agent_type: "general-purpose",
    },
    {
      id: "a1",
      type: "subagent",
      status: "running",
      description: "Lane A: sidebar",
    },
    {
      id: "a2",
      type: "subagent",
      status: "pending",
      description: "Review",
      agent_type: "Explore",
    },
    { id: "a3", type: "subagent", status: "completed", description: "Done" },
    { id: "m1", type: "monitor", status: "running", description: "Watch" },
  ];
  const children = conversation.children(entries)!;
  expect(children.running).toBe(2);
  expect(children.complete()).toBe(true);
  expect(children.items[0].description.text()).toBe("Lane A: sidebar");
  expect(children.items[0].agent_type.text()).toBe("general-purpose");
  expect(children.listed("a2")).toBe(true);
  expect(children.listed("a3")).toBe(false);
  expect(children.listed("b1")).toBe(false);
  expect(conversation.inventory(entries, 1)?.len).toBe(1);
  expect(conversation.children(null)).toBeNull();
  expect(conversation.children([])?.running).toBe(0);
});
test("only a one-shot cron is a wakeup the conversation waits on", () => {
  for (const [value, result] of [
    [
      [
        {
          id: "c1",
          schedule: "17 13 5 10 *",
          recurring: false,
          prompt: "check CI",
        },
      ],
      true,
    ],
    [
      [
        {
          id: "c1",
          schedule: "*/30 * * * *",
          recurring: true,
          prompt: "failsafe",
        },
      ],
      false,
    ],
    [[{ id: "c1", schedule: "17 13 5 10 *" }], false],
    [[], false],
    [null, false],
  ] as const)
    expect(conversation.wakeup(value)).toBe(result);
});
