// Present mode: the deck (bundle.deck, built from deck.yaml by src/core/deck.ts) as full-screen slides in the same
// page, route #present or #present/<n>. The markup is static, so every slide exists without the script; the client
// (client/present.js) shows one slide at a time, takes the keys, and opens the speaker notes for the presenter's own
// screen. Sized for a 1440 x 900 screen share: type scales with the smaller of the viewport's width and height.
import type { Bundle, DeckItem, DeckMilestone, DeckSlide } from "../types";
import { RAG_ICON, RAG_WORD } from "./status";
import { esc } from "./html";
import { humanDate } from "../core/deck";

const icon = (name: string, cls = "icon") => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
const TONE_ICON: Record<string, string> = { fail: "fail", warning: "warning", pass: "pass", info: "info" };
const GRADE_ICON: Record<string, string> = { evidence: "g-evidence", inference: "g-inference", judgment: "g-judgment", untested: "g-untested" };

function item(it: DeckItem): string {
  const ic = it.rag ? RAG_ICON[it.rag] : it.grade ? GRADE_ICON[it.grade] : it.tone ? TONE_ICON[it.tone] : "";
  const cls = it.rag ? `st-rag-${it.rag}` : it.grade ? `g-${it.grade}` : it.tone ? `st-${it.tone}` : "";
  return `<li class="${it.tone ? "tone-" + esc(it.tone) : ""}">${ic ? `<span class="mk ${esc(cls)}">${icon(ic)}</span>` : `<span class="mk dot" aria-hidden="true"></span>`}<div><p class="t">${esc(it.text)}</p>${it.verdict ? `<p class="deck-verdict v-${esc(it.verdict.level)}">${icon(it.verdict.level === "fail" ? "rag-red" : it.verdict.level === "caution" ? "rag-amber" : "rag-green", `icon st-rag-${it.verdict.level === "fail" ? "red" : it.verdict.level === "caution" ? "amber" : "green"}`)}<span>Verdict: ${esc(it.verdict.text)}</span></p>` : ""}${it.sub ? `<p class="s">${esc(it.sub)}</p>` : ""}</div></li>`;
}

/** The status as an icon and a word; the marker as a word with its own icon. Colour is never alone. */
const rag = (st: DeckMilestone["status"]) => `<span class="rag st rag-${st}">${icon(RAG_ICON[st])}<span class="w">${RAG_WORD[st]}</span></span>`;
const marker = (m: DeckMilestone) => m.marker === "blocked" ? `<span class="marker blocked">${icon("rag-red", "icon icon-sm")}Held up</span>` : m.marker === "attention" ? `<span class="marker attention">${icon("rag-amber", "icon icon-sm")}Needs attention</span>` : "";

/** Where we stand: the milestone road, each stop its name, what it delivers, its status with the one-line reason and a marker. */
function road(ms: DeckMilestone[]): string {
  return `<ol class="msroad${ms.length > 4 ? " dense" : ""}">${ms.map((m) => `<li class="ms rag-${m.status}${m.current ? " current" : ""}${m.reached ? " reached" : ""}">
<div class="ms-st">${m.reached ? `<span class="st rag-green">${icon("rag-green")}<span class="w">Reached</span></span>` : rag(m.status)}${marker(m)}${m.override ? `<span class="marker override">Manual status</span>` : ""}${m.computed ? `<span class="marker computed rag-${m.computed}">${icon(RAG_ICON[m.computed], "icon icon-sm")}Computed ${RAG_WORD[m.computed]}</span>` : ""}</div>
<div class="ms-body"><p class="ms-name">${esc(m.name)}${m.current ? ` <span class="now">Now</span>` : ""}</p>${m.delivers ? `<p class="ms-del">${esc(m.delivers)}</p>` : ""}${m.flow ? `<p class="ms-flow">${esc(m.flow)}</p>` : ""}</div>
<p class="ms-why">${esc(m.reason)}${m.override ? ` <span class="ovr">${esc(m.override)}</span>` : ""}${(m.flags ?? []).map((f) => `<span class="ms-flag">${icon("warning", "icon icon-sm")} ${esc(f)}</span>`).join("")}</p></li>`).join("")}</ol>`;
}

/** What each milestone means: the value it delivers and what reaching it lets us do. */
function means(ms: DeckMilestone[]): string {
  return `<ol class="msmeans${ms.length > 4 ? " dense" : ""}">${ms.map((m) => `<li class="${m.reached ? "reached" : ""}"><div><p class="ms-name">${esc(m.name)}${m.reached ? ` <span class="now">Reached</span>` : m.current ? ` <span class="now">Now</span>` : ""}</p><p class="ms-lead">${m.leadName ? `Lead: ${esc(m.leadName)}` : "No lead named"}</p></div><dl><dt>Delivers</dt><dd>${esc(m.delivers ?? "Not written yet")}</dd><dt>Lets us</dt><dd>${esc(m.means ?? "Not written yet")}</dd></dl></li>`).join("")}</ol>`;
}

