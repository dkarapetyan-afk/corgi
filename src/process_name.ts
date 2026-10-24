//! What an untitled tab calls the program in front of its pane's shell:
//! tmux's `pane_current_command`, read past interpreters to their script,
//! and the brand whose mark its tab wears.
import path from "node:path";

export const brands = [
  "node",
  "bun",
  "python",
  "ruby",
  "php",
  "hack",
  "perl",
  "r",
  "npm",
  "vim",
  "neovim",
  "git",
  "docker",
  "kubernetes",
  "postgresql",
  "redis",
  "rust",
  "go",
  "zig",
  "homebrew",
  "cmake",
  "claude",
  "openai",
  "tmux",
] as const;
export type Brand = (typeof brands)[number];
export function brand(value: unknown): Brand | null {
  return brands.includes(value as Brand) ? (value as Brand) : null;
}
/** The brand of each program, by the name it runs as, version aside. */
const programs: Record<string, Brand> = {
  node: "node",
  nodejs: "node",
  bun: "bun",
  bunx: "bun",
  python: "python",
  pypy: "python",
  ruby: "ruby",
  php: "php",
  hhvm: "hack",
  hh_client: "hack",
  hh_server: "hack",
  perl: "perl",
  r: "r",
  npm: "npm",
  npx: "npm",
  pnpm: "npm",
  pnpx: "npm",
  yarn: "npm",
  vi: "vim",
  vim: "vim",
  vimdiff: "vim",
  nvim: "neovim",
  git: "git",
  tig: "git",
  lazygit: "git",
  docker: "docker",
  lazydocker: "docker",
  kubectl: "kubernetes",
  k9s: "kubernetes",
  psql: "postgresql",
  postgres: "postgresql",
  pgcli: "postgresql",
  "redis-cli": "redis",
  "redis-server": "redis",
  cargo: "rust",
  rustc: "rust",
  rustup: "rust",
  go: "go",
  zig: "zig",
  brew: "homebrew",
  cmake: "cmake",
  ccmake: "cmake",
  ctest: "cmake",
  cpack: "cmake",
  claude: "claude",
  codex: "openai",
  uv: "python",
  uvx: "python",
  tmux: "tmux",
};
/** The brand a program or provider called `name` wears, if it has one. */
export function brandOf(name: string): Brand | null {
  const key = name.toLowerCase();
  return programs[key] ?? programs[key.replace(/-?[\d.]+$/, "")] ?? null;
}

const shells = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "nu"]);
const interpreters = /^(?:node|bun|python|pypy|ruby|perl|php|lua|sh|bash|zsh|fish|dash|ksh|csh|tcsh|nu)[\d.]*$/i;
const script = /\.(?:[cm]?[jt]sx?|py|rb|pl|php|lua|sh|bash|zsh|fish)$/;
/** Flags that run code from the command line, which no script names. */
const inline = new Set(["-c", "-e", "-p", "--eval", "--print"]);
/** Flags whose value is the next argument. */
const valued = new Set(["-r", "--require", "--import", "--loader", "-I", "-W", "-X"]);

export type Program = { name: string; brand: Brand | null };
/** The program `argv` runs, named as tmux names a window: no login shell's
 * dash or folder, and a title written over argv only to its first space.
 * Past an interpreter it is the script, or Python's module, and wears its own
 * brand or else the interpreter's. A shell at its prompt is "", and its tab
 * shows its folder instead. */
export function program(argv: string[]): Program {
  const name = named(argv);
  return { name, brand: (name && brandOf(name)) || brandOf(word(argv[0] ?? "")) };
}

function named(argv: string[]): string {
  const program = word(argv[0] ?? "");
  if (!interpreters.test(program)) return program;
  const shell = shells.has(program);
  let i = 1;
  if (program === "bun" && argv[i] === "run") i++;
  for (; i < argv.length && argv[i].startsWith("-"); i++) {
    const flag = argv[i];
    if (inline.has(flag)) return program;
    if (flag === "-m" && !shell) return argv[i + 1] || program;
    if (valued.has(flag)) i++;
  }
  // A shell's first argument is its script; others' might be a subcommand.
  const target = argv[i] ?? "";
  if (target && (shell || target.includes("/") || script.test(target)))
    return path.basename(target).replace(script, "");
  return shell ? "" : program;
}

function word(arg0: string): string {
  const program = arg0.replace(/^[ -]+/, "");
  // A path may have spaces; a title ends at one.
  return path.basename(program.startsWith("/") ? program : program.split(" ")[0]).replace(/:$/, "");
}
