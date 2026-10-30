// `bun plumb.ts tracker <draft-mapping|measure> <root>`: the tracker workflow on a shared root, whose org mapping
// (tracker/mapping.yaml, kind: org) measures the teams' standing work. Files
// only: an agent saves the raw export (one search over the teams' projects for issues updated within the window, with
// their status history), and the engine reads it and never calls the tracker.
//
//   discover <root> --from <dir>          as for an instance (src/tracker/cli.ts): raw export -> tracker/inventory.json
//   draft-mapping <root> [--force]        inventory + org layer -> tracker/mapping.yaml (kind: org), or mapping.draft.yaml
//   measure <root> [...]                  export + mapping -> tracker/measures/<as_of>.json, and with --draft-patch one
//                                         proposed root patch in patches/ holding every measured change of the run

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { TrackerLink } from "../types.ts";
import { loadRoot } from "../core/root.ts";
import { estimateSettings, readOrgView } from "../core/org.ts";
import { isDate } from "../core/estimate.ts";
import { canonicalJson, natCompare } from "../core/util.ts";
import { parseTime } from "../core/flow.ts";
import { getAdapter } from "./adapter.ts";
import { exportSource, FILES, loadTracker, trackerDir } from "./load.ts";
import { isOrgMapping } from "./mapping.ts";
import { validateOrgMapping } from "./validate.ts";
import { parseLinks } from "./links.ts";
import { measureBau } from "./bau.ts";
import { measureMd, writeMeasure } from "./measures.ts";
import { draftRefresh, writeRefresh } from "./refresh.ts";

export const ORG_TRACKER_USAGE = `  bun plumb.ts tracker draft-mapping <root-dir> [--force]          a shared root: an org mapping (kind: org) from the inventory and org.yaml
  plumb tracker measure       <root-dir> [--from <raw-export-dir>] [--as-of <YYYY-MM-DD>] [--portfolio <portfolio.yaml>] [--today <YYYY-MM-DD>]
                                  [--draft-patch (--agent <name> [--tool <tool>] [--model <model>] | --by <role>) [--requested-by <role>] [--limits]]`;

