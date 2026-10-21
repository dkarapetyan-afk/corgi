# Frame diff corpus

Real PTY captures at 120×40, sampled at 33 ms when the screen changes:

- Codex 0.163.0 and Claude Code 2.1.306 stream canned Markdown from a local HTTP server, then edit their input line. Disposable homes contain no credentials. Replays make no model calls.
- Micro 2.0.15 edits, searches, scrolls and saves a generated TypeScript file.
- Zsh prints colors, a hyperlink and Unicode, updates a progress counter, edits a command and clears the screen.
- `cat` prints 30,000 generated lines; `cat-dense` varies the whole line.
- The benchmark records fresh Moonlander launches, thrusts, tilts and coasting, with both braille and Kitty hulls. The recorder acknowledges Kitty uploads.

The six checked-in gzip JSON files under `fixtures/` total 47 KB and are shared
with the frame-diff regression tests. Moonlander recordings are generated under
ignored `dist/benchmarks/` when comparing builds, then replayed identically by
both builds. The recordings contain source/version,
input actions, timestamps and complete repaint frames. Each frame uses the actual
Corgi pane surface's styled rows and cursor. Partial synchronized updates and
identical frames are omitted. Sampling is not byte-for-byte deterministic; the
checked-in recordings are fixed. Startup and idle time are included in durations.

These are **text-layer** workloads. Kitty image bytes, SSH framing/compression,
application rendering and capture cost are outside the diff benchmark. The
existing Moonlander tests separately verify image placements, skipped frames,
resizing and restart. Recordings use synthetic content, not personal sessions.

## Run

```sh
bun build.ts --native-only
bun test src/frame_diff.test.ts src/frame_diff_sequences.test.ts
bun tools/benchmarks/frame_sequences/replay.ts --verify
bun tools/benchmarks/frame_sequences/record.ts micro
bun tools/benchmarks/frame_sequences/record.ts moonlander-kitty
bun tools/benchmarks/frame_sequences/replay.ts --directory dist/benchmarks/frame_sequences moonlander-kitty
```

Recording requires the named installed CLI. Moonlander with Kitty also needs
`uv` for its existing atlas rasterizer. Recapture one workload at a time. Check
its frames and refresh the byte ceilings in `src/frame_diff_sequences.test.ts`
from the baseline build when intentionally replacing checked-in recordings.
The recorder accepts an optional output directory after the workload name.

For an A/B comparison, build the baseline revision in another worktree and pass
its `native/zig-out` directory:

```sh
bun tools/benchmarks/frame_sequences/compare.ts /path/to/baseline/native/zig-out > comparison.json
```

The comparator first captures and verifies both Moonlander modes, retaining
them in a unique directory under `dist/benchmarks/` reported in its JSON output.
It then alternates baseline/candidate order for three rounds. Each
workload runs in a fresh process, warms three passes, then measures fifteen.
CPU includes the Bun wrapper, native parsing/hash/diff, output allocation and
teardown; per-frame wall timings cover `Differ.diff`. Peak RSS includes Bun and
the loaded corpus, so it is a coarse process measure, not a native heap profile.
The oracle runs separately: full repaint versus delta must produce identical
terminal snapshots after every frame, including every-seventh-frame replay.
Identical frames must emit nothing. Tests also enforce baseline byte ceilings.

## Implementation

The native differ scans for changed runs, retains style/link state across rows,
and compares short gaps against an absolute cursor move's serialized size.
Uniform gaps use a direct UTF-8 byte count; complex gaps use two bounded 256-byte
stack buffers. Long gaps skip cost serialization. The two existing cell hash
arrays are unchanged (16 bytes per cell, 76,800 bytes at 120×40); the planner adds
no persistent storage or heap allocations. Parsing and hashing still inspect
the full frame.

## Measured comparison

macOS arm64, Bun 1.4.2, ReleaseFast; baseline `fee6128d`.
[Raw trials](results.json) include source/fixture hashes and per-frame wall timings.
These historical trials used the original Moonlander recordings; new captures
vary with the game world and scheduling.
CPU and peak RSS below are medians of the three fresh-process runs. Text KB is
the whole recorded sequence excluding its unchanged initial full repaint,
not a per-second network rate.

| Workload | Text KB, before → after | Reduction | CPU µs/frame | Peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| cat | 23.6 → 9.4 | 60.0% | 190 → 215 | 26.4 → 25.3 |
| cat-dense | 34.0 → 24.6 | 27.4% | 209 → 227 | 24.3 → 24.4 |
| claude | 21.2 → 15.6 | 26.1% | 196 → 200 | 31.1 → 30.3 |
| codex | 80.1 → 65.7 | 18.0% | 205 → 216 | 34.7 → 34.7 |
| micro | 50.5 → 43.3 | 14.4% | 351 → 355 | 27.7 → 27.6 |
| moonlander | 776.1 → 436.7 | 43.7% | 376 → 392 | 74.5 → 69.5 |
| moonlander-kitty | 683.7 → 404.4 | 40.9% | 386 → 391 | 68.2 → 63.5 |
| shell | 4.7 → 4.0 | 13.3% | 198 → 177 | 29.6 → 28.7 |

Validation: native/test builds and typecheck passed; 1,134 unit tests passed
(two opt-in skips), and all 70 `smoke_terminal`/`viewers` integration tests passed.
One unrelated review-panel test exceeded the default 5-second timeout; it passed
in isolation, and the complete suite passed with `--timeout 20000`. Two independent
reviews found no regressions introduced by this change.

## Live bandwidth over time

```sh
bun tools/benchmarks/frame_sequences/live_compare.ts /path/to/baseline /path/to/candidate dist/bandwidth
uv run --with matplotlib python tools/benchmarks/frame_sequences/plot_bandwidth.py dist/bandwidth
```

Both worktrees need `bun build.ts --test`. The harness runs each application in
an isolated PTY at 120×40 with 10×22-pixel cells, acknowledges Kitty graphics,
and records all output bytes in one-second buckets. A small C launcher sets PTY
pixel dimensions for Corgi; it requires `cc`. Each workload lasts twenty seconds.
The two Moonlander cases use the same thrust/tilt schedule. The Corgi case mixes
sparse counters, scrolling, idle time and a help overlay. Startup is recorded
separately, after waiting for the game images to be placed.

These are separate live runs: terrain, resource readings and frame scheduling
can vary. The output includes Kitty bytes, but not SSH framing or compression.
Each run saves raw terminal output, per-second samples/frame counts and initial
and final screens. The plotter writes PNG/SVG charts, CSV samples and a summary.
Use a fresh output directory for a new experiment; interrupted runs can resume
when their saved build revisions match.
