// The Teams page (#teams): who owns and who verifies the work, from the team registry and the parts each unit
// changes (src/core/teams.ts). A team, clicked anywhere on the page, opens its card and sets the owner filter, so its
// open work lists above (client/teams.js). Who waits on whom is drawn: teams as boxes, an arrow from the waiting team
// to the team it waits on with the number of dependencies; an arrow lists the actual dependencies as sentences, titles
// first. The matrix stays as the dense alternative. Then the roles by milestone, the unassigned work by milestone, and
// separation of duties as a labelled team-level proxy. Local page only: the deck leaves it out.
import type { Bundle, TeamFacts } from "../types";
import { esc } from "./html";
import { count, fmt, list, para, quote, sentence, verb } from "./prose";
import { FLOWUI } from "./flow";

const pct = (n: number, of: number) => (!of ? "0%" : n > 0 && Math.round((n / of) * 100) === 0 ? "under 1%" : `${Math.round((n / of) * 100)}%`);
const unitLink = (id: string) => `<a href="#plan/unit/${encodeURIComponent(id)}" data-unit="${esc(id)}"><span class="id">${esc(id)}</span></a>`;
const partLink = (b: Bundle, id: string) => `<a href="#model/element/${encodeURIComponent(id)}" data-element="${esc(id)}">${esc(b.model.elements.find((e) => e.id === id)?.name ?? id)}</a>`;
const teamName = (b: Bundle, id: string) => b.model.teams.find((x) => x.id === id)?.name ?? id;
/** A team, anywhere on the page: a click opens its card and sets the owner filter (client/teams.js). */
export const teamLink = (b: Bundle, id: string, label?: string) => `<a class="team-open" href="#teams?owner=${encodeURIComponent(id)}" data-team-open="${esc(id)}" data-ref="team:${esc(id)}">${esc(label ?? teamName(b, id))}</a>`;
const unitTitle = (b: Bundle, id: string) => b.plan.units.find((u) => u.id === id)?.title ?? id;
/** "Product's", or "(AI platform serving operations)" after the title when a name would not read as a possessive. */
const owned = (b: Bundle, team: string, unit: string) => {
  const n = teamName(b, team);
  const t = `<a href="#plan/unit/${encodeURIComponent(unit)}" data-unit="${esc(unit)}">${esc(quote(unitTitle(b, unit)))}</a>`;
  return /^[A-Za-z][A-Za-z ]{0,22}$/.test(n) && !/ and | owners$|s$/.test(n) ? `${esc(n)}'s ${t}` : `${t} (${esc(n)})`;
};
/** One dependency as a sentence, titles first and ids after: Product's “Agree the target” waits on Platform's “Export…”. */
export function waitSentence(b: Bundle, from: string, to: string, unit: string, dep: string): string {
  return `${owned(b, from, unit)} waits on ${owned(b, to, dep)} <span class="id small">${esc(unit)} → ${esc(dep)}</span>`;
}

export function teamsBrief(b: Bundle): string {
  const t = b.teams!;
  const seen = new Set<string>();
  const units = b.plan.units.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)));
  const open = units.filter((u) => u.status !== "done").length;
  // this design's own parts, owned by teams the registry declares; outside parts are another home's to own (as core counts them)
  const own = b.model.elements.filter((e) => !e.home);
  const registry = new Set(b.model.teams.map((x) => x.id));
  const owning = new Set(own.map((e) => e.owner).filter((o): o is string => !!o && registry.has(o))).size;
  const parts = own.length, unowned = t.unownedParts.length;
  const un = t.unassigned.reduce((n, g) => n + g.open, 0);
  const out: string[] = [`The registry declares ${count(b.model.teams.length, "team")}; ${fmt(owning)} of them own parts`];
  out.push(unowned ? `${fmt(unowned)} of ${count(parts, "part")} (${pct(unowned, parts)}) have no owner team` : "Every part has an owner team");
  out.push(un ? `${fmt(un)} of ${count(open, "open unit")} (${pct(un, open)}) ${verb(un, "has", "have")} no owner team` : "Every open unit has an owner team");
  const top = t.load[0];
  const tied = top ? t.load.filter((l) => l.open === top.open) : [];
  if (top && tied.length === 1) out.push(`${quote(teamName(b, top.team))} owns the most open work: ${fmt(top.open)} of ${count(open, "unit")} (${pct(top.open, open)})`);
  else if (top && top.open) out.push(`${list(tied.map((l) => quote(teamName(b, l.team))), { max: 3, more: "other teams" })} each own the most open work: ${fmt(top.open)} of ${count(open, "unit")} (${pct(top.open, open)})`);
  return para(out);
}

