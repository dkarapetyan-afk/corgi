import * as build_id from "./build_id";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { resolve as absolute } from "node:path";
import { Provider, adapter } from "./providers";
import { PathSearch } from "./os";
import { testBuild } from "./build_assets";
import * as subprocess from "./subprocess";
function executable(path: string): boolean {
  const self = build_id.executablePath(
    import.meta.filename,
    process.execPath,
    absolute(import.meta.dir, "../corgi"),
    process.env.CORGI_APP_EXE,
  );
  try {
    const real = realpathSync(path);
    if (real === realpathSync(self)) return false;
    accessSync(real, constants.X_OK);
    return statSync(real).isFile();
  } catch {
    return false;
  }
}
/** The executable `CORGI_<PROVIDER>_BIN` names in its place, if set. */
export function override(provider: Provider): string | undefined {
  return process.env[`CORGI_${provider.toUpperCase()}_BIN`];
}
function installs(provider: Provider) {
  return adapter(provider).installs({
    home: process.env.HOME || null,
    root: testBuild ? (process.env.CORGI_TEST_SYSTEM_ROOT ?? "") : "",
  });
}
/** The promise's value if it settles within `ms`, else null. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>(resolve => (timer = setTimeout(resolve, ms, null)));
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}
export async function resolve(provider: Provider, cwd: string | null = null): Promise<string> {
  const { command, version } = adapter(provider),
    set = override(provider);
  if (set !== undefined && (set.length || !version)) return set;
  if (!version) return command;
  const deadline = performance.now() + 2000,
    path = (process.env.PATH ?? "").split(":").map(dir => absolute(cwd ?? process.cwd(), dir, command)),
    quit = subprocess.Quit.init(),
    probes: Promise<string | null>[] = [];
  let report!: (path: string) => void;
  const found = new Promise<string>(resolve => (report = resolve));
  const probe = async (candidate: string, timeout_ms: number) => {
    try {
      const output = await subprocess.run([candidate, "--version"], { timeout_ms, max_output: 4096, quit });
      if (output.ok() && version(output.stdout.toString())) {
        report(candidate);
        return candidate;
      }
    } catch {}
    return null;
  };
  try {
    for (const candidate of new Set([...path, ...installs(provider)])) {
      if (!executable(candidate)) continue;
      const left = deadline - performance.now();
      if (left <= 0) break;
      // A probe may use the whole budget, but after 750 ms the next
      // candidate starts beside it: a hung one shouldn't hide the rest.
      const running = probe(candidate, left);
      probes.push(running);
      const winner = await within(Promise.race([found, running]), Math.min(750, left));
      if (winner) return winner;
    }
    const rest = Promise.all(probes).then(paths => paths.find(path => path !== null) ?? null);
    const winner = await Promise.race([found, rest]);
    if (winner) return winner;
  } finally {
    quit.signal();
  }
  throw Error("ProviderNotFound");
}
/** The first executable `name` on PATH that isn't Corgi itself: a pane-local
 * alias would otherwise exec Corgi again. */
export function onPath(name: string, path_list = process.env.PATH ?? ""): string | null {
  const search = PathSearch.init(path_list, name);
  for (let path = search.next(); path !== null; path = search.next()) if (executable(path)) return path;
  return null;
}
export function installed(provider: Provider): boolean {
  const set = override(provider);
  if (set) return set.includes("/") ? executable(set) : onPath(set) !== null;
  return onPath(adapter(provider).command) !== null || installs(provider).some(executable);
}
