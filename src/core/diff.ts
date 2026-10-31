import { invocation } from "./invocation.ts";
// Compare two builds of an instance: `bun plumb.ts diff <instance> --from <bundle.json | git ref> [--to ...] [--save]`.
//
// Each side is a built bundle file or this instance at a git ref.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { Bundle, BuildDiff, DiffRecord } from "../types.ts";
import { buildBundle } from "./bundle.ts";
import { DIGEST } from "./digest.ts";
import { sideName } from "../site/strategy.ts";

export { DIGEST };

/** Compare two bundles. */
export function diffBundles(from: Bundle, to: Bundle, labels: { from: string; to: string }): BuildDiff {
  const d = DIGEST.compare(DIGEST.digest(from), DIGEST.digest(to), DIGEST.names(to), DIGEST.names(from));
  return {
    from: { label: labels.from, built: from.engine.built, hash: from.engine.hash, ...(from.engine.rules ? { rules: from.engine.rules } : {}) },
    to: { label: labels.to, built: to.engine.built, hash: to.engine.hash, ...(to.engine.rules ? { rules: to.engine.rules } : {}) },
    ...d,
    ...(from.importer || to.importer ? { importer: { ...(from.importer ? { from: from.importer } : {}), ...(to.importer ? { to: to.importer } : {}) } } : {}),
  };
}

const KIND_WORD: Record<string, [string, string]> = {
  element: ["part", "parts"], relationship: ["relationship", "relationships"], unit: ["unit", "units"], claim: ["claim", "claims"],
  finding: ["finding", "findings"], patch: ["patch", "patches"], note: ["note", "notes"],
};
const n = (k: number, kind: string) => `${k} ${(KIND_WORD[kind] ?? [kind, kind + "s"])[k === 1 ? 0 : 1]}`;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The comparison's headline numbers, one line per kind with any change. */
export function diffTotals(d: BuildDiff): string[] {
  return Object.entries(d.counts).filter(([, c]) => c.added || c.removed || c.changed)
    .map(([k, c]) => `${(KIND_WORD[k] ?? [k, k + "s"])[1]}: +${c.added} −${c.removed} ~${c.changed}`);
}

export function diffMd(d: BuildDiff, title = "What changed", names?: Record<string, string>): string {
  const out = [`# ${title}`, "", `From **${sideName(d.from)}** to **${sideName(d.to)}**.`, ""];
  out.push("| Kind | Added | Removed | Changed | Reworded |", "|---|---|---|---|---|");
  for (const [k, c] of Object.entries(d.counts)) out.push(`| ${(KIND_WORD[k] ?? [k, k + "s"])[1]} | ${c.added} | ${c.removed} | ${c.changed} | ${c.reworded ?? 0} |`);
  const churn = DIGEST.churnText(d, d.importer);
  if (churn) out.push("", churn);
  const list = (h: string, xs: DiffRecord[], max = 40) => {
    if (!xs.length) return;
    out.push("", `## ${h} (${xs.length})`, "");
    for (const x of xs.slice(0, max)) out.push(`- ${x.kind} \`${x.id}\` ${cell(x.name)}`);
    if (xs.length > max) out.push(`- and ${xs.length - max} more`);
  };
  if (d.status?.overall || d.status?.moves.length) {
    out.push("", "## Status", "");
    if (d.status.overall) out.push(`- The plan: ${d.status.overall.from} → ${d.status.overall.to}`);
    for (const m of d.status.moves) out.push(`- ${cell(DIGEST.moveText(m))}`);
  }
  list("New risks: claims now load-bearing and untested", d.risks ?? []);
  if (d.fields?.length) {
    out.push("", `## Changed fields (${d.fields.length})`, "");
    for (const x of d.fields.slice(0, 60)) out.push(`- ${x.kind} \`${x.id}\` ${cell(x.name)}: ${cell(DIGEST.fieldText(x, names ?? {}))}`);
    if (d.fields.length > 60) out.push(`- and ${d.fields.length - 60} more`);
  }
  list("New findings", d.findings.added);
  list("Findings gone", d.findings.gone);
  list("Units newly ready", d.units.ready);
  list("Units newly done", d.units.done);
  list("Notes answered", d.notes.answered);
  list("Notes resolved", d.notes.resolved);
  list("Notes added", d.notes.added);
  list("Patches added", d.patches.added);
  if (d.patches.decided.length) { out.push("", `## Patches decided (${d.patches.decided.length})`, ""); for (const p of d.patches.decided) out.push(`- \`${p.id}\` ${cell(p.name)}: ${p.from} → ${p.to}`); }
  if (d.claims.regraded.length) { out.push("", `## Claims regraded (${d.claims.regraded.length})`, ""); for (const c of d.claims.regraded) out.push(`- \`${c.id}\` ${cell(c.name)}: ${c.from} → ${c.to}`); }
  if (d.checks && (d.checks.rulesAdded.length || d.checks.rulesRemoved.length)) {
    out.push("", "## Changes in the checks, not the design", "");
    if (d.checks.rulesAdded.length) out.push(`- New rules: ${d.checks.rulesAdded.map((x) => `\`${x}\``).join(", ")}`);
    if (d.checks.rulesRemoved.length) out.push(`- Retired rules: ${d.checks.rulesRemoved.map((x) => `\`${x}\``).join(", ")}`);
  }
  list("Findings from new rules", d.checks?.findingsAdded ?? []);
  list("Findings gone with retired rules", d.checks?.findingsGone ?? []);
  list("Records added", d.added);
  list("Records removed", d.removed);
  list("Records changed", d.changed);
  list("Records reworded (titles or owners only)", d.reworded ?? []);
  if (DIGEST.isEmpty(d)) out.push("", "Nothing changed.");
  out.push("");
  return out.join("\n");
}

function git(cwd: string, args: string[]): string {
  const p = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString().trim()}`);
  return p.stdout.toString();
}

