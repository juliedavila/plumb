import { invocation } from "./invocation.ts";
// `bun plumb.ts portfolio brief <portfolio>`: what needs a person across the designs, as Markdown,
// read-only. It composes the portfolio in memory (nothing is written, not even build/ or portfolio.lock) and lists, in
// this order: teams over capacity, undeclared crossings, stale pins, exceptions near their end, slowdowns due for
// review, proposed root patches with their verdicts, stated and measured values apart, and discovered current-state
// records waiting for a person. Ids stay in, because an agent acts on them. The skill's first command for portfolio work.
import type { PortfolioMode } from "../types.ts";
import { portfolioPages } from "../site/portfolio-build.ts";
import { daysBetween, isDate } from "./estimate.ts";

const cut = (s: string, n = 160) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
/** An exception or a slowdown this close to its end, or past it, needs a person now. */
export const NEAR_END_DAYS = 30;
export const REVIEW_SOON_DAYS = 14;

export async function portfolioBriefMd(target: string, opts: { mode?: PortfolioMode; built?: string } = {}): Promise<string> {
  const p = await portfolioPages(target, opts);
  const d = p.data, page = d.page!, L = d.load;
  const today = page.today;
  const out: string[] = [`# Brief: ${d.portfolio.title} (${d.portfolio.mode === "presenting" ? "presenting released editions" : "working copies"})`, "",
    `Built ${d.engine.built}. Root build hash \`${d.lock.root.hash}\` identifies root inputs, patch records and notes. It is not provenance.based_on. For a new root patch, use the model hash printed by \`${invocation()} build <root>\`.`, "", page.sentence, "",
    ...page.designs.map((x) => `- \`${x.namespace}\`: ${x.label}`), "", "## Needs a person", ""];
  const section = (title: string, lines: string[]) => { out.push(`### ${title} (${lines.length})`, "", ...(lines.length ? lines : ["- none"]), ""); };

  section("Teams over capacity", (L?.teams ?? []).filter((t) => t.over).map((t) => `- \`${t.team}\` ${t.name} (${t.severity}): ${cut(t.text, 260)}`));
  section("Undeclared crossings", d.seams.undeclared.map((c) => {
    const v = page.seams.flatMap((s) => s.undeclared).find((x) => x.id === c.id);
    return `- \`${c.id}\` (${c.severity ?? "warning"}${c.mark?.relevant ? ", security-relevant" : ""}): ${cut([v?.text, v?.why, v?.excepted].filter(Boolean).join(" "), 300)}`;
  }));
  section("Stale pins", page.findings.filter((f) => f.rule === "xref-pin-stale").map((f) => `- \`${f.subject}\`: ${cut(f.text, 300)}`));
  const exceptionEnd = (until?: string) => {
    if (!until) return undefined;
    if (isDate(until)) return until.slice(0, 10);
    const m = page.roadmap.rows.flatMap((r) => r.milestones).find((x) => x.id === until);
    return m?.target;
  };
  section(`Exceptions ended or within ${NEAR_END_DAYS} days of their end`, d.seams.seams.flatMap((s) => s.exceptions.map((x) => ({ s, x }))).filter(({ x }) => {
    if (x.state === "ended") return true;
    const end = exceptionEnd(x.until);
    return !!end && daysBetween(today, end) <= NEAR_END_DAYS;
  }).map(({ s, x }) => {
    const end = exceptionEnd(x.until), view = page.seams.find((v) => v.key === s.key)!.exceptions[s.exceptions.indexOf(x)];
    return `- seam \`${s.key}\`: ${view.text}${end ? ` Ends ${end} (${daysBetween(today, end)} days).` : ""}`;
  }));
  section("Slowdowns due for review", (L?.slowdowns ?? []).filter((b) => b.flags.length || (b.review_by && daysBetween(today, b.review_by) <= REVIEW_SOON_DAYS)).map((b) => `- \`${b.id}\` (${b.state}) on \`${b.activity}\`: ${b.review_by ? `review by ${b.review_by} (${daysBetween(today, b.review_by)} days)` : "no review date"}${b.flags.length ? `; ${b.flags.join("; ")}` : ""}`));
  section("Proposed root patches", p.impacts.map((im) => `- \`${im.patch}\` ${cut(im.title, 90)} (\`${im.file}\`): verdict ${im.verdict.level}. ${cut(page.patches.find((x) => x.id === im.patch)?.effect ?? im.effect, 300)}`));
  section("Stated and measured apart", page.estimates.filter((e) => e.gap?.over).map((e) => `- \`${e.record}\` ${e.field} (${e.teamName ?? e.team ?? "no team"}, ${e.what}): ${e.gap!.text}`));
  const waiting = p.designs.flatMap((x) => (x.bundle.current?.records ?? []).filter((c) => c.state === "discovered").map((c) => `- \`${x.namespace}:${c.part}\` ${cut(c.name, 60)}: ${c.disposition ?? "no disposition"}. ${cut(c.text)}`));
  section("Discovered current-state records waiting for a person to confirm", waiting);
  const errors = page.findings.filter((f) => f.severity === "error");
  out.push(`## Errors across the portfolio (${errors.length})`, "", ...(errors.length ? errors.map((f) => `- \`${f.pack}/${f.rule}@${f.subject}\`${f.design ? ` (in ${page.designs.find((x) => x.namespace === f.design)?.title ?? f.design}'s build)` : ""}: ${cut(f.text)}`) : ["- none"]), "",
    `Run \`${invocation()} portfolio check <portfolio>\` for every finding, and \`${invocation()} portfolio build <portfolio>\` for the page.`, "");
  return out.join("\n");
}