const opt = (args: string[], name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

/** The designs a portfolio composes, with the links.yaml each holds: design work an issue is linked to rather than labelled. */
export function portfolioLinks(file: string, rootDir: string): { designs: { namespace: string; links: TrackerLink[] }[]; notes: string[] } {
  const notes: string[] = [];
  let raw: any;
  try { raw = Bun.YAML.parse(readFileSync(file, "utf8")); } catch (e) { throw new Error(`${file} does not read: ${(e as Error).message}`); }
  const base = dirname(resolve(file));
  if (raw?.root && resolve(base, String(raw.root)) !== resolve(rootDir)) notes.push(`The portfolio's root is ${raw.root}, not this root; its designs' links are read all the same.`);
  const designs: { namespace: string; links: TrackerLink[] }[] = [];
  for (const d of Array.isArray(raw?.designs) ? raw.designs : []) {
    if (!d || typeof d !== "object" || d.from == null) continue;
    const dir = resolve(base, String(d.from));
    let ns = d.namespace != null ? String(d.namespace) : undefined;
    if (!ns && existsSync(join(dir, "engine.yaml"))) { try { ns = (Bun.YAML.parse(readFileSync(join(dir, "engine.yaml"), "utf8")) as any)?.namespace; } catch { /* named by the portfolio or not at all */ } }
    if (!ns) { notes.push(`The design at ${d.from} has no namespace, so its links cannot name its units; skipped.`); continue; }
    const lp = join(dir, "tracker", FILES.links);
    if (!existsSync(lp)) continue;
    const { links, problems } = parseLinks(readFileSync(lp, "utf8"));
    for (const p of problems) notes.push(`${ns}: ${p}`);
    designs.push({ namespace: String(ns), links });
  }
  return { designs: designs.sort((a, b) => natCompare(a.namespace, b.namespace)), notes };
}

export async function orgTrackerCli(sub: string, rootDir: string, rest: string[]): Promise<number> {
  const tdir = trackerDir(rootDir);
  if (sub === "reconcile" || sub === "export") {
    console.error(`${rootDir} is a shared root: its tracker measures the teams' standing work (bun plumb.ts tracker measure <root>). Reconcile and export line up a design's units with issues, so run them on a design.`);
    return 2;
  }
  const root = loadRoot(rootDir);
  if (root.problems.length) { console.error(root.problems.join("\n")); return 1; }
  const today = opt(rest, "--today") ?? new Date().toISOString().slice(0, 10);
  if (!isDate(today)) { console.error(`--today is "${today}", not a date (YYYY-MM-DD)`); return 2; }
  const view = readOrgView(root, { today });
  if (!root.org || !view) { console.error("the root has no org layer (org.yaml), so there are no teams or activities to measure; add org.yaml first"); return 1; }
  const teams = view.teams.map((t) => ({ id: t.id, name: t.name }));
  const activities = view.activities.map((a) => ({ id: a.id, name: a.name, team: a.team.replace(/^org:/, "") }));

  if (sub === "draft-mapping") {
    const t = loadTracker(rootDir);
    if (!t?.inventory) { console.error(`no ${FILES.inventory} in ${tdir}: run bun plumb.ts tracker discover <root> --from <export dir> first`); return 1; }
    const adapter = getAdapter(t.inventory.adapter);
    if (!adapter.draftOrgMapping) { console.error(`the ${adapter.title} adapter cannot draft an org mapping yet; write tracker/mapping.yaml with kind: org by hand`); return 1; }
    const text = adapter.draftOrgMapping(t.inventory, { teams, activities });
    const target = existsSync(join(tdir, FILES.mapping)) && !rest.includes("--force") ? join(tdir, "mapping.draft.yaml") : join(tdir, FILES.mapping);
    writeFileSync(target, text);
    console.log(`wrote ${target}${target.endsWith("draft.yaml") ? " (mapping.yaml exists and is kept; compare the two, or pass --force to replace it)" : ""}. Edit it until it is right; \`bun plumb.ts check <root>\` validates it against the inventory.`);
    return 0;
  }

  if (sub !== "measure") { console.error(`unknown tracker command "${sub}" for a shared root\n${ORG_TRACKER_USAGE}`); return 2; }
  const asOf = opt(rest, "--as-of");
  if (asOf !== undefined && !isDate(asOf)) { console.error(`--as-of is "${asOf}", not a date (YYYY-MM-DD)`); return 2; }
  const draft = rest.includes("--draft-patch"), limits = rest.includes("--limits");
  const agentName = opt(rest, "--agent"), by = opt(rest, "--by");
  if (limits && !draft) { console.error("--limits proposes WIP limits inside the drafted refresh; pass it with --draft-patch"); return 2; }
  if (draft && !agentName && !by) { console.error("--draft-patch needs who drafts the refresh: --agent <name> for an agent (with --tool, default Claude Code), or --by <role> for a person"); return 2; }
  if (agentName && by) { console.error("pass --agent or --by, not both: a patch has one author"); return 2; }

  const from = opt(rest, "--from");
  const t = loadTracker(rootDir, { ...(from ? { from } : {}) });
  if (!t) { console.error(`no tracker/ folder in ${rootDir}: save the export, then run bun plumb.ts tracker discover <root> --from <export dir>`); return 1; }
  if (t.problems.length) { console.error(t.problems.map((p) => `${p.file}: ${p.message}`).join("\n")); return 1; }
  if (!t.inventory) { console.error(`no ${FILES.inventory} in ${tdir}: run bun plumb.ts tracker discover <root> --from <export dir> first`); return 1; }
  if (!t.mapping) { console.error(`no ${FILES.mapping} in ${tdir}: run bun plumb.ts tracker draft-mapping <root> and edit the result`); return 1; }
  if (!isOrgMapping(t.mapping)) { console.error("tracker/mapping.yaml is a design's own mapping; a shared root's says kind: org (bun plumb.ts tracker draft-mapping <root> drafts one)"); return 1; }
  if (!t.issues) { console.error("there is no export to measure: pass --from <raw-export-dir>, or set tracker.export in the root's engine.yaml"); return 1; }
  const missing = validateOrgMapping(t.mapping, t.inventory, { teams, activities }).filter((p) => p.kind === "missing");
  if (missing.length) {
    console.error(["The mapping names what the tracker or the org layer does not hold, so nothing was measured:", ...missing.map((p) => `- ${p.message}`), "Fix tracker/mapping.yaml (bun plumb.ts check <root> lists the same), then measure again."].join("\n"));
    return 1;
  }

  // the window ends at the export's own date, else the newest update in it, unless --as-of says otherwise
  let end: { at: string; from: "export" | "latest-update" | "as-of" };
  if (asOf) end = { at: `${asOf}T00:00:00Z`, from: "as-of" };
  else if (t.exportedAt) end = { at: t.exportedAt, from: "export" };
  else {
    const newest = Math.max(...t.issues.map((i) => parseTime(i.updated)).filter((x) => !Number.isNaN(x)));
    if (!Number.isFinite(newest)) { console.error("the export does not say when it was taken and no issue says when it was updated: pass --as-of <YYYY-MM-DD>"); return 1; }
    end = { at: new Date(newest).toISOString().replace(/\.000Z$/, "Z"), from: "latest-update" };
  }

  let designs: { namespace: string; links: TrackerLink[] }[] | undefined;
  const extra: string[] = [];
  const pf = opt(rest, "--portfolio");
  if (pf) { try { const r = portfolioLinks(pf, rootDir); designs = r.designs; extra.push(...r.notes); } catch (e) { console.error((e as Error).message); return 1; } }

  const src = exportSource(rootDir, t.inventory, from)!;
  const files = readdirSync(src.dir).filter((f) => f.endsWith(".json")).sort(natCompare);
  const mappingBytes = readFileSync(join(tdir, FILES.mapping));
  const snap = measureBau({
    issues: t.issues, inventory: t.inventory, mapping: t.mapping, teams, activities, end, measured: today,
    source: { dir: relative(rootDir, src.dir) || ".", files },
    mappingSha256: new Bun.CryptoHasher("sha256").update(mappingBytes).digest("hex"),
    ...(designs ? { designs, portfolio: relative(rootDir, resolve(pf!)) } : {}),
  });
  snap.notes.push(...extra);
  const gap = estimateSettings(root).gap.capacity;
  const { file, written } = writeMeasure(rootDir, snap);
  console.log(measureMd(snap, file, written, view, gap, String(root.config.title ?? root.config.name ?? "")));

  if (!draft) return 0;
  const d = draftRefresh(snap, file, root, view, {
    created: today, limits, gap,
    ...(agentName ? { agent: { name: agentName, tool: opt(rest, "--tool") ?? "Claude Code", ...(opt(rest, "--model") ? { model: opt(rest, "--model")! } : {}) } } : {}),
    ...(by ? { by } : {}),
    ...(opt(rest, "--requested-by") ? { requestedBy: opt(rest, "--requested-by")! } : {}),
  });
  if (!d) { console.log("\nNothing to propose: every value this run measured is already in force."); return 0; }
  const same = (root.patches ?? []).find((p) => p.status === "proposed" && canonicalJson(p.ops) === canonicalJson(d.ops));
  if (same) { console.log(`\nThis refresh is already proposed as ${same.id} (${same.file ?? ""}); nothing new written.`); return 0; }
  const path = writeRefresh(rootDir, d);
  const check = loadRoot(rootDir, { with: d.id });
  const errors = Object.entries(check.results ?? {}).filter(([k]) => k.endsWith(d.file)).flatMap(([, r]) => r.errors);
  console.log([``, `Drafted ${d.id}, proposed: ${path}. It changes nothing until it is accepted; accept or reject it whole.`,
    ...d.changes.map((c) => `- ${c.name}: ${c.field} ${c.before === undefined ? "not stated" : c.field === "share" ? c.before.toFixed(2) : c.before} to ${c.field === "share" ? c.after.toFixed(2) : c.after} (${c.confidence})`),
    ...(errors.length ? ["", "It does not apply cleanly, so fix it before anyone accepts it:", ...errors.map((e) => `- ${e}`)] : [])].join("\n"));
  return errors.length ? 1 : 0;
}
