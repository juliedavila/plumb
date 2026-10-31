import { invocation } from "../core/invocation.ts";
// `bun plumb.ts tracker <discover|draft-mapping|reconcile|export|measure> <instance|root> ...`: the tracker workflow, files only.
//
//   discover <instance> --from <dir> [--adapter jira]   raw tracker REST JSON -> <instance>/tracker/inventory.json
//   draft-mapping <instance> [--force]                  inventory -> tracker/mapping.yaml (mapping.draft.yaml if one exists)
//   reconcile <instance> [--from <dir>]                 units vs issues -> tracker/reconcile.json
//   export <instance> [--out <file>]                    unlinked units -> tracker/jira-import.csv
//
// On a shared root (its engine.yaml says kind: root), draft-mapping drafts an org mapping and measure measures the
// teams' standing work (src/tracker/org-cli.ts); discover works the same on both.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { compile } from "../core/compile.ts";
import { loadInstance } from "../core/load.ts";
import type { TrackerReconcile } from "../types.ts";
import { getAdapter } from "./adapter.ts";
import { FILES, loadTracker, trackerDir } from "./load.ts";
import { readRaw } from "./raw.ts";
import { reconcile } from "./reconcile.ts";
import { isOrgMapping } from "./mapping.ts";
import { isRootDir } from "../core/root.ts";
import { ORG_TRACKER_USAGE, orgTrackerCli } from "./org-cli.ts";
import { inventoryChanges } from "./inventory-diff.ts";

export const TRACKER_USAGE = `usage:
  ${invocation()} tracker discover      <instance-dir> --from <raw-export-dir> [--adapter jira]
  ${invocation()} tracker draft-mapping <instance-dir> [--force]
  ${invocation()} tracker reconcile     <instance-dir> [--from <raw-export-dir>]
  ${invocation()} tracker export        <instance-dir> [--out <file>]
${ORG_TRACKER_USAGE}`;

