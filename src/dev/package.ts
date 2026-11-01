// Package the standalone Plumb product after checking every staged byte.
import { loadScrubList } from "../core/scrub.ts";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Top-level files that ship. */
const TOP = ["plumb.ts", "package.json", "README.md", "SPEC.md", "DEMO.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md", "LICENSE", ".gitignore"];
/** Directories that ship whole (less the exclusions below). */
const DIRS = ["src", "packs", "templates", "tests", "skill", "examples"];
/** The MCP server and its own test: shipped only with --with-mcp. src/mcp/tools.ts (pure query functions, used by tests) ships. */
export const MCP_FILES = ["src/mcp/server.ts", "tests/mcp.test.ts"];

/** Names never shipped, wherever they sit: build outputs, history, editor and OS litter, instance state (a root's tracker measures among it). */
const SKIP_DIR = new Set(["build", ".git", "node_modules", "reports", "diffs", "measures", ".claude"]);
const SKIP_FILE = /(^|\/)(\.DS_Store|Thumbs\.db|.*~|.*\.swp|.*\.tmp|.*\.log|.*\.orig|.*\.rej|scrub\.txt|portfolio\.lock)$/;

export const EMPTY_NOTES = `# Notes and questions pinned to records of this design. People, agents and the page (under \`bun plumb.ts dev\`) all
# write here. target.kind is element, relationship, contract, unit, phase, claim, patch or finding (a finding is named
# pack/rule@at). To answer a question: set answer, set answered_by, set status to answered, and set updated to the
# current time. This file is not generated: the importer never touches it.
notes: []
`;

const MCP_BLOCK = /<!-- mcp:start -->[\s\S]*?<!-- mcp:end -->/;
export const MCP_ABSENT = `<!-- mcp:start -->
This bundle was made without the MCP server (\`bun plumb.ts package <out-dir>\` without \`--with-mcp\`). Claude Code reads the instance files and runs the CLI directly, which is all the skill in \`skill/plumb\` needs. To add the server: make the bundle again with \`--with-mcp\` (or copy \`src/mcp/server.ts\` from a bundle that has it into \`src/mcp/\`), then run, from the bundle root, \`claude mcp add plumb -- bun "$PWD/src/mcp/server.ts" "$PWD/build/delivery-stream/bundle.json"\`. It is read-only.
<!-- mcp:end -->`;

export interface PackageOptions {
  root: string;              // the engine's repository (or a bundle) to package
  withMcp?: boolean;
  scrubList?: string;        // default PLUMB_SCRUB_LIST, with legacy fallback
  log?: (m: string) => void;
}
export interface LeakHit { file: string; line: number; what: string }
export interface PackageResult { out: string; files: { path: string; sha256: string; bytes: number }[]; leaks: LeakHit[]; namesChecked: boolean; ok: boolean }

function walk(root: string, rel: string, out: string[]) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    const st = statSync(join(root, r));
    if (st.isDirectory()) { if (!SKIP_DIR.has(name)) walk(root, r, out); }
    else if (st.isFile() && !SKIP_FILE.test(r)) out.push(r);
  }
}

const sha256 = (buf: Uint8Array) => new Bun.CryptoHasher("sha256").update(buf).digest("hex");