/** Write the instance directory as it stood at a git ref into a fresh temporary directory (git show per file). */
export function instanceAtRef(dir: string, ref: string): string {
  const out = mkdtempSync(join(tmpdir(), "plumb-at-"));
  const files = git(dir, ["ls-tree", "-r", "--name-only", ref, "--", "."]).split("\n").filter(Boolean);
  if (!files.length) throw new Error(`${ref} has no files under ${dir}`);
  const prefix = git(dir, ["rev-parse", "--show-prefix"]).trim();
  for (const f of files) {
    const rel = prefix && f.startsWith(prefix) ? f.slice(prefix.length) : f;
    const dest = join(out, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, git(dir, ["show", `${ref}:${f}`]));
  }
  return out;
}

export interface Side { bundle: Bundle; label: string; cleanup?: () => void }

/** Resolve one side of a comparison: a bundle file, or the instance at a git ref, or (no value) the instance now. */
export async function resolveSide(dir: string, value: string | undefined): Promise<Side> {
  const abs = resolve(dir);
  if (!value) return { bundle: (await buildBundle(abs)).bundle, label: "the instance now" };
  if (value.endsWith(".json") && existsSync(value)) return { bundle: JSON.parse(readFileSync(value, "utf8")), label: basename(value) }; // sideName adds the build date
  const tmp = instanceAtRef(abs, value);
  const { bundle } = await buildBundle(tmp, { built: value });
  // a git ref by its name and the date of its commit
  let when = "";
  try { when = git(abs, ["log", "-1", "--format=%cs", value]).trim(); } catch { /* not a commit here */ }
  return { bundle, label: when ? `${value} of ${when}` : value, cleanup: () => rmSync(tmp, { recursive: true, force: true }) }; // a temporary directory
}

export async function diffCli(dir: string, args: string[]): Promise<number> {
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const from = opt("--from"), to = opt("--to");
  if (!from) { process.stderr.write(`usage: ${invocation()} diff <instance-dir> --from <bundle.json | git ref | edition folder> [--to <bundle.json | git ref | edition folder>] [--save] [--json]\n`); return 2; }
  const a = await resolveSide(dir, from), b = await resolveSide(dir, to);
  try {
    const d = diffBundles(a.bundle, b.bundle, { from: a.label, to: b.label });
    if (args.includes("--save")) {
      const ddir = join(resolve(dir), "diffs");
      mkdirSync(ddir, { recursive: true });
      const name = `${a.label}..${b.label}`.replace(/[^A-Za-z0-9._-]+/g, "-") + ".json";
      writeFileSync(join(ddir, name), JSON.stringify(d, null, 2) + "\n");
      process.stderr.write(`saved ${relative(process.cwd(), join(ddir, name))}; the next build shows it on the Changes page\n`);
    }
    console.log(args.includes("--json") ? JSON.stringify(d, null, 2) : diffMd(d, `What changed: ${b.bundle.instance.title}`, { ...DIGEST.names(a.bundle), ...DIGEST.names(b.bundle) }));
    return 0;
  } finally { a.cleanup?.(); b.cleanup?.(); }
}
