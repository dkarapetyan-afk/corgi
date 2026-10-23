//! What an untitled tab calls the program in front of its pane's shell:
//! tmux's `pane_current_command`, read past interpreters to their script.
import path from "node:path";

const shells = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "nu"]);
const interpreters = /^(?:node|bun|python|pypy|ruby|perl|php|lua|sh|bash|zsh|fish|dash|ksh|csh|tcsh|nu)[\d.]*$/i;
const script = /\.(?:[cm]?[jt]sx?|py|rb|pl|php|lua|sh|bash|zsh|fish)$/;
/** Flags that run code from the command line, which no script names. */
const inline = new Set(["-c", "-e", "-p", "--eval", "--print"]);
/** Flags whose value is the next argument. */
const valued = new Set(["-r", "--require", "--import", "--loader", "-I", "-W", "-X"]);

/** The program `argv` runs, named as tmux names a window: no login shell's
 * dash or folder, and a title written over argv only to its first space.
 * Past an interpreter it is the script, or Python's module. A shell at its
 * prompt is "", and its tab shows its folder instead. */
export function name(argv: string[]): string {
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