/** Git's index lists eligible working files; an unpacked source has no tracking restriction. */
function trackedFiles(root: string): Set<string> | undefined {
  const git = (args: string[]) => Bun.spawnSync(["git", "-C", root, ...args], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
  const probe = git(["rev-parse", "--is-inside-work-tree"]);
  if (probe.exitCode !== 0) {
    if (/not a git repository/.test(probe.stderr.toString())) return undefined;
    throw new Error(`cannot determine Git tracking: ${probe.stderr.toString().trim()}`);
  }
  if (probe.stdout.toString().trim() !== "true") return undefined;
  const listed = git(["ls-files", "--cached", "-z", "--", "."]);
  if (listed.exitCode !== 0) throw new Error(`cannot list Git tracked files: ${listed.stderr.toString().trim()}`);
  return new Set(listed.stdout.toString().split("\0").filter(Boolean));
}

// Addresses on domains reserved for documentation and tests (RFC 2606, RFC 6761) are placeholders, not addresses.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const RESERVED = /@(?:[A-Za-z0-9-]+\.)*(?:example(?:\.(?:com|net|org))?|test|invalid|localhost)$/i;

/** Lines in declared Markdown sections, including subheadings, up to the next peer or parent. */
export function sectionLines(text: string, patterns: RegExp[] = []): Set<number> {
  const lines = text.split("\n"), allowed = new Set<number>();
  let fence: { char: string; length: number } | undefined;
  const headings = lines.map(line => {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (delimiter) {
      const mark=delimiter[1];
      if (!fence) fence={char:mark[0],length:mark.length};
      else if (mark[0]===fence.char && mark.length>=fence.length) fence=undefined;
      return null;
    }
    if (fence) return null;
    const heading=/^ {0,3}(#{1,6})\s+(.+)$/.exec(line);
    if (heading) heading[2]=heading[2].replace(/\s+#+\s*$/,"");
    return heading;
  });
  headings.forEach((heading, start) => {
    if (!heading || !patterns.some(re => new RegExp(re.source, "i").test(heading[2]))) return;
    let end = start + 1;
    for (; end < lines.length; end++) {
      const next = headings[end];
      if (next && next[1].length <= heading[1].length) break;
    }
    for (let i = start; i < end; i++) allowed.add(i + 1);
  });
  return allowed;
}

/** Every home path, email address and scrub-list name in the staged files; the term itself is never echoed.
 *  sectionOk[k] lets entry k appear only inside an explicitly declared section. */
export function leakCheck(dir: string, files: string[], names: RegExp[], sectionOk: boolean[] = [], opts: { strictEmails?: boolean; strictHomePaths?: boolean; sectionPatterns?: RegExp[] } = {}): LeakHit[] {
  const hits: LeakHit[] = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    const inSection = sectionOk.some(Boolean) && /\.(?:md|markdown)$/i.test(f) ? sectionLines(text, opts.sectionPatterns) : new Set<number>();
    text.split("\n").forEach((line, i) => {
      if (/\/Users\//.test(line)) hits.push({ file: f, line: i + 1, what: "a /Users path" });
      else if (opts.strictHomePaths && /\/(?:home|root)\/|(?:[A-Za-z]:)?[\\/]Users[\\/]|~[\\/]/i.test(line)) hits.push({ file: f, line: i + 1, what: "a home path" });
      for (const m of line.match(EMAIL) ?? []) if (opts.strictEmails || !RESERVED.test(m)) hits.push({ file: f, line: i + 1, what: "an email address" });
      names.forEach((re, k) => { if (sectionOk[k] && inSection.has(i + 1)) return; if (new RegExp(re.source, "i").test(line)) hits.push({ file: f, line: i + 1, what: `a name from the scrub list (its entry ${k + 1})` }); });
    });
  }
  return hits;
}

export async function packageBundle(outDir: string, opts: PackageOptions): Promise<PackageResult> {
  const log = opts.log ?? (() => {});
  const root = resolve(opts.root), out = resolve(outDir);
  if (out === root || out.startsWith(root + sep)) throw new Error(`the bundle cannot go inside the tree it packages (${out})`);
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty; give a new or empty directory`);
  if (opts.withMcp && !existsSync(join(root,"src/mcp/server.ts"))) throw new Error("MCP server is not present in this source; package with --with-mcp from a full Plumb tree");
  const scrub = loadScrubList(opts.scrubList, log);

  const stage = mkdtempSync(join(tmpdir(), "plumb-package-"));
  try {
    // 1. the engine, its docs, tests and fixtures
    const files: string[] = [];
    for (const f of TOP) if (existsSync(join(root, f))) files.push(f);
    for (const d of DIRS) walk(root, d, files);
    const tracked = trackedFiles(root);
    const shipped = files.filter((f) => (!tracked || tracked.has(f)) && (opts.withMcp || !MCP_FILES.includes(f)));
    for (const f of shipped) { mkdirSync(dirname(join(stage, f)), { recursive: true }); cpSync(join(root, f), join(stage, f)); }
    if (!shipped.includes("skill/plumb/SKILL.md")) throw new Error("skill/plumb/SKILL.md is missing from the tree being packaged");
    if (!opts.withMcp) {
      const p = join(stage, "README.md");
      const t = readFileSync(p, "utf8");
      if (!MCP_BLOCK.test(t)) throw new Error("README.md has no <!-- mcp:start --> … <!-- mcp:end --> block to replace");
      writeFileSync(p, t.replace(MCP_BLOCK, MCP_ABSENT));
    }

    // 4. the manifest, then the leak check over everything, the manifest included
    const all: string[] = [];
    walk(stage, "", all);
    const entries = all.map((f) => { const b = readFileSync(join(stage, f)); return { path: f, sha256: sha256(b), bytes: b.length }; });
    const manifest = [
      "# Plumb bundle. Every file in this folder but this one, with its SHA-256 and size in bytes.",
      `# MCP server: ${opts.withMcp ? "included" : "not included"}.`,
      ...entries.map((e) => `${e.sha256}  ${String(e.bytes).padStart(8)}  ${e.path}`), "",
    ].join("\n");
    writeFileSync(join(stage, "MANIFEST"), manifest);
    const leaks = leakCheck(stage, [...all, "MANIFEST"], scrub.list.map(([re]) => re), scrub.list.map(([, , l]) => !!l), { sectionPatterns: scrub.sections });
    const res: PackageResult = { out, files: entries, leaks, namesChecked: scrub.found, ok: leaks.length === 0 };
    if (!res.ok) return res;
    mkdirSync(out, { recursive: true });
    cpSync(stage, out, { recursive: true });
    return res;
  } finally {
    rmSync(stage, { recursive: true, force: true }); // a temporary directory
  }
}

/** The CLI: prints what shipped and the leak check's verdict; exit 1 when the check fails. */
export async function packageCli(args: string[], root: string): Promise<number> {
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const outDir = args[0];
  if (!outDir || outDir.startsWith("--") || args.slice(1).some(a => a !== "--with-mcp")) { process.stderr.write("usage: plumb package <out-dir> [--with-mcp]\n"); return 2; }
  let r: PackageResult;
  try { r = await packageBundle(outDir, { root, withMcp: args.includes("--with-mcp"), log: m => process.stderr.write(m + "\n") }); }
  catch (e) { process.stderr.write(`package: ${(e as Error).message}\n`); return 2; }
  const bytes = r.files.reduce((a, f) => a + f.bytes, 0);
  if (!r.ok) {
    console.log(`Leak check failed: ${r.leaks.length} hit(s); nothing was written to ${r.out}.`);
    for (const h of r.leaks.slice(0, 50)) console.log(`  ${h.file}:${h.line}  ${h.what}`);
    if (r.leaks.length > 50) console.log(`  and ${r.leaks.length - 50} more`);
    return 1;
  }
  console.log(`Wrote ${r.files.length} files (${Math.round(bytes / 1024)} KB) and MANIFEST to ${relative(process.cwd(), r.out) || r.out}.`);
  console.log(`Leak check passed: no /Users path, no email address${r.namesChecked ? ", no scrub-list name" : "; scrub-list names NOT checked (no scrub list found)"}.`);
  console.log("Next: cd into it, run `bun test`, then `bun plumb.ts portfolio build examples/portfolio`. Nothing was sent anywhere.");
  return 0;
}
