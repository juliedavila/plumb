// Status on the page: red, amber or green with an icon and a word (never colour alone), a "Blocked" or "Needs
// attention" marker, the reasons in words, a person's override shown as an override, and the path to green as an
// ordered list naming the work by title, the team that owns it (or that it needs an owner) and what it unblocks.
// Everything comes from bundle.status (src/core/status.ts); this file only draws it.
import type { Bundle, MilestoneStatus, PathAction, RagStatus, StatusHistory, StatusOverride } from "../types";
import { esc } from "./html";
import { dayText } from "../core/status";

const icon = (name: string, cls = "icon") => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
export const RAG_ICON: Record<RagStatus, string> = { red: "rag-red", amber: "rag-amber", green: "rag-green" };
export const RAG_WORD: Record<RagStatus, string> = { red: "Red", amber: "Amber", green: "Green" };

/** The status as an icon and a word: red an octagon, amber a triangle, green a ticked circle. */
export function ragHtml(st: RagStatus, size = ""): string {
  return `<span class="st rag-${st}${size ? " " + size : ""}">${icon(RAG_ICON[st])}<span class="w">${RAG_WORD[st]}</span></span>`;
}

/** "Blocked" for red, "Needs attention" for amber; none for green or a milestone already reached. */
export function markerOf(m: MilestoneStatus): "blocked" | "attention" | undefined {
  if (m.reached || m.status === "green") return undefined;
  return m.status === "red" ? "blocked" : "attention";
}
export function markerHtml(m: MilestoneStatus): string {
  const k = markerOf(m);
  return k === "blocked" ? `<span class="tag danger marker">${icon("rag-red", "icon icon-sm")}Held up</span>` : k === "attention" ? `<span class="tag warning marker">${icon("rag-amber", "icon icon-sm")}Needs attention</span>` : "";
}

/** "Set to green by the delivery lead on 20 Oct 2026: …"; with the computed status beside it when the two differ. */
export function overrideText(o: StatusOverride, computed: RagStatus): string {
  const when = o.date ? ` on ${dayText(o.date)}` : "";
  const base = `Set to ${RAG_WORD[o.status].toLowerCase()}${o.by ? ` by ${o.by}` : ""}${when}${o.reason ? `: ${o.reason.replace(/[.\s]+$/, "")}` : ""}${o.review_by ? `; review by ${dayText(o.review_by)}` : ""}.`;
  return computed !== o.status ? `${base} Computed from the plan: ${RAG_WORD[computed].toLowerCase()}.` : base;
}

export function statusOf(b: Bundle, phase: string): MilestoneStatus | undefined { return b.status?.milestones.find((m) => m.phase === phase); }

const unitTitleLink = (b: Bundle, id: string) => {
  const u = b.plan.units.find((x) => x.id === id);
  return u ? `<a href="#plan/unit/${encodeURIComponent(id)}" data-unit="${esc(id)}">${esc(u.title)}</a>` : esc(id);
};
const teamName = (b: Bundle, id: string) => b.model.teams.find((t) => t.id === id)?.name ?? id;

/** A milestone's or a team's lead in words: "Lead: the delivery lead", or "No lead named". */
export function leadLine(lead?: string): string {
  return lead ? `Lead: ${esc(lead)}` : `<span class="novalue">No lead named</span>`;
}