/**
 * Who waits on whom, drawn: the busiest teams (at most `max`) on a ring, an arrow from each waiting team to the team it
 * waits on, its width and its label the number of dependencies. A pair waiting both ways gets two curved arrows.
 * Each arrow is a button: it shows the dependencies behind it as sentences (the lists are in the markup, hidden).
 */
export function waitsDiagram(b: Bundle, t: TeamFacts, max = 7, maxEdges = 14): { svg: string; lists: string; shown: string[]; edges: TeamFacts["waitsOn"] } {
  const r = ring(b, t.waitsOn, {
    max, maxEdges, marker: "wa-head", key: (e) => `${e.from}|${e.to}`,
    label: (e) => `${teamName(b, e.from)} waits on ${teamName(b, e.to)}: ${count(e.count, "dependency", "dependencies")}`,
    aria: (n) => `Who waits on whom: ${count(n, "team")} and the dependencies between them`,
  });
  const lists = r.edges.map((e) => `<div class="wait-list" data-wait-list="${esc(`${e.from}|${e.to}`)}" hidden><h3>${esc(`${teamName(b, e.from)} waits on ${teamName(b, e.to)}`)} <span class="count">${fmt(e.count)}</span></h3><ul class="rows">${e.pairs.map(([u, d]) => `<li>${waitSentence(b, e.from, e.to, u, d)}</li>`).join("")}</ul></div>`).join("");
  return { svg: r.svg, lists, shown: r.shown, edges: r.edges };
}

/**
 * Teams on a ring and arrows between them: the busiest teams (at most `max`), the strongest arrows (at most
 * `maxEdges`), each arrow a button keyed for the list it shows. Shared by the plan's waits and the stream's handoffs.
 */
