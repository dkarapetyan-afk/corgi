/**
 * The page has no Node, and src/keymap.ts reads process.platform as it
 * loads, for the command menu's presets: macOS's, cmux among them. main.js
 * imports this ahead of everything else, so it runs first.
 */
(globalThis as { process?: { platform: string } }).process ??= { platform: "darwin" };
