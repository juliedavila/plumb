// The Tracker area: three steps (Discover, Map, Match), each with its status.
// Match is the reconciliation queue: disagreements first, likely matches to confirm with copyable confirm lines, then
// the gaps, with agreement collapsed. The page is read-only: confirming a match is one reviewed line in
// tracker/links.yaml, and tracker state is shown beside a unit, never written into it.
import type { Bundle, Finding } from "../types";
import { esc, plural } from "./html";
import { fmt, list, sentence } from "./prose";
import { PLAN_VS_TRACKER, SETTLE, type SettleGuide } from "../tracker/settle";

/** Why a group appears and how to settle it, under the group's own line (src/tracker/settle.ts). */
export function settleHtml(...gs: { label?: string; g: SettleGuide }[]): string {
  return gs.map(({ label, g }) => `<dl class="settle">${label ? `<p class="small"><b>${esc(label)}</b></p>` : ""}<div><dt>Why this appears</dt><dd>${esc(g.appears)}</dd></div><div><dt>To settle it</dt><dd>${esc(g.settle)}</dd></div></dl>`).join("");
}

interface Helpers {
  unitLink: (id: string) => string;
  status: (kind: string, word: string, size?: string) => string;
  icon: (name: string, cls?: string) => string;
  gateLabel: (phaseId: string) => string;
  route: { unit: (id: string) => string; gate: (id: string) => string; tracker: (s: string) => string };
}

const STATUS: Record<string, string> = { todo: "todo", doing: "doing", done: "done" };

/** The counts the Overview tile, the nav badge and the Match step share. */
export function trackerCounts(b: Bundle): { linked: number; proposed: number; disagree: number; units: number; noIssue: number; noUnit: number } {
  const r = b.tracker?.reconcile;
  if (!r) return { linked: 0, proposed: 0, disagree: 0, units: b.plan.units.length, noIssue: 0, noUnit: 0 };
  const c = r.counts;
  return { linked: c.linked, proposed: c.proposed, disagree: c.statusDisagreements + c.dependencyOneSided + c.phaseDisagreements + (r.ownerDisagreements?.length ?? 0), units: b.plan.units.length, noIssue: c.unitsWithoutIssue, noUnit: c.issuesWithoutUnit };
}