function ring<E extends { from: string; to: string; count: number }>(b: Bundle, all: E[], o: { max: number; maxEdges: number; marker: string; key: (e: E) => string; label: (e: E) => string; aria: (n: number) => string; cls?: string; order?: string[]; badge?: (e: E) => string }): { svg: string; shown: string[]; edges: E[] } {
  const max = o.max, maxEdges = o.maxEdges;
  const inv = new Map<string, number>();
  for (const e of all) { inv.set(e.from, (inv.get(e.from) ?? 0) + e.count); inv.set(e.to, (inv.get(e.to) ?? 0) + e.count); }
  const order = new Map((o.order ?? b.model.teams.map((x) => x.id)).map((x, i) => [x, i]));
  const shown = [...inv.keys()].sort((x, y) => inv.get(y)! - inv.get(x)! || (order.get(x) ?? 0) - (order.get(y) ?? 0)).slice(0, max)
    .sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
  const on = new Set(shown);
  // the strongest arrows among them: a ring of seven fully joined is a hairball; the list below has every pair
  const edges = all.filter((e) => on.has(e.from) && on.has(e.to)).sort((x, y) => y.count - x.count).slice(0, maxEdges);
  if (shown.length < 2) return { svg: "", shown, edges };
  const W = 760, H = shown.length <= 4 ? 380 : 470, cx = W / 2, cy = H / 2, rx = W / 2 - 120, ry = H / 2 - 50;
  const bw = 160, bh = 44;
  const pos = new Map(shown.map((id, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / shown.length; return [id, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }]; }));
  const maxC = Math.max(...edges.map((e) => e.count), 1);
  // where a line from the centre of a box leaves it, towards (tx, ty)
  const exit = (p: { x: number; y: number }, tx: number, ty: number, pad = 4) => {
    const dx = tx - p.x, dy = ty - p.y, sx = (bw / 2 + pad) / Math.abs(dx || 1e-9), sy = (bh / 2 + pad) / Math.abs(dy || 1e-9), s = Math.min(sx, sy);
    return { x: p.x + dx * s, y: p.y + dy * s };
  };
  const key = o.key;
  const both = new Set(edges.filter((e) => edges.some((f) => f.from === e.to && f.to === e.from)).map(key));
  const arrows = edges.map((e, i) => {
    const a = pos.get(e.from)!, c = pos.get(e.to)!;
    const mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2, dx = c.x - a.x, dy = c.y - a.y, len = Math.hypot(dx, dy) || 1;
    const bend = both.has(key(e)) ? 28 : 0, nx = -dy / len, ny = dx / len;
    const qx = mx + nx * bend, qy = my + ny * bend;
    const s = exit(a, qx, qy), d = exit(c, qx, qy, 8);
    const sw = 1.5 + (4 * e.count) / maxC;
    const lx = (s.x + 2 * qx + d.x) / 4, ly = (s.y + 2 * qy + d.y) / 4;
    const label = o.label(e);
    return `<g class="wedge${o.cls ? ` ${o.cls}` : ""}" data-wait="${esc(key(e))}" tabindex="0" role="button" aria-label="${esc(label)}. Show them." aria-controls="${o.marker === "wa-head" ? "wait-detail" : "handoff-detail"}"><title>${esc(label)}</title>
<path class="whit" d="M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${d.x.toFixed(1)},${d.y.toFixed(1)}"/>
<path class="wline" d="M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${d.x.toFixed(1)},${d.y.toFixed(1)}" stroke-width="${sw.toFixed(1)}" marker-end="url(#${o.marker})"/>
${(() => { const t = o.badge ? o.badge(e) : fmt(e.count); const w = Math.max(22, 8 + t.length * 7); return w <= 22 ? `<g class="wcount"><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="11"/><text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle">${esc(t)}</text></g>` : `<g class="wcount"><rect x="${(lx - w / 2).toFixed(1)}" y="${(ly - 11).toFixed(1)}" width="${w}" height="22" rx="11"/><text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle">${esc(t)}</text></g>`; })()}</g>`;
  }).join("\n");
  const nodes = shown.map((id) => {
    // the whole name, on two lines when it is long: never cut
    const p = pos.get(id)!, n = teamName(b, id);
    const words = n.split(" "), lines: string[] = [];
    if (n.length <= 20) lines.push(n); else { let a = ""; for (const w of words) { if (a && (a + " " + w).length > Math.ceil(n.length / 2) + 2 && lines.length === 0) { lines.push(a); a = w; } else a = a ? a + " " + w : w; } lines.push(a); }
    const short = lines.length === 1 ? esc(lines[0]) : lines.map((l, i) => `<tspan x="${p.x.toFixed(1)}" dy="${i ? 15 : -7}">${esc(l)}</tspan>`).join("");
    return `<g class="tnode" data-team-open="${esc(id)}" data-ref="team:${esc(id)}" tabindex="0" role="link" aria-label="${esc(`${n}: open its card and its work`)}"><title>${esc(n)}</title>
<rect x="${(p.x - bw / 2).toFixed(1)}" y="${(p.y - bh / 2).toFixed(1)}" width="${bw}" height="${bh}" rx="8"/><text x="${p.x.toFixed(1)}" y="${(p.y + 5).toFixed(1)}" text-anchor="middle">${short}</text></g>`;
  }).join("\n");
  const svg = `<svg class="waits-svg${o.cls ? ` ${o.cls}` : ""}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(o.aria(shown.length))}">
<defs><marker id="${o.marker}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="whead"/></marker></defs>
${arrows}
${nodes}</svg>`;
  return { svg, shown, edges };
}

/**
 * Handoffs in the stream: the model's handoff relationships between owner teams (b.flow.teamHandoffs), drawn on the
 * same ring, an arrow from the team that hands work on to the team that takes it. Each arrow lists its handoffs: the
 * two steps, what is handed on, and the wait behind it with its source. Distinct from the plan's waits: this is how
 * work moves through the stream today, not which improvement work waits on which.
 */