const opt = (args: string[], name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

export function reconcileMd(r: TrackerReconcile, title: string): string {
  const L = [`# Tracker reconciliation: ${title}`, ""];
  const c = r.counts;
  L.push("| Group | Count |", "|---|---|",
    `| Linked (confirmed or labelled) | ${c.linked} |`, `| Likely matches to confirm | ${c.proposed} |`, `| Units with no issue | ${c.unitsWithoutIssue} |`,
    `| Issues with no unit | ${c.issuesWithoutUnit} |`, `| Status disagreements | ${c.statusDisagreements} |`, `| Issue under another phase | ${c.phaseDisagreements} |`,
    `| Dependencies on one side only | ${c.dependencyOneSided} |`, "");
  const sec = (h: string, xs: string[]) => { if (xs.length) L.push(`## ${h}`, "", ...xs, ""); };
  sec("Linked", r.linked.map((l) => `- \`${l.unit}\` = ${l.issue} (${l.how === "label" ? "label" : `confirmed${l.confirmed_by ? ` by ${l.confirmed_by}` : ""}${l.confirmed_at ? ` on ${l.confirmed_at}` : ""}`})`));
  sec("Likely matches to confirm in links.yaml", r.proposed.map((p) => `- \`${p.unit}\` ~ ${p.issue}, score ${p.score}: ${p.reasons.join(", ")}`));
  sec("Units with no issue", r.unitsWithoutIssue.map((u) => `- \`${u}\``));
  sec("Issues with no unit", r.issuesWithoutUnit.map((i) => `- ${i.issue} ${i.summary} (${i.type}, phase ${i.phase})`));
  sec("Status disagreements", r.statusDisagreements.map((d) => `- \`${d.unit}\` is ${d.unitStatus}; ${d.issue} is "${d.trackerStatus}" (${d.mapped})`));
  sec("Issue under another phase", r.phaseDisagreements.map((d) => `- \`${d.unit}\` is in ${d.unitPhase}; ${d.issue} is ${d.issuePhase ? `under ${d.issuePhase}` : "under no mapped phase"}`));
  sec("Dependencies on one side only", r.dependencyOneSided.map((d) => `- \`${d.unit}\` -> \`${d.dependsOn}\` (${d.issue} -> ${d.dependsOnIssue}): only in the ${d.side}`));
  sec("Problems", r.problems.map((p) => `- ${p}`));
  return L.join("\n");
}

export async function trackerCli(args: string[]): Promise<number> {
  const [sub, instIn, ...rest] = args;
  if (!sub || !instIn) { console.error(TRACKER_USAGE); return 2; }
  const instDir = resolve(instIn);
  const tdir = trackerDir(instDir);

  if (sub === "discover") {
    const from = opt(rest, "--from");
    if (!from) { console.error("tracker discover needs --from <dir>: the directory holding the raw REST responses\n" + TRACKER_USAGE); return 2; }
    const adapter = getAdapter(opt(rest, "--adapter") ?? "jira");
    const raw = readRaw(from);
    const inv = adapter.discover(raw);
    inv.source = { dir: relative(instDir, resolve(from)) || ".", files: raw.files.map((f) => f.name) };
    const inventoryFile = join(tdir, FILES.inventory);
    const before = existsSync(inventoryFile) ? JSON.parse(readFileSync(inventoryFile, "utf8")) : undefined;
    const changes = inventoryChanges(before, inv);
    mkdirSync(tdir, { recursive: true });
    writeFileSync(join(tdir, FILES.inventory), JSON.stringify(inv, null, 2) + "\n");
    console.log([
      `# Discovered ${adapter.title}${inv.flavor ? ` (${inv.flavor})` : ""}`, "",
      ...changes.map((line) => `- ${line}`), "",
      `- ${inv.issues} issues in ${inv.projects.length} projects: ${inv.projects.map((p) => `${p.key}${p.style ? ` (${p.style})` : ""}`).join(", ")}`,
      `- hierarchy: ${inv.hierarchy.map((h) => `${h.level}: ${h.types.join("/")} (${h.count})`).join(", ")}`,
      `- fields that matter: ${inv.fields.filter((f) => f.role !== "other").map((f) => `${f.name} [${f.role}] ${f.count}`).join(", ")}`,
      `- link types: ${inv.linkTypes.map((l) => `${l.name} ${l.count}`).join(", ")}`,
      `- statuses: ${inv.statuses.map((s) => `${s.name} (${s.categoryName}) ${s.count}`).join(", ")}`,
      `- ${inv.components.length} components, ${inv.labels.length} labels, ${inv.fixVersions.length} fix versions, ${inv.containers.length} epics and above`,
      ...inv.notes.map((n) => `- note: ${n}`),
      `- wrote ${join(tdir, FILES.inventory)}`, "",
    ].join("\n"));
    return 0;
  }

  // a shared root: its org mapping measures the teams' standing work
  if (isRootDir(instDir)) return orgTrackerCli(sub, instDir, rest);
  if (sub === "measure") { console.error(`tracker measure reads a shared root's org mapping; ${instIn} is not a shared root (its engine.yaml does not say kind: root)`); return 2; }

  const inst = loadInstance(instDir);
  const t = loadTracker(instDir, { from: opt(rest, "--from") });
  if (isOrgMapping(t?.mapping)) { console.error(`tracker/mapping.yaml here is an org mapping (kind: org): it belongs in a shared root's tracker/, where ${invocation()} tracker measure <root> reads it`); return 1; }

  if (sub === "draft-mapping") {
    if (!t?.inventory) { console.error(`no ${FILES.inventory} in ${tdir}: run tracker discover first`); return 1; }
    const c = compile(inst);
    const text = getAdapter(t.inventory.adapter).draftMapping(t.inventory, c.model, c.plan);
    const target = existsSync(join(tdir, FILES.mapping)) && !rest.includes("--force") ? join(tdir, "mapping.draft.yaml") : join(tdir, FILES.mapping);
    writeFileSync(target, text);
    console.log(`wrote ${target}${target.endsWith("draft.yaml") ? ` (mapping.yaml exists and is kept; compare the two, or pass --force to replace it)` : ""}. Edit it until it is right; \`${invocation()} check\` validates it against the inventory.`);
    return 0;
  }

  if (!t?.mapping) { console.error(`no ${FILES.mapping} in ${tdir}: run tracker draft-mapping and edit it first`); return 1; }
  if (!t.issues) { console.error(`no live state: ${t.problems.map((p) => p.message).join("; ") || "pass --from <raw-export-dir> or run tracker discover"}`); return 1; }
  const c = compile(inst);
  const namespace = t.namespace ?? inst.ns?.namespace;
  const rec = reconcile({ model: c.model, plan: c.plan, mapping: t.mapping, issues: t.issues, links: t.links, ...(namespace ? { namespace } : {}) });

  if (sub === "reconcile") {
    writeFileSync(join(tdir, FILES.reconcile), JSON.stringify(rec, null, 2) + "\n");
    console.log(reconcileMd(rec, inst.config.title));
    console.log(`\nwrote ${join(tdir, FILES.reconcile)}. Confirm a likely match by adding it to ${join(tdir, FILES.links)}.`);
    return 0;
  }

  if (sub === "export") {
    if (!t.inventory) { console.error(`no ${FILES.inventory}: run tracker discover first`); return 1; }
    const file = getAdapter(t.mapping.adapter).exportStructure(c.plan, t.mapping, t.inventory, rec, c.model);
    const out = resolve(opt(rest, "--out") ?? join(tdir, file.name));
    writeFileSync(out, file.content);
    console.log([`wrote ${out}`, ...file.notes.map((n) => `- ${n}`)].join("\n"));
    return 0;
  }

  console.error(`unknown tracker command "${sub}"\n${TRACKER_USAGE}`);
  return 2;
}
