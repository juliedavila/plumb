// `bun plumb.ts report <instance> [--presented]`: build, save a compact snapshot in <instance>/reports/, and say what
// changed since the deck's baseline before this one (the last presented snapshot, else the last saved).

import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { buildBundle } from "./bundle.ts";
import { loadReports, makeSnapshot, saveSnapshot } from "./snapshot.ts";
import { DIGEST } from "./digest.ts";
import { PROSE } from "../site/prose.ts";

/** One sentence for what changed since a baseline (the deck's "what changed" slide says it the same way). */
export function sinceLine(b: Awaited<ReturnType<typeof buildBundle>>["bundle"]): string {
  const s = b.sinceReport;
  if (!s) return "No earlier report: this is the first, so the next deck compares with it.";
  const when = s.basis === "presented" ? `the report presented ${s.against.presented}` : `the report saved ${s.against.saved} (none was marked as presented)`;
  if (DIGEST.isEmpty(s.diff)) return PROSE.sentence(`Nothing changed since ${when}`);
  const d = s.diff, parts: string[] = [];
  if (d.findings.added.length) parts.push(PROSE.count(d.findings.added.length, "new finding"));
  if (d.findings.gone.length) parts.push(PROSE.count(d.findings.gone.length, "finding") + " gone");
  if (d.units.done.length) parts.push(PROSE.count(d.units.done.length, "unit") + " newly done");
  if (d.units.ready.length) parts.push(PROSE.count(d.units.ready.length, "unit") + " newly ready");
  if (d.patches.decided.length) parts.push(PROSE.count(d.patches.decided.length, "patch", "patches") + " decided");
  if (d.claims.regraded.length) parts.push(PROSE.count(d.claims.regraded.length, "claim") + " regraded");
  // records: added, removed, changed and re-worded counted apart, so re-derived titles never read as a redesign
  const recKinds = Object.entries(d.counts).filter(([k]) => k !== "finding" && k !== "note" && k !== "patch");
  const sum = (f: "added" | "removed" | "changed" | "reworded") => recKinds.reduce((n, [, c]) => n + (c[f] ?? 0), 0);
  const ad = sum("added"), rm = sum("removed"), ch = sum("changed"), rw = sum("reworded");
  const rec: string[] = [];
  if (ad) rec.push(`${ad} added`); if (rm) rec.push(`${rm} removed`); if (ch) rec.push(`${ch} changed`); if (rw) rec.push(`${rw} reworded (titles or owners only)`);
  // "1 record added, 2 changed and 3 reworded": the noun once, on the first count
  if (rec.length) { rec[0] = rec[0].replace(/^(\d+)/, (n) => `${n} ${Number(n) === 1 ? "record" : "records"}`); parts.push(PROSE.list(rec)); }
  const churn = s.importer ? DIGEST.churnText(d, s.importer) : "";
  return PROSE.sentence(`Since ${when}: ${parts.length ? PROSE.list(parts) : "notes and patches changed"}`) + (churn ? ` ${churn}` : "");
}

export async function reportCli(dir: string, args: string[]): Promise<number> {
  const presented = args.includes("--presented");
  const unknown = args.filter((a) => a !== "--presented");
  if (unknown.length) { process.stderr.write(`usage: plumb report <instance-dir> [--presented]\nunknown argument: ${unknown[0]}\n`); return 2; }
  const { bundle } = await buildBundle(resolve(dir));
  const line = sinceLine(bundle);
  // one snapshot per build: the same build saved again is the snapshot already there (marked presented when asked)
  const same = loadReports(resolve(dir)).filter((r) => r.hash === bundle.engine.hash);
  if (same.length) {
    const keep = same.find((r) => r.presented) ?? same[same.length - 1];
    if (presented && !keep.presented) {
      const { file: rel, ...snap } = keep;
      writeFileSync(join(resolve(dir), rel), JSON.stringify({ ...snap, presented: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") }, null, 1) + "\n");
      console.log(`This build is already saved as ${rel}; marked it as presented: the next deck compares with it.`);
    } else console.log(`This build is already saved as ${keep.file}${keep.presented ? ", marked as presented" : ""}; nothing new written.`);
    console.log(line);
    return 0;
  }
  const file = saveSnapshot(resolve(dir), makeSnapshot(bundle, { presented }));
  console.log(`Saved ${file}${presented ? ", marked as presented: the next deck compares with it" : ""}.`);
  console.log(line);
  return 0;
}