export function handoffsSection(b: Bundle): string {
  const f = b.flow;
  if (!f || !f.teamHandoffs.length) return "";
  const el = (id: string) => b.model.elements.find((e) => e.id === id);
  const rel = (id: string) => b.model.relationships.find((r) => r.id === id);
  const onPath = new Map<string, { view: string; days?: string }>();
  for (const st of f.streams) for (const h of st.hops) {
    const bh = h.measuredBehind ? `${FLOWUI.days(h.measuredBehind.days)} measured in the tracker` : h.waitBehind ? FLOWUI.val(h.waitBehind, f.asOf) : undefined;
    onPath.set(h.relationship, { view: st.title, ...(bh ? { days: `${bh}, at ${el(h.behind ?? "")?.name ?? ""}` } : {}) });
  }
  // the wait behind each team pair's handoffs: the tracker's measure where it has one, else the declared value
  const waitOf = new Map<string, number>();
  for (const st of f.streams) for (const h of st.hops) { const d = h.measuredBehind?.days ?? h.waitBehind?.value; if (d != null) waitOf.set(h.relationship, Math.max(waitOf.get(h.relationship) ?? 0, d)); }
  const edgeWait = (e: { relationships: string[] }) => { const ds = e.relationships.map((id) => waitOf.get(id)).filter((x): x is number => x != null); return ds.length ? ds.reduce((a, c) => a + c, 0) : undefined; };
  const ranked = [...f.teamHandoffs].sort((x, y) => (edgeWait(y) ?? -1) - (edgeWait(x) ?? -1) || y.count - x.count || teamName(b, x.from).localeCompare(teamName(b, y.from)));
  const r = ring(b, f.teamHandoffs, {
    badge: (e) => { const w = edgeWait(e); return w == null ? "no wait" : `${FLOWUI.days(w)}`; },
    max: 8, maxEdges: 16, marker: "ho-head", cls: "handoffs", key: (e) => `h|${e.from}|${e.to}`,
    // around the ring in the order a change meets the teams along the first stream, so most arrows run round it
    order: [...new Set([...(f.streams[0]?.path ?? []).map((id) => el(id)?.owner).filter((x): x is string => !!x), ...b.model.teams.map((t) => t.id)])],
    label: (e) => `${teamName(b, e.from)} hands work to ${teamName(b, e.to)}: ${count(e.count, "handoff")}${edgeWait(e) != null ? `, ${FLOWUI.days(edgeWait(e)!)} of wait behind` : ""}`,
    aria: (n) => `Handoffs in the stream: ${count(n, "team")} and the handoffs between them`,
  });
  const sentence = (id: string) => {
    const x = rel(id); if (!x) return "";
    const a = el(x.from), c = el(x.to), p = onPath.get(id);
    return `<li><span>${partLink(b, x.from)} (${esc(teamName(b, a?.owner ?? ""))}) hands ${x.label ? `“${esc(x.label)}”` : "work"} to ${partLink(b, x.to)} (${esc(teamName(b, c?.owner ?? ""))})</span> ${p ? `<span class="small fg2" style="flex-basis:100%">${p.days ? `Wait behind it: ${esc(p.days)}` : "No step waits behind it before the next handoff"}</span>` : `<span class="small muted">Not on a stream view's path</span>`}</li>`;
  };
  const lists = f.teamHandoffs.map((e) => `<div class="wait-list" data-wait-list="${esc(`h|${e.from}|${e.to}`)}" hidden><h3>${esc(`${teamName(b, e.from)} hands work to ${teamName(b, e.to)}`)} <span class="count">${fmt(e.count)}</span></h3><ul class="rows">${e.relationships.map(sentence).join("")}</ul></div>`).join("");
  const total = f.teamHandoffs.reduce((n, e) => n + e.count, 0);
  const st = f.streams[0];
  const intro = para([
    `The model draws ${count(total, "handoff")} between ${count(new Set(f.teamHandoffs.flatMap((e) => [e.from, e.to])).size, "team")}: the moments a change passes from one team's step to another's`,
    st ? `Along “${st.title}” a change crosses ${fmt(st.handoffs)} of them, ${FLOWUI.limitWords(st.handoffs, st.limit)}` : "",
    "An arrow runs from the team that hands work on to the team that takes it, labelled with the wait behind it; the list ranks them by that wait. Select one for the steps",
  ]);
  const rows = ranked.map((e) => { const w = edgeWait(e); return `<li><button type="button" class="wpair" data-wait="${esc(`h|${e.from}|${e.to}`)}"><span class="t"><b>${esc(teamName(b, e.from))}</b> hands work to <b>${esc(teamName(b, e.to))}</b></span><span class="rv">${esc(w == null ? `${count(e.count, "handoff")}, no wait behind` : `${FLOWUI.days(w)} of wait behind${e.count > 1 ? ` ${count(e.count, "handoff")}` : ""}`)}</span></button></li>`; }).join("");
  return `<section class="section" id="handoffs" aria-labelledby="h-handoffs"><div class="section-head"><h2 id="h-handoffs">Handoffs in the stream</h2><p>How work moves between teams in the stream itself, from the model's handoff relationships. Not the plan: the plan's waits are below.</p></div>
<p class="reading">${esc(intro)}</p>
${r.svg ? `<div class="waits-wrap">${r.svg}</div>` : ""}
<div class="wait-detail" id="handoff-detail" aria-live="polite"><p class="small muted wait-hint">Select an arrow or a pair in the list to see its handoffs.</p>${lists}</div>
<ul class="rows waits-list">${rows}</ul></section>`;
}