/** One step on the path to green: the action, then who owns it, then what it unblocks (titles first; ids stay in the links). */
export function actionHtml(b: Bundle, a: PathAction, accountable?: string): string {
  const who = a.teams.length
    ? a.teams.slice(0, 3).map((t) => `<a class="team-chip" href="#teams?owner=${encodeURIComponent(t)}" data-team-open="${esc(t)}" data-ref="team:${esc(t)}">${icon("k-team", "icon icon-sm")}${esc(teamName(b, t))}</a>`).join(" ") + (a.teams.length > 3 ? ` <span class="muted small">and other teams</span>` : "")
    : `<span class="tag warning">${icon("warning", "icon icon-sm")}Needs an owner${accountable ? `: ${esc(accountable)} names one` : ""}</span>`;
  const un = a.unblocks.length ? `<span class="small fg2">Unblocks ${a.unblocks.slice(0, 2).map((u) => unitTitleLink(b, u)).join(" and ")}${a.unblocks.length > 2 ? " and the work after them" : ""}</span>` : "";
  return `<li class="act ${a.level}">${icon(RAG_ICON[a.level], `icon st-rag-${a.level}`)}<span class="sr-only">${a.level === "red" ? "Turns red to amber or green: " : "Clears amber: "}</span><div><p class="t" data-linkify>${esc(a.text)}</p><p class="who">${who}${un ? ` ${un}` : ""}</p></div></li>`;
}

/** A milestone's status block: the status, the marker, the override, the reasons, and the path to green. */
export function statusBlock(b: Bundle, phase: string, opts: { pathMax?: number } = {}): string {
  const m = statusOf(b, phase);
  if (!m) return "";
  const head = `<div class="status-head">${ragHtml(m.status)}${markerHtml(m)}${m.override ? `<span class="tag">Manual status</span>` : ""}${m.reached ? `<span class="small fg2">Reached</span>` : ""}</div>`;
  const ov = m.override ? `<p class="small override">${esc(overrideText(m.override, m.computed))}</p>` : "";
  // why a person's call needs a second look: said on the card, the road and the slide alike
  const flags = (m.flags ?? []).map((f) => `<p class="small ovr-flag" data-flag="${f.kind}">${icon("warning", "icon icon-sm")}<span>${esc(f.text)}</span></p>`).join("");
  // who decides the status and who confirms it, where the milestone names a confirmer; else who is accountable
  const acc = m.confirmed_by ? `<p class="small fg2">${esc([m.accountable ? `Status set by: ${m.accountable}` : "", `Confirmed by: ${m.confirmed_by}`].filter(Boolean).join(" · "))}</p>`
    : m.accountable ? `<p class="small fg2">Accountable: ${esc(m.accountable)}</p>` : "";
  const ph = b.plan.phases.find((p) => p.id === phase);
  // who owns delivering it (its lead), apart from who decides its status; a missing lead is said, never flagged
  const lead = `<p class="small fg2 ms-lead" data-milestone-lead="${esc(phase)}">${leadLine(ph?.lead)}</p>`;
  // a "how" disclosure: the file, the key and the field live here, never on the decision surface
  const byHand = `<details class="how" data-by-hand><summary>Set a status by hand</summary><div class="small"><p>Under <code>${esc(phase)}</code> in <code>milestones.yaml</code>: <code>override: { status, reason, date, by, review_by }</code>. Or tell Claude: “Set ${esc(ph?.name ?? phase)} to amber: &lt;reason&gt;, by &lt;your role&gt; today, review by &lt;date&gt;.” Without a reason, date and who, the build refuses it.</p></div></details>`;
  const reasons = m.reasons.length ? `<ul class="reasons">${m.reasons.map((r) => `<li>${icon(RAG_ICON[r.level], `icon icon-sm st-rag-${r.level}`)}<span class="sr-only">${RAG_WORD[r.level]}: </span><span data-linkify>${esc(r.text)}</span></li>`).join("")}</ul>`
    : m.reached ? "" : `<p class="small fg2">Nothing in the plan stands in its way.</p>`;
  const max = opts.pathMax ?? 8;
  const path = m.path.length ? `<h3 class="small fg2" style="margin-top:var(--sp-3)">Path to green</h3><ol class="path">${m.path.slice(0, max).map((a) => actionHtml(b, a, m.accountable)).join("")}</ol>${m.path.length > max ? `<details class="disc"><summary>The rest of the path <span class="count">${m.path.length - max}</span></summary><div class="body"><ol class="path" start="${max + 1}">${m.path.slice(max).map((a) => actionHtml(b, a, m.accountable)).join("")}</ol></div></details>` : ""}` : "";
  return `<div class="status-block" data-status="${m.status}">${head}${ov}${flags}${lead}${acc}${reasons}${path}${m.reached ? "" : byHand}</div>`;
}