/** Path to green: a block per milestone, its status and reason, then the steps in order with who owns each. */
function groups(gs: NonNullable<DeckSlide["groups"]>): string {
  return `<div class="pgroups">${gs.map((g) => `<section class="pg"><h3>${g.rag ? rag(g.rag) : ""}<span>${esc(g.title)}</span></h3>${g.lead ? `<p class="pg-why">${esc(g.lead)}</p>` : ""}<ol class="steps">${g.items.map((it, j) => it.more ? `<li class="more">${esc(it.text)}</li>` : `<li class="tone-${esc(it.tone ?? "")}"><span class="num">${j + 1}</span><div><p class="t">${it.rag ? `<span class="st rag-${it.rag}">${icon(RAG_ICON[it.rag], "icon icon-sm")}<span class="sr-only">${RAG_WORD[it.rag]}: </span></span> ` : ""}${esc(it.text)}</p>${it.sub ? `<p class="s">${esc(it.sub)}</p>` : ""}</div></li>`).join("")}</ol></section>`).join("")}</div>`;
}

function asOfLine(b: Bundle, s: DeckSlide): string {
  if (!s.asOf) return "";
  const tracker = b.tracker?.adapter === "jira" ? "Jira" : b.tracker?.adapter ?? "Tracker";
  return `<p class="asof">${icon("info", "icon icon-sm")}<span>As of: model built <time datetime="${esc(s.asOf.built)}">${esc(humanDate(s.asOf.built, true))}</time>${s.asOf.tracker
    ? ` · ${esc(tracker)} export: newest issue change <time datetime="${esc(s.asOf.tracker)}" data-age>${esc(humanDate(s.asOf.tracker, true))}</time>` : ""}</span></p>`;
}

function slide(b: Bundle, s: DeckSlide, i: number, n: number): string {
  const head = s.template === "title"
    ? `<div class="cover"><p class="kicker">${esc(b.instance.title)}</p><h2 tabindex="-1">${esc(s.title)}</h2>${s.subtitle ? `<p class="sub">${esc(s.subtitle)}</p>` : ""}</div>`
    : `<header><p class="kicker">${esc(b.deck?.title ?? b.instance.title)}</p><h2 tabindex="-1">${esc(s.title)}</h2></header>${s.subtitle ? `<blockquote class="thesis">${esc(s.subtitle)}</blockquote>` : ""}`;
  const table = s.rows?.length ? `<div class="deck-table"><table><thead><tr>${(s.head ?? []).map((h, j) => `<th scope="col"${j ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${s.rows.map((r) =>
    `<tr${r.tone ? ` class="tone-${esc(r.tone)}"` : ""}>${r.cells.map((c, j) => j ? `<td class="n">${esc(c)}</td>` : `<th scope="row">${r.tone === "pass" ? icon("pass", "icon icon-sm st-pass") + " " : r.tone === "warning" ? icon("warning", "icon icon-sm st-warning") + " " : ""}${esc(c)}</th>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
  const items = s.items?.length ? `<ol class="items${s.template === "decisions" ? " numbered" : ""}">${s.items.map(item).join("")}</ol>` : "";
  const notes = `<aside class="notes" hidden aria-label="Speaker notes"><h3>Speaker notes · slide ${i + 1} of ${n}</h3>${s.notes.length ? `<ul>${s.notes.map((x) => `<li data-linkify>${esc(x)}</li>`).join("")}</ul>` : `<p>No notes for this slide.</p>`}</aside>`;
  return `<article class="slide t-${esc(s.template)}" data-slide="${i + 1}" aria-roledescription="slide" aria-label="${esc(`Slide ${i + 1} of ${n}: ${s.title}`)}"${i ? " hidden" : ""}>
<div class="slide-body">${head}${s.lead ? `<p class="lead">${esc(s.lead)}</p>` : ""}${s.milestones?.length ? (s.template === "milestones" ? means(s.milestones) : road(s.milestones)) : ""}${s.groups?.length ? groups(s.groups) : ""}${table}${items}${asOfLine(b, s)}</div>${notes}</article>`;
}

/** The deck section: outside <main>, hidden until the route is #present. Empty when the instance has no deck.yaml. */
export function presentSection(b: Bundle): string {
  const d = b.deck;
  if (!d?.slides.length) return "";
  const n = d.slides.length;
  return `<section class="deck" id="present" aria-label="${esc(`Presentation: ${d.title}`)}" hidden>
<div class="deck-stage">${d.slides.map((s, i) => slide(b, s, i, n)).join("\n")}
<div class="deck-end" id="deck-end" hidden><h2 tabindex="-1">End of the deck</h2><p>Left goes back to the last slide; Esc leaves.</p><button type="button" class="btn" id="deck-mark" hidden>Mark as presented</button></div></div>
<div class="deck-bar"><span class="deck-name">${esc(d.title)}</span><span class="deck-count" id="deck-count" aria-live="polite">1 / ${n}</span>
<span class="deck-acts"><span class="deck-keys" aria-hidden="true">← → move · N notes · Esc leaves</span></span></div>
<div class="deck-notes" id="deck-notes" hidden></div>
</section>`;
}