/** Owner, plan versus tracker: units whose owner team in the plan is not the team the tracker assigns their issue. */
export function ownerVersusTracker(b: Bundle): string {
  const rec = b.tracker?.reconcile;
  if (!rec || !b.tracker?.mapping?.owner_team) return "";
  const tn = b.tracker.adapter === "jira" ? "Jira" : b.tracker.adapter;
  const ds = rec.ownerDisagreements ?? [];
  const rows = ds.map((d) => { const st = rec.state?.[d.unit]; return `<li><a href="#plan/unit/${encodeURIComponent(d.unit)}" data-unit="${esc(d.unit)}" title="${esc(d.unit)}">${esc(unitTitle(b, d.unit))}</a> <span class="small fg2">The plan: ${esc(list(d.owners.map((x) => teamName(b, x))))} · ${esc(tn)}: ${esc(teamName(b, d.trackerTeam))}${st ? ` (${esc(d.issue)})` : ""}</span></li>`; }).join("");
  return `<section class="section" id="owner-tracker" aria-labelledby="h-owner-tracker"><div class="section-head"><h2 id="h-owner-tracker">Owner: plan versus tracker</h2><p>The plan's owner comes from the parts a unit changes; ${esc(tn)}'s comes from its team field. Typing a name into the model cannot settle a disagreement: a person decides which is right.</p></div>
${ds.length ? `<p class="reading">${esc(sentence(`${count(ds.length, "matched unit")} ${verb(ds.length, "has", "have")} one owner team in the plan and another in ${tn}`))}</p><ul class="rows">${rows}</ul><p class="small"><a href="#tracker/match/owner">Open them on the Tracker page</a></p>` : `<p class="empty">${esc(`Every matched unit has the same owner team in the plan and in ${tn}.`)}</p>`}</section>`;
}

