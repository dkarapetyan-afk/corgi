/**
 * The page has no Node, and src/corgi_badge.ts reads the badge's size out of
 * its PNG with Buffer as it loads; the worktree overview imports it through
 * the sidebar. main.js imports this ahead of everything else, so it runs first.
 */
import { Buffer } from "buffer";

(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