function human(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  if (isNaN(d.getTime())) return iso;
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${m} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function trackerPage(b: Bundle, h: Helpers): string {
  const t = b.tracker!;
  const r = t.reconcile, inv = t.inventory, m = t.mapping;
  const adapter = t.adapter === "jira" ? "Jira" : t.adapter;
  const tf = b.findings.filter((f) => f.pack === "tracker");
  const mapFindings = tf.filter((f) => f.rule === "mapping-covers" || f.at.includes("mapping"));
  const c = trackerCounts(b);
  const info = t.issueInfo ?? {};
  const issue = (k: string) => `<span class="id" style="color:var(--fg)">${esc(k)}</span>`;
  const issueFull = (k: string) => { const i = info[k]; return `${issue(k)}${i ? ` ${esc(i.summary)} <span class="muted small">${esc(i.type)} · ${esc(i.status)}${i.parent ? ` · under ${esc(i.parent)}` : ""}</span>` : ""}`; };

  // freshness: the newest issue update against the build time
  const built = b.engine?.built ? new Date(b.engine.built) : undefined;
  const latest = t.latestUpdate ? new Date(t.latestUpdate.replace(/([+-]\d\d)(\d\d)$/, "$1:$2")) : undefined;
  const ageDays = built && latest && !isNaN(built.getTime()) && !isNaN(latest.getTime()) ? (built.getTime() - latest.getTime()) / 864e5 : undefined;
  const head = `<p class="brief">${esc(adapter)}${inv ? ` · ${plural(inv.issues, "issue")} in ${plural(inv.projects.length, "project")}` : ""}${t.latestUpdate ? ` · newest issue change ${esc(human(t.latestUpdate))}` : ""}${ageDays !== undefined && ageDays > 7 ? ` <span class="tag warning">${Math.floor(ageDays)} days before this build</span>` : ""}</p>
<p class="reading fg2" style="margin-bottom:var(--sp-2)" id="plan-vs-tracker">${esc(PLAN_VS_TRACKER)}</p>
<p class="reading fg2" style="margin-bottom:var(--sp-4)">The model owns structure (units, milestones, dependencies); the tracker owns live state (status, assignee, sprint). The engine reads exported files and never calls the tracker.</p>`;

  const stepStatus = {
    discover: inv ? `${plural(inv.projects.length, "project")} · ${plural(inv.issueTypes, "issue type")} · ${plural(inv.linkTypes.length, "link type")}` : "Not run",
    map: !m ? "Not written" : mapFindings.length ? plural(mapFindings.length, "problem") : "Complete",
    match: r ? [`${fmt(c.linked)} of ${plural(c.units, "unit")} matched`, c.proposed ? `${fmt(c.proposed)} proposed` : "", c.disagree ? `${fmt(c.disagree)} ${c.disagree === 1 ? "disagrees" : "disagree"}` : ""].filter(Boolean).join(" · ") : "Not run",
  };
  const stepper = `<ol class="stepper" aria-label="Tracker steps">${(["discover", "map", "match"] as const).map((s, i) => `<li><a href="${h.route.tracker(s)}" data-step="${s}"><span class="n">Step ${i + 1}</span><b>${s === "discover" ? "Discover" : s === "map" ? "Map" : "Match"}</b><span class="s">${esc(stepStatus[s])}</span></a></li>`).join("")}</ol>`;

  // ---- discover
  let discover = "";
  if (inv) {
    const usedLink = m?.dependency?.link_type;
    const usedField = new Set([m?.owner_team?.field, m?.done_condition?.field].filter(Boolean) as string[]);
    const usedStatus = new Set(Object.keys(m?.status.map ?? {}));
    const byCat = new Map<string, typeof inv.statuses>();
    for (const s of inv.statuses) byCat.set(s.categoryName, [...(byCat.get(s.categoryName) ?? []), s]);
    discover = `<section class="section" aria-labelledby="h-tr-proj"><h2 id="h-tr-proj" style="font-size:var(--fs-lg)">Projects and hierarchy</h2>
<div class="table-wrap reflow" style="margin-top:8px"><table class="reflow inv-table"><thead><tr><th scope="col">Project</th><th scope="col">Name</th><th scope="col">Style</th><th scope="col">Issues</th></tr></thead><tbody>${inv.projects.map((p) => `<tr class="${m?.project && m.project !== p.key ? "unused" : ""}"><td class="lead ${m?.project === p.key ? "used" : ""}" data-label="Project">${esc(p.key)}</td><td class="inline" data-label="">${esc(p.name)}</td><td class="inline" data-label="">${esc(p.style ?? "")}</td><td class="inline n" data-label="Issues">${p.issues}</td></tr>`).join("")}</tbody></table></div>
<p class="small fg2" style="margin-top:8px">Hierarchy: ${inv.hierarchy.map((x) => `level ${x.level}, ${esc(x.types.join(", "))} (${x.count})`).join(" · ")}</p></section>
<section class="section" aria-labelledby="h-tr-links"><h2 id="h-tr-links" style="font-size:var(--fs-lg)">Link types</h2>
<div class="table-wrap reflow" style="margin-top:8px"><table class="reflow inv-table"><thead><tr><th scope="col">Name</th><th scope="col">Outward</th><th scope="col">Inward</th><th scope="col">Used</th></tr></thead><tbody>${inv.linkTypes.map((l) => `<tr class="${l.name === usedLink ? "" : "unused"}"><td class="lead ${l.name === usedLink ? "used" : ""}" data-label="">${esc(l.name)}${l.name === usedLink ? ` <span class="tag accent">used for dependencies</span>` : ""}</td><td class="inline" data-label="Outward">${esc(l.outward)}</td><td class="inline" data-label="Inward">${esc(l.inward)}</td><td class="inline n" data-label="Used">${l.count}</td></tr>`).join("")}</tbody></table></div></section>
<section class="section" aria-labelledby="h-tr-st"><h2 id="h-tr-st" style="font-size:var(--fs-lg)">Statuses by category</h2>
<div class="grid-2" style="margin-top:8px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">${[...byCat].map(([cat, xs]) => `<div class="panel pad"><h3 class="small fg2">${esc(cat)}</h3><ul class="rows">${xs.map((s) => `<li class="${usedStatus.size && !usedStatus.has(s.name) ? "muted" : ""}"><span>${esc(s.name)}</span><span class="muted small num" style="margin-left:auto">${s.count}</span></li>`).join("")}</ul></div>`).join("")}</div></section>
<section class="section" aria-labelledby="h-tr-f"><h2 id="h-tr-f" style="font-size:var(--fs-lg)">Fields with a guessed role</h2>
<div class="table-wrap reflow" style="margin-top:8px"><table class="reflow inv-table"><thead><tr><th scope="col">Field</th><th scope="col">Guessed role</th><th scope="col">On issues</th></tr></thead><tbody>${inv.fields.filter((f) => f.role !== "other").map((f) => `<tr class="${usedField.has(f.id) ? "" : "unused"}"><td class="lead ${usedField.has(f.id) ? "used" : ""}" data-label="">${esc(f.name)} <span class="id">${esc(f.id)}</span>${usedField.has(f.id) ? ` <span class="tag accent">used by the mapping</span>` : ""}</td><td class="inline" data-label="Role">${esc(f.role)}</td><td class="inline n" data-label="On">${f.count}</td></tr>`).join("")}</tbody></table></div></section>
${inv.notes.length ? `<section class="section" aria-labelledby="h-tr-notes"><h2 id="h-tr-notes" style="font-size:var(--fs-lg)">What discovery noticed</h2><div style="display:grid;gap:8px;margin-top:8px">${inv.notes.map((n) => `<div class="callout info">${h.icon("info")}<div>${esc(n)}</div></div>`).join("")}</div></section>` : ""}`;
  } else discover = `<p class="empty">No inventory yet. Save the tracker's raw REST responses to a folder, then run <code>bun plumb.ts tracker discover &lt;instance&gt; --from &lt;dir&gt;</code>.</p>`;

  // ---- map
  let map = "";
  if (m) {
    const at = (kw: RegExp) => mapFindings.filter((f) => kw.test(f.message));
    const line = (text: string, fs: Finding[]) => `<div class="mapline"><span>${text}</span>${fs.map((f) => `<span class="st ${f.severity === "error" ? "fail" : "warning"} sm">${h.icon(f.severity === "error" ? "fail" : "warning")}<span class="w" style="font-weight:400">${esc(f.message)}</span></span>`).join("")}</div>`;
    const pairs = (o: Record<string, string>, left: (k: string) => string) => Object.entries(o).map(([k, v]) => `${left(k)} &#8594; ${esc(v)}`).join(", ");
    const asWord: Record<string, string> = { epic: "an <b>Epic</b>", initiative: "an <b>Initiative</b>", "fix-version": "a <b>fix version</b>", label: "a <b>label</b>" };
    const lines = [
      line(`A milestone is ${asWord[m.phase.as] ?? esc(m.phase.as)}: ${pairs(m.phase.match, (k) => esc(h.gateLabel(k)))}.`, at(/phase/i)),
      line(`A unit is a <b>${esc(m.unit.issue_type)}</b>${m.unit.project ?? m.project ? ` in project <b>${esc(m.unit.project ?? m.project!)}</b>` : ""}; the label <code>${esc(m.unit_label_prefix)}U-05</code> links an issue to unit U-05 exactly.`, at(/issue_type|unit type/i)),
      line(m.dependency ? `A dependency is the <b>${esc(m.dependency.link_type)}</b> link, read ${esc(m.dependency.direction)} from the dependent issue.` : `Dependencies are not compared.`, at(/dependency|link type/i)),
      line(m.owner_team ? `An owner team is ${m.owner_team.as === "component" ? "a <b>component</b>" : m.owner_team.as === "project" ? "a <b>project</b>" : `the field <b>${esc(m.owner_team.field ?? "")}</b>`}: ${pairs(m.owner_team.match, (k) => esc(b.model.teams.find((x) => x.id === k)?.name ?? k))}.` : "Owner teams are not mapped.", at(/owner_team|team/i)),
      line(`The done-condition is the field <b>${esc(m.done_condition?.field ?? "description")}</b>.`, at(/done/i)),
      line(`Status by <b>${esc(m.status.by)}</b>: ${pairs(m.status.map, (k) => esc(k))}.`, at(/status/i)),
    ];
    const placed = new Set<Finding>();
    for (const re of [/phase/i, /issue_type|unit type/i, /dependency|link type/i, /owner_team|team/i, /done/i, /status/i]) for (const f of at(re)) placed.add(f);
    const rest = mapFindings.filter((f) => !placed.has(f));
    map = `<p class="small fg2" style="margin-bottom:8px">Declared by the organization in <code>tracker/mapping.yaml</code> <button type="button" class="copy-btn" data-copy="tracker/mapping.yaml" hidden>Copy path</button>. A person or the agent edits the file; this page only reads it.</p>
<div class="panel pad">${lines.join("")}</div>${rest.length ? `<div style="display:grid;gap:8px;margin-top:8px">${rest.map((f) => `<div class="callout ${f.severity === "error" ? "danger" : "warning"}">${h.icon(f.severity === "error" ? "fail" : "warning")}<div>${esc(f.message)}</div></div>`).join("")}</div>` : ""}`;
  } else map = `<p class="empty">No mapping yet. Run <code>bun plumb.ts tracker draft-mapping &lt;instance&gt;</code>, then edit <code>tracker/mapping.yaml</code>.</p>`;

  // ---- match
  let match = "";
  if (r) {
    const group = (id: string, title: string, n: number, why: string, body: string, open = true, guide = "") =>
      `<section class="section" id="tracker-${id}" aria-labelledby="h-trm-${id}"><details class="disc"${open && n ? " open" : ""}><summary><h3 id="h-trm-${id}" style="margin:0">${esc(title)} <span class="badge${n && open ? " warning" : ""}">${n}</span></h3></summary><div class="body"><p class="small fg2" style="margin-bottom:6px">${esc(why)}</p>${n ? guide + body : `<p class="empty">None.</p>`}</div></details></section>`;
    const readBy = m?.status.by === "name" ? "its name" : "its category";
    const today = (b.engine?.built ?? "").slice(0, 10);
    match += r.problems.length ? `<div style="display:grid;gap:8px;margin-bottom:var(--sp-4)">${r.problems.map((p) => `<div class="callout danger">${h.icon("fail")}<div><b>Problem.</b> ${esc(p)}${/carries the label/.test(p) ? `${/[.!?]$/.test(p) ? "" : "."} <span class="small">To settle it: ${esc(SETTLE.label.settle)}</span>` : ""}</div></div>`).join("")}</div>` : "";
    match += group("status", "Status disagrees", c ? r.counts.statusDisagreements : 0, "The unit's own status and its issue's mapped status differ. Settle it on one side.",
      `<ul class="rows">${r.statusDisagreements.map((d) => `<li>${h.unitLink(d.unit)} <span class="small">plan: <b>${esc(STATUS[d.unitStatus] ?? d.unitStatus)}</b> · ${issue(d.issue)}: <b>${esc(d.trackerStatus)}</b> <span class="muted">(read as ${esc(STATUS[d.mapped] ?? d.mapped)} by ${readBy} in tracker/mapping.yaml)</span></span></li>`).join("")}</ul>`, true, settleHtml({ g: SETTLE.status }));
    match += group("deps", "Dependency on one side only", r.counts.dependencyOneSided, `Compared through the "${m?.dependency?.link_type ?? "dependency"}" link type, between matched units.`,
      `<ul class="rows">${r.dependencyOneSided.map((d) => `<li><span class="tag ${d.side === "model" ? "warning" : ""}">only in the ${d.side === "model" ? "plan" : "tracker"}</span> <span>${d.side === "model" ? `${h.unitLink(d.unit)} depends on ${h.unitLink(d.dependsOn)} in the plan; ${issue(d.issue)} has no link to ${issue(d.dependsOnIssue)}` : `${issue(d.issue)} links to ${issue(d.dependsOnIssue)}; in the plan ${h.unitLink(d.unit)} does not depend on ${h.unitLink(d.dependsOn)}`}</span></li>`).join("")}</ul>`, true, settleHtml(...(r.dependencyOneSided.some((d) => d.side === "model") ? [{ label: "Only in the plan", g: SETTLE["deps-plan"] }] : []), ...(r.dependencyOneSided.some((d) => d.side !== "model") ? [{ label: "Only in the tracker", g: SETTLE["deps-tracker"] }] : [])));
    match += group("phase", "Milestone disagrees", r.counts.phaseDisagreements, "The issue sits under another milestone's container than its unit.",
      `<ul class="rows">${r.phaseDisagreements.map((d) => `<li>${h.unitLink(d.unit)} <span class="small">in ${esc(h.gateLabel(d.unitPhase))}; ${issue(d.issue)} under ${d.issuePhase ? esc(h.gateLabel(d.issuePhase)) : "no mapped milestone"}</span></li>`).join("")}</ul>`, true, settleHtml({ g: SETTLE.phase }));
    const od = r.ownerDisagreements ?? [];
    const team = (id: string) => esc(b.model.teams.find((t) => t.id === id)?.name ?? id);
    if (od.length) match += group("owner", "Owner team disagrees", od.length, "The model gives the unit to the teams that own the parts it changes; the tracker assigns its issue to another. Typing a name cannot settle this: one side changes.",
      `<ul class="rows">${od.map((d) => `<li>${h.unitLink(d.unit)} <span class="small">model: <b>${d.owners.map(team).join(" and ")}</b> · ${issue(d.issue)}: <b>${team(d.trackerTeam)}</b></span></li>`).join("")}</ul>`, true, settleHtml({ g: SETTLE.owner }));
    const proposed = [...r.proposed].sort((x, y) => y.score - x.score);
    match += group("proposed", "Likely matches to confirm", r.counts.proposed, "Similar title, milestone and team. Confirming one is a line in tracker/links.yaml; copy it below.",
      `<label class="check" style="margin-bottom:6px"><input type="checkbox" data-low-conf> Show weak matches (score under 0.6)</label><div>${proposed.map((p) => {
        const confirm = `${p.unit}:\n  issue: ${p.issue}\n  confirmed_by: <your role>\n  confirmed_at: "${today}"`;
        return `<div class="match" data-score="${p.score}"${p.score < 0.6 ? " data-low hidden" : ""}><div>${h.unitLink(p.unit)}</div>
<div class="mid"><span class="badge accent">score ${esc(p.score)}</span>${p.reasons.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
<div>${issueFull(p.issue)}</div>
<div class="acts"><button type="button" class="btn" data-copy="${esc(confirm)}" hidden>Copy confirm line</button><button type="button" class="btn quiet" data-copy="${esc(`Should ${p.unit} be linked to ${p.issue}? Use the tracker tool with unit ${p.unit}.`)}" hidden>Copy the question for the agent</button></div></div>`;
      }).join("")}</div>`, true, settleHtml({ g: SETTLE.proposed }));
    match += group("no-unit", "Tracker issues not in the plan", r.counts.issuesWithoutUnit, "Possible scope the model lacks: issues in a milestone's container that match no unit.",
      `<ul class="rows">${r.issuesWithoutUnit.map((i) => `<li>${issue(i.issue)} <span>${esc(i.summary)}</span> <span class="muted small">${esc(i.type)} · ${i.phase ? esc(h.gateLabel(i.phase)) : "no milestone"}</span></li>`).join("")}</ul>`, true, settleHtml({ g: SETTLE["no-unit"] }));
    match += group("no-issue", "Plan execution work not in the tracker", r.counts.unitsWithoutIssue, "Planned work nobody can see in the tracker. bun plumb.ts tracker export writes them as an import file.",
      `<ul class="rows">${r.unitsWithoutIssue.map((u) => `<li>${h.unitLink(u)}</li>`).join("")}</ul>`, true, settleHtml({ g: SETTLE["no-issue"] }));
    const byLabel = r.linked.filter((l) => l.how === "label").length, confirmed = r.linked.length - byLabel;
    match += group("linked", "Matched", r.counts.linked, sentence(!confirmed && !byLabel ? "None yet" : !confirmed ? (byLabel === 1 ? "Matched by a unit label on the issue" : `All ${fmt(byLabel)} matched by a unit label on the issue`) : !byLabel ? (confirmed === 1 ? "Confirmed by a person in tracker/links.yaml" : `All ${fmt(confirmed)} confirmed by a person in tracker/links.yaml`) : list([`${fmt(confirmed)} confirmed by a person in tracker/links.yaml`, `${fmt(byLabel)} matched by a unit label on the issue`])),
      `<ul class="rows">${r.linked.map((l) => { const s = r.state[l.unit]; return `<li>${h.unitLink(l.unit)} = ${issue(l.issue)} <span class="tag">${l.how === "label" ? "label" : "confirmed"}</span>${s ? ` <span class="muted small">${esc(s.status)}${s.assignee ? ` · ${esc(s.assignee)}` : ""}${s.sprint ? ` · ${esc(s.sprint)}` : ""}</span>` : ""}</li>`; }).join("")}</ul>`, false);
  } else match = `<p class="empty">${m ? "No live state: the raw export the inventory names is not readable." : "Write the mapping first."}</p>`;

  return `<section class="page" id="tracker" data-page="tracker" aria-labelledby="h-tracker">
<div class="page-head"><h1 id="h-tracker" tabindex="-1">Tracker</h1></div>
${head}${stepper}
<div data-tr-step="discover" aria-label="Discover"><h2 class="section-head" style="font-size:var(--fs-lg)">Discover: what the tracker actually uses</h2>${discover}</div>
<div data-tr-step="map" aria-label="Map"><h2 class="section-head" style="font-size:var(--fs-lg);margin-top:var(--sp-6)">Map: how the plan reads the tracker</h2>${map}</div>
<div data-tr-step="match" aria-label="Match"><h2 class="section-head" style="font-size:var(--fs-lg);margin-top:var(--sp-6)">Match: the plan against the issues</h2>${match}</div>
</section>`;
}
