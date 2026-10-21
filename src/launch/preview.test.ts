import { test, expect } from "bun:test";
import { Option } from "./preview";
test("a launch preview names the model it shows and where it came from", () => {
  const o = new Option();
  o.setModel("opus", "Project");
  expect(o.model.text()).toBe("opus");
  expect(o.modelLabel()).toBe("Opus");
  expect(o.source.text()).toBe("Project");
});