/** The status symbols for the sprite. */
export const RAG_SYMBOLS = [
  `<symbol id="i-rag-red" viewBox="0 0 16 16"><path d="M5.1 1h5.8L15 5.1v5.8L10.9 15H5.1L1 10.9V5.1z" fill="currentColor" stroke="none"/><path d="M5.2 8h5.6" stroke="var(--bg-surface)" stroke-width="2" stroke-linecap="round"/></symbol>`,
  `<symbol id="i-rag-amber" viewBox="0 0 16 16"><path d="M8 1.5l7 12.5H1z" fill="currentColor" stroke="none" stroke-linejoin="round"/><path d="M8 6v3.6" stroke="var(--bg-surface)" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.9" r="1" fill="var(--bg-surface)" stroke="none"/></symbol>`,
  `<symbol id="i-rag-green" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor" stroke="none"/><path d="M4.8 8.2l2.2 2.2 4.2-4.6" stroke="var(--bg-surface)" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></symbol>`,
].join("\n");

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso?: string) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso ?? ""); return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]}` : ""; };

/**
 * Status over time: a column per report (oldest first) and this build, a row per milestone with its status and
 * progress, the plan's status, and the load-bearing premises still untested. A report from before status was recorded
 * says "Status not recorded" rather than a colour it never had.
 */
export function historyStrip(b: Bundle, h: StatusHistory | undefined = b.history): string {
  if (!h || !h.columns.length) return "";
  const name = (id: string) => b.plan.phases.find((p) => p.id === id)?.name ?? id;
  const head = h.columns.map((c) => `<th scope="col">${c.now ? "Now" : esc(shortDay(c.saved))}<span class="xs muted">${c.now ? `built ${esc(shortDay(b.engine.built))}` : c.presented ? "presented" : "saved"}</span></th>`).join("");
  const none = `<span class="xs muted">Status not recorded</span>`;
  const cell = (st: RagStatus | undefined, computed: RagStatus | undefined, extra: string) => `<td>${st ? ragHtml(st, "sm") : none}${st && computed && computed !== st ? `<span class="xs muted">computed ${computed}</span>` : ""}${extra}</td>`;
  const rows = h.phases.map((id) => `<tr><th scope="row">${esc(name(id))}</th>${h.columns.map((c) => { const m = c.milestones[id]; return cell(c.recorded ? m?.status : undefined, m?.computed, m && m.total ? `<span class="xs fg2">${m.done} of ${m.total} done</span>` : ""); }).join("")}</tr>`).join("");
  const overall = `<tr class="hist-overall"><th scope="row">The plan</th>${h.columns.map((c) => cell(c.recorded ? c.overall : undefined, undefined, "")).join("")}</tr>`;
  const untested = `<tr><th scope="row">Untested premises much rests on</th>${h.columns.map((c) => `<td>${c.untested == null ? none : esc(String(c.untested))}</td>`).join("")}</tr>`;
  const lead = h.columns.length === 1 ? "One point so far: this build. Each report saved with bun plumb.ts report adds a column, so the next one shows which way each milestone moved."
    : `${h.columns.length - 1} saved ${h.columns.length === 2 ? "report" : "reports"} and this build, oldest first; the same build saved twice is one column.`;
  return `<section class="hist" id="status-history" aria-labelledby="status-history-h"><h2 id="status-history-h">Status over time</h2><p class="small fg2">${esc(lead)}</p><div class="table-wrap"><table class="hist-table"><thead><tr><th scope="col">Milestone</th>${head}</tr></thead><tbody>${rows}${overall}${untested}</tbody></table></div></section>`;
}