export function teamsPage(b: Bundle): string {
  const t = b.teams;
  if (!t) return "";
  const name = (id: string) => teamName(b, id);
  const seen = new Set<string>();
  const units = b.plan.units.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)));
  const open = units.filter((u) => u.status !== "done").length;
  const phases = [...b.plan.phases].sort((a, c) => (a.order ?? 0) - (c.order ?? 0));
  const cur = phases.find((p) => units.some((u) => u.phase === p.id && u.status !== "done"));
  const mn = (id: string) => quote(phases.find((p) => p.id === id)?.name ?? id);
  const heavy = new Set(b.findings.filter((f) => f.pack === "teams" && f.rule === "team-load").map((f) => f.at));

  // who runs each team: its lead, or "No lead named" (never a finding)
  const lead = (id: string) => { const l = b.model.teams.find((x) => x.id === id)?.lead; return l ? esc(l) : `<span class="novalue">No lead named</span>`; };
  // who owns the open work
  const rows = b.model.teams.map((tm) => {
    const owned = b.model.elements.filter((e) => e.owner === tm.id).length, verified = b.model.elements.filter((e) => e.verifier === tm.id).length;
    const ld = t.load.find((l) => l.team === tm.id);
    return { id: tm.id, owned, verified, open: ld?.open ?? 0 };
  }).filter((r) => r.owned || r.verified || r.open).sort((x, y) => y.open - x.open || y.owned - x.owned || x.id.localeCompare(y.id));
  const ownTable = `<div class="table-wrap"><table class="team-table"><caption class="sr-only">Teams and the work they own</caption><thead><tr><th scope="col">Team</th><th scope="col">Lead</th><th scope="col" class="n">Parts owned</th><th scope="col" class="n">Parts verified</th><th scope="col" class="n">Open units owned</th></tr></thead><tbody>${rows.map((r) =>
    `<tr data-team-row="${esc(r.id)}"${heavy.has(r.id) ? ' class="warn-row"' : ""}><th scope="row">${teamLink(b, r.id)}${heavy.has(r.id) ? ` <a class="tag warning" href="#checks/rule/teams/team-load">Over ${Math.round(t.maxShare * 100)}%</a>` : ""}</th><td data-team-lead="${esc(r.id)}">${lead(r.id)}</td><td class="n">${fmt(r.owned)}</td><td class="n">${fmt(r.verified)}</td><td class="n">${r.open ? `<a href="#plan/units?owner=${encodeURIComponent(r.id)}&amp;status=open" title="${esc(`List ${name(r.id)}'s open units on the Plan`)}">${fmt(r.open)} of ${fmt(open)} (${pct(r.open, open)})</a>` : "0"}</td></tr>`).join("")}</tbody></table></div>`;

  // who waits on whom: the drawing first, the matrix and the ranked list as its dense twins
  const edges = t.waitsOn;
  const involved = [...new Set(edges.flatMap((e) => [e.from, e.to]))].sort((x, y) => name(x).localeCompare(name(y)));
  const cell = (a: string, c: string) => edges.find((e) => e.from === a && e.to === c)?.count ?? 0;
  const matrix = involved.length && involved.length <= 12 ? `<div class="table-wrap"><table class="waits-matrix"><caption class="sr-only">Team waits on team: open dependencies between units</caption><thead><tr><th scope="col">This team waits on…</th>${involved.map((c) => `<th scope="col" class="n">${teamLink(b, c)}</th>`).join("")}</tr></thead><tbody>${involved.map((a) =>
    `<tr><th scope="row">${teamLink(b, a)}</th>${involved.map((c) => a === c ? `<td class="n muted">·</td>` : `<td class="n${cell(a, c) ? " has" : ""}">${cell(a, c) ? `<button type="button" class="wcell" data-wait="${esc(`${a}|${c}`)}" aria-label="${esc(`${name(a)} waits on ${name(c)}: ${count(cell(a, c), "dependency", "dependencies")}. Show them.`)}">${fmt(cell(a, c))}</button>` : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
  const d = waitsDiagram(b, t);
  const drawnKeys = new Set(d.edges.map((e) => `${e.from}|${e.to}`));
  const extraLists = edges.filter((e) => !drawnKeys.has(`${e.from}|${e.to}`)).slice(0, 40).map((e) => `<div class="wait-list" data-wait-list="${esc(`${e.from}|${e.to}`)}" hidden><h3>${esc(`${name(e.from)} waits on ${name(e.to)}`)} <span class="count">${fmt(e.count)}</span></h3><ul class="rows">${e.pairs.map(([u, dd]) => `<li>${waitSentence(b, e.from, e.to, u, dd)}</li>`).join("")}</ul></div>`).join("");
  const topEdges = edges.slice(0, 12).map((e) => `<li><button type="button" class="wpair" data-wait="${esc(`${e.from}|${e.to}`)}"><span class="t"><b>${esc(name(e.from))}</b> waits on <b>${esc(name(e.to))}</b></span><span class="rv">${count(e.count, "dependency", "dependencies")}</span></button><span class="meta small fg2">${waitSentence(b, e.from, e.to, e.pairs[0][0], e.pairs[0][1])}${e.pairs.length > 1 ? ` <span class="muted">and ${fmt(e.pairs.length - 1)} more</span>` : ""}</span></li>`).join("");
  const allAmong = edges.filter((e) => d.shown.includes(e.from) && d.shown.includes(e.to)).length;
  const scope = d.shown.length < involved.length || d.edges.length < allAmong ? `The drawing shows the ${fmt(d.shown.length)} teams with the most dependencies${d.edges.length < allAmong ? ` and the ${fmt(d.edges.length)} strongest arrows between them` : ""}, of ${count(involved.length, "team")} that wait or are waited on; the list below ranks every pair` : "";
  const waits = edges.length
    ? `<p class="reading">${esc(para([`${count(edges.length, "pair")} of teams wait on each other through ${count(edges.reduce((n, e) => n + e.count, 0), "open dependency", "open dependencies")} between their work`, "An arrow runs from the team that waits to the team it waits on; select an arrow to see the work behind it, or a team to open its card and its work", scope]))}</p>
${d.svg ? `<div class="waits-wrap">${d.svg}</div>` : ""}
<div class="wait-detail" id="wait-detail" aria-live="polite"><p class="small muted wait-hint">Select an arrow${matrix ? ", a number in the matrix" : ""} or a pair in the list to see its dependencies.</p>${d.lists}${extraLists}</div>
<ul class="rows waits-list">${topEdges}</ul>${edges.length > 12 ? `<p class="small muted">and ${count(edges.length - 12, "more pair")}, fewer dependencies each.</p>` : ""}
${matrix ? `<details class="disc twin"><summary>The same as a matrix</summary><div class="body">${matrix}</div></details>` : ""}`
    : `<p class="empty">No team waits on another: no open unit depends on a unit another team owns.</p>`;

  // roles by milestone
  const roleRows = t.byGate.map((r) => `<tr><th scope="row">${teamLink(b, r.team)}</th>${phases.map((p) => { const g = r.gates[p.id]; return `<td class="n">${g ? [g.owner ? `${fmt(g.owner)} owned` : "", g.verifier ? `${fmt(g.verifier)} verified` : ""].filter(Boolean).join(" · ") : ""}</td>`; }).join("")}</tr>`).join("");
  const roles = t.byGate.length ? `<div class="table-wrap"><table class="roles-table"><caption class="sr-only">Units each team owns and verifies, by milestone</caption><thead><tr><th scope="col">Team</th>${phases.map((p) => `<th scope="col" class="n">${esc(p.name || p.id)}</th>`).join("")}</tr></thead><tbody>${roleRows}</tbody></table></div>` : `<p class="empty">No unit has an owner or verifier team.</p>`;

  // unassigned
  const un = t.unassigned.reduce((n, g) => n + g.open, 0);
  const curList = cur ? t.unassigned.find((g) => g.phase === cur.id)!.units.filter((id) => units.find((u) => u.id === id)?.status !== "done") : [];
  const unassigned = `<p class="reading">${esc(un ? para([`${fmt(un)} of ${count(open, "open unit")} ${verb(un, "has", "have")} no owner team: the parts ${un === 1 ? "it changes have" : "they change have"} none, and ${un === 1 ? "it names" : "they name"} none`, `By milestone: ${list(t.unassigned.filter((g) => g.open).map((g) => `${fmt(g.open)} in ${mn(g.phase)}`))}`]) : "Every open unit has an owner team.")}</p>
${cur && curList.length ? `<p class="small fg2">In the current milestone, ${esc(mn(cur.id))}:</p><ul class="chips">${curList.map((id) => `<li class="chip">${unitLink(id)}</li>`).join("")}</ul>` : un && cur ? `<p class="small fg2">${esc(`None in the current milestone, ${mn(cur.id)}.`)} <a href="#checks/rule/teams/unit-has-owner">The finding lists them by milestone</a></p>` : ""}
${t.unownedParts.length ? `<details class="disc"><summary>Parts with no owner team <span class="count">${t.unownedParts.length}</span></summary><div class="body"><ul class="rows">${t.unownedParts.map((p) => `<li>${partLink(b, p)}</li>`).join("")}</ul></div></details>` : ""}`;

  // separation of duties, team level
  const s = t.separation;
  const sepFindings = s.parts.length + s.pairs.length;
  const why: Record<string, (t: string) => string> = {
    owner: (t) => `owned and verified by ${t}`, "co-owner": (t) => `co-owned and verified by ${t}`,
    excluded: (t) => `verified by ${t}, which it must stay independent of`, "excluded-owner": (t) => `owned by ${t}, which it must stay independent of`,
  };
  const sep = `<div class="callout info">${'<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-info"/></svg>'}<div><b>A team-level proxy.</b> Independence is between people; the model holds teams. A verifier from a team that neither owns the part nor is excluded from it is necessary for that independence, not sufficient, and this page is the only place it is shown.</div></div>
<p class="reading">${esc(para([
    s.checkedParts ? `Judged on the ${count(s.checkedParts, "part")} that name a verifier: ${s.failedParts ? `${fmt(s.passedParts)} ${verb(s.passedParts, "passes", "pass")} and ${fmt(s.failedParts)} ${verb(s.failedParts, "fails", "fail")}` : s.checkedParts === 1 ? "it passes" : "all pass"}` : "No part names a verifier yet, so none is judged",
    s.notAssessedParts ? `Not assessed on the other ${count(s.notAssessedParts, "part")}, which name no verifier` : "",
    s.checkedPairs + s.unmappedPairs + s.unassignedPairs ? `Of the role pairs units must separate, ${fmt(s.checkedPairs)} could be checked at team level${s.pairs.length ? ` and ${fmt(s.pairs.length)} ${verb(s.pairs.length, "falls", "fall")} to one team` : ""}; ${count(s.unassignedPairs, "pair")} ${verb(s.unassignedPairs, "waits", "wait")} on a team for one of the roles, and ${count(s.unmappedPairs, "pair")} ${verb(s.unmappedPairs, "names", "name")} a role the engine has no field for` : "",
  ]))}</p>
${sepFindings ? `<ul class="rows">${s.parts.map((p) => `<li>${partLink(b, p.part)} <span class="small fg2">${esc(why[p.reason](name(p.team)))}</span></li>`).join("")}${s.pairs.map((p) => `<li>${unitLink(p.unit)} <span class="small fg2">${esc(p.roles[0])} and ${esc(p.roles[1])} both fall to ${esc(name(p.team))}</span></li>`).join("")}</ul>` : ""}`;

  return `<section class="page" id="teams" data-page="teams" aria-labelledby="h-teams">
<div class="page-head"><h1 id="h-teams" tabindex="-1">Teams</h1></div>
<p class="brief">${esc(teamsBrief(b))}</p>
<section class="section team-work" id="team-work" aria-labelledby="h-team-work" hidden><div class="section-head"><h2 id="h-team-work">Open work</h2><p id="team-work-sub"></p></div><div id="team-work-list"></div></section>
<section class="section" aria-labelledby="h-own"><div class="section-head"><h2 id="h-own">Who owns the open work</h2><p>A unit's owner comes from the parts it changes; a unit names its own only where it differs. Select a team for its card and its work.</p></div>${ownTable}</section>
${handoffsSection(b)}
${ownerVersusTracker(b)}
<section class="section" id="waits-on" aria-labelledby="h-waits"><div class="section-head"><h2 id="h-waits">${b.flow ? "Waits in the improvement plan" : "Who waits on whom"}</h2>${b.flow ? "<p>Which team's planned work waits on another team's planned work: dependencies between units of the plan, not handoffs in the stream.</p>" : ""}</div>${waits}</section>
<section class="section" aria-labelledby="h-roles"><div class="section-head"><h2 id="h-roles">Roles by milestone</h2><p>The owner does the work and answers for it; the verifier checks it independently before it counts as done. Each cell counts the units a team owns and verifies in that milestone.</p></div>${roles}</section>
<section class="section" aria-labelledby="h-unassigned"><div class="section-head"><h2 id="h-unassigned">Work with no owner team</h2></div>${unassigned}</section>
<section class="section" aria-labelledby="h-sep"><div class="section-head"><h2 id="h-sep">Separation of duties</h2></div>${sep}</section>
</section>`;
}
