import { expect, test } from "bun:test";
import * as replay from "../tools/benchmarks/frame_sequences/replay";

// Byte ceilings are the row-span baseline at fee6128d, including cold frames.
const baseline: Record<string, number> = {
  cat: 30140,
  "cat-dense": 40499,
  claude: 27695,
  codex: 87050,
  micro: 57062,
  shell: 11198,
};
test("all recorded workloads are present", () => {
  expect(replay.names()).toEqual(Object.keys(baseline).sort());
});
for (const name of Object.keys(baseline)) {
  test(`frame diffs reproduce recorded ${name} screens`, async () => {
    const sequence = await replay.load(name);
    expect(replay.verify(sequence)).toBeLessThan(baseline[name]);
    replay.verify(sequence, 7);
  });
}
