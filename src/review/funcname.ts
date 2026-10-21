//! The line that holds a fold's next change, like the function name git puts
//! after a hunk's `@@`: a declaration indented less than the change, so a
//! sibling that already closed doesn't count. Languages without patterns
//! take git's default, the nearest line starting with a letter, `_` or `$`;
//! a file whose diff driver has a funcname rule takes git's own header.

import type { FileDiff, Unit } from "./diff";

interface Rule {
  /** Matches a holding line, trimmed. */
  patterns: RegExp[];
  /** Only lines indented less than the change hold it. */
  nested: boolean;
}

const ts_mods = String.raw`(?:(?:export|default|declare|abstract|async)\s+)*`;
const member_mods = String.raw`(?:(?:public|private|protected|static|readonly|override|abstract|declare|async|get|set)\s+)*`;
const control = /^(?:if|for|while|switch|catch|with|return|do|else|try|finally|await|typeof|new|super)\b/;

const rules: Record<string, Rule> = {
  typescript: {
    nested: true,
    patterns: [
      new RegExp(String.raw`^${ts_mods}(?:class|interface|enum|namespace|module)\b`),
      new RegExp(String.raw`^${ts_mods}function\b`),
      new RegExp(String.raw`^${ts_mods}type\s+[\w$]`),
      // Not `const a = 1,` heading more declarations.
      new RegExp(String.raw`^${ts_mods}(?:const|let|var)\s.*[^,]$`),
      // A method, or a signature wrapped over lines.
      new RegExp(String.raw`^${member_mods}\*?[#\w$]+\s*(?:<.*>)?\s*\((?:.*\)\s*(?::[^=]*)?\{|[^)]*)$`),
      // An object's function-valued key.
      /^[#\w$]+\s*:\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[\w$]+\s*=>)/,
      /^(?:describe|test|it|suite|bench|beforeEach|afterEach|beforeAll|afterAll)(?:\.\w+)*\s*\(/,
    ],
  },
  zig: {
    nested: true,
    patterns: [
      /^(?:pub\s+)?(?:export\s+|extern\s+|inline\s+)*fn\b/,
      /^(?:pub\s+)?const\s+\w+\s*=\s*(?:packed\s+|extern\s+)?(?:struct|enum|union|opaque)\b/,
      /^test\b/,
    ],
  },
  rust: {
    nested: true,
    patterns: [
      /^(?:pub(?:\([^)]*\))?\s+)?(?:(?:default|async|const|unsafe|extern(?:\s+"[^"]*")?)\s+)*(?:struct|enum|union|mod|trait|fn|impl|macro_rules!)\b[^;]*$/,
    ],
  },
  go: { nested: true, patterns: [/^(?:func|type)\b/, /^\w+\s*:?=\s*func\b/] },
  c: {
    nested: true,
    patterns: [
      /^(?:template\s*<.*>\s*)?(?:class|struct|namespace|enum|union|interface)\b[^;]*$/,
      // A definition: a name and an argument list, not a statement.
      /^[A-Za-z_~][\w\s*&:<>,~\[\]]*\([^;]*$/,
    ],
  },
  python: { nested: true, patterns: [/^(?:async\s+)?(?:def|class)\b/] },
  shell: { nested: true, patterns: [/^(?:function\s+[\w.:-]+|[\w.:-]+\s*\(\s*\))/] },
  css: { nested: true, patterns: [/^[^\s;{}][^;{}]*\{\s*$/, /^@/] },
  markdown: { nested: false, patterns: [/^ {0,3}#{1,6}\s/] },
};
/** Git's default funcname rule. */
const plain: Rule = { nested: false, patterns: [/^[A-Za-z_$]/] };

/** Lines this far above the change are past looking at. */
const max_search = 20_000;

/** Leading whitespace as Python's tokenizer measures it: a tab moves to
 * the next multiple of 8 and, measured again, one column; a form feed
 * starts over. */
export type Depth = [wide: number, narrow: number];
export function depth(line: string): Depth {
  let wide = 0,
    narrow = 0;
  for (const ch of line) {
    if (ch === "\f") wide = narrow = 0;
    else if (ch === " " || ch === "\t") {
      wide = ch === " " ? wide + 1 : (Math.floor(wide / 8) + 1) * 8;
      narrow++;
    } else break;
  }
  return [wide, narrow];
}
/** Whether `a` sits left of `b` by both measures. Where they disagree, tabs
 * and spaces are mixed and Python would refuse the block, so it doesn't. */
const shallower = (a: Depth, b: Depth) => a[0] < b[0] && a[1] < b[1];
const comment = /^(?:\/\/|\/\*|\*|#)/;

/** The line above `before` holding lines `bar` deep, or null. Above the
 * outermost holder, the default rule names the nearest line. */
export function holder(lines: string[], lang: string | null, before: number, bar: Depth): string | null {
  const rule = (lang && rules[lang]) || plain;
  const stop = Math.max(0, before - max_search);
  for (let i = before - 1; rule.nested && i >= stop && bar[1] > 0; i--) {
    const trimmed = lines[i].trim(),
      at = depth(lines[i]);
    if (!trimmed || !shallower(at, bar) || comment.test(trimmed) || /^[}\])]/.test(trimmed)) continue;
    bar = at;
    if (!control.test(trimmed) && rule.patterns.some(p => p.test(trimmed))) return trimmed;
  }
  const flat = rule.nested ? plain : rule;
  for (let i = before - 1; i >= stop; i--) if (flat.patterns.some(p => p.test(lines[i]))) return lines[i].trim();
  return null;
}

const cache = new WeakMap<FileDiff, Map<number, string | null>>();

/** What holds the change after fold `unit`: git's hunk header where a diff
 * driver names it, else the holder of the lines shown before that change.
 * The shallowest of them sets the bar, so a declaration already in view
 * names its own holder. Null for a fold at the end of the file. */
export function forFold(d: FileDiff, unit: Unit, lang: string | null): string | null {
  if (unit.kind !== "fold" || unit.end >= d.rows.length) return null;
  let found = cache.get(d);
  if (!found) cache.set(d, (found = new Map()));
  if (found.has(unit.start)) return found.get(unit.start)!;
  let bar: Depth | null = null;
  for (let row = unit.end; row < d.rows.length; row++) {
    const text = d.text(d.rows[row]);
    if (text.trim() && (bar === null || shallower(depth(text), bar))) bar = depth(text);
    if (d.rows[row].kind !== "context") break;
  }
  const named = d.headers?.get(d.rows[unit.end].new_no);
  const label = named ?? (bar === null ? null : holder(d.new, lang, d.rows[unit.end].new_at, bar));
  found.set(unit.start, label);
  return label;
}
