// The MCP tools: pure functions over a bundle, so tests can call them without stdio.
import type { Bundle, Element, Finding, Unit } from "../types.ts";
import { FLOWUI } from "../site/flow.ts";
import { natCompare } from "../core/util.ts";
import { premiseMd } from "../core/report.ts";
import { rankClaims, weight } from "../core/premise.ts";

type Out = { text: string; isError?: boolean };
const str = (description: string) => ({ type: "string", description });

export const tools = [
  { name: "overview", description: "The instance at a glance: what it is, model and plan counts, check results, phase progress, what can start now.", inputSchema: { type: "object", properties: {} } },
  { name: "find", description: "Search elements, units, contracts, teams and phases by text (id, name, description, check).", inputSchema: { type: "object", properties: { query: str("words to search for") }, required: ["query"] } },
  { name: "element", description: "One element: kind, owner team, zone, system, description, relationships in and out with what they carry, units that change it, findings on it.", inputSchema: { type: "object", properties: { id: str("element id") }, required: ["id"] } },
  { name: "unit", description: "One work unit: its done-condition, phase, owner, what it requires and who provides it, what it unblocks, and why it is blocked if it is.", inputSchema: { type: "object", properties: { id: str("unit id") }, required: ["id"] } },
  { name: "what_can_start", description: "Units that can start now: not done, and every unit they depend on is done.", inputSchema: { type: "object", properties: { phase: str("optional phase filter: a phase id, its name, or its order number such as \"2\"") } } },
  { name: "most_unblocking", description: "Open units ranked by how many open units they unblock: transitively (everything downstream that waits on them) and directly. Says which can start now.", inputSchema: { type: "object", properties: { phase: str("optional phase filter on the ranked units: a phase id, its name, or its order number"), can_start: { type: "boolean", description: "true: rank only the units that can start now" }, limit: { type: "number", description: "how many to list (default 10)" } } } },
  { name: "critical_path", description: "The longest dependency chain through the plan, in order.", inputSchema: { type: "object", properties: {} } },
  { name: "findings", description: "Check results, optionally filtered by rule, severity or the id a finding sits on.", inputSchema: { type: "object", properties: { rule: str("rule id"), severity: str("error or warning (any case)"), at: str("id the finding sits on") } } },
  { name: "impact", description: "What a patch changes: records added, removed and modified, the cascade of a removal, findings it introduces and resolves, findings that go away only with a removed record, and units it affects.", inputSchema: { type: "object", properties: { patch: str("patch id") }, required: ["patch"] } },
  { name: "tracker", description: "The plan against the organization's tracker. Without arguments: the reconciliation summary (linked units, likely matches to confirm, units with no issue, issues with no unit, status and phase disagreements, one-sided dependencies). With a unit id: that unit's tracker state (issue, status, assignee, sprint) and what disagrees. The tracker never overwrites the plan.", inputSchema: { type: "object", properties: { unit: str("optional unit id") } } },
  { name: "premise", description: "What the design rests on. With a claim id: if this claim were false, everything that rests on it (parts, relationships, units, milestones and other claims, directly or through other claims), and the plan slice by milestone. Without an id: every claim ranked by how much rests on it, with its kind and grade (evidence, inference, judgment, untested).", inputSchema: { type: "object", properties: { id: str("optional claim id") } } },
  { name: "notes", description: "Notes and questions pinned to records (notes.yaml), open questions first. Read-only: to answer a question, edit notes.yaml (set answer, answered_by: agent, status: answered, updated). Filters: target kind and id, status, kind.", inputSchema: { type: "object", properties: { target_kind: str("element, relationship, contract, unit, phase, claim, patch or finding"), target_id: str("the record's id (a finding is pack/rule@at)"), status: str("open, answered or resolved"), kind: str("note or question") } } },
  { name: "flow", description: "Flow along a value stream: lead time, waiting and work by source (measured, estimated, declared), team handoffs against the limit, handoffs ranked by the wait behind them, what the tracker measured beside the declared values, each queue's WIP now against its limit, and with a patch id that patch's lead-time effect. Every number names its source.", inputSchema: { type: "object", properties: { view: str("optional stream view id (default: the first stream)"), patch: str("optional patch id: its lead-time effect") } } },
  { name: "path", description: "The shortest chain of relationships from one element to another, following relationship direction.", inputSchema: { type: "object", properties: { from: str("element id"), to: str("element id") }, required: ["from", "to"] } },
];

const done = (u: Unit) => (u.status ?? "todo") === "done";
const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");

function unitLine(b: Bundle, id: string) {
  const u = b.plan.units.find(x => x.id === id);
  return u ? `- ${u.id} (${u.phase}, ${u.status ?? "todo"}): ${u.title}` : `- ${id}`;
}

function findingLine(f: Finding) { return `- [${f.severity}] ${f.pack}/${f.rule} at ${f.at}: ${f.message}`; }

/** A phase by id, by name (any case), or by its order number. */
export function resolvePhase(b: Bundle, ref: unknown): { id?: string; error?: string } {
  const q = String(ref).trim(), ql = q.toLowerCase();
  const ps = [...b.plan.phases].sort((x, y) => x.order - y.order);
  const hit = ps.find(x => x.id === q) ?? ps.find(x => x.id.toLowerCase() === ql) ?? ps.find(x => x.name.toLowerCase() === ql)
    ?? (/^\d+$/.test(q) ? ps.find(x => x.order === Number(q)) : undefined);
  if (hit) return { id: hit.id };
  return { error: `No phase "${q}". Give a phase id, name or order number. Phases: ${ps.map(x => `${x.id} (${x.order}, ${x.name})`).join("; ") || "none"}.` };
}

/** Open units ranked by how many open units wait on them, transitively then directly, then id. */
export function unblockRanking(b: Bundle): { id: string; direct: number; total: number }[] {
  const open = new Set(b.plan.units.filter(u => !done(u)).map(u => u.id));
  const down = (id: string) => (b.analysis.unblocks[id] ?? []).filter(x => open.has(x) && x !== id);
  const rows = [...open].map(id => {
    const seen = new Set<string>(), q = [...down(id)];
    while (q.length) { const x = q.shift()!; if (seen.has(x) || x === id) continue; seen.add(x); q.push(...down(x)); }
    return { id, direct: down(id).length, total: seen.size };
  });
  return rows.sort((x, y) => y.total - x.total || y.direct - x.direct || natCompare(x.id, y.id));
}

/** The flow tool: a stream's numbers with their sources, or a patch's lead-time effect. */
export function flowTool(b: Bundle, a: Record<string, any>): Out {
  if (!b.flow?.streams.length) return { text: "This instance has no value stream: no flow pack, or no view that draws a handoff.", isError: true };
  if (a.patch) {
    const p = b.patches.find((x) => x.id === a.patch);
    if (!p) return { text: `No patch ${a.patch}. Patches: ${b.patches.map((x) => x.id).join(", ") || "none"}.`, isError: true };
    const fx = p.impact.flow ?? [];
    return { text: fx.length ? [`# Lead-time effect of ${p.id}: ${p.title}`, ...fx.map((f) => `## ${f.title}\n${f.text}`)].join("\n") : `${p.id} changes no stream's wait, work or handoffs.` };
  }
  const st = b.flow.streams.find((s) => s.view === a.view) ?? (a.view ? undefined : b.flow.streams[0]);
  if (!st) return { text: `No stream view ${a.view}. Streams: ${b.flow.streams.map((s) => s.view).join(", ")}.`, isError: true };
  const name = (id: string) => b.model.elements.find((x) => x.id === id)?.name ?? id;
  const hops = (FLOWUI.ranked(st) as any[]).map((h) => { const bh = FLOWUI.behind(h); return `- ${FLOWUI.hop(b, h)}: ${bh ? `${FLOWUI.days(bh.days)} ${FLOWUI.src(bh.source)}, at ${name(h.behind ?? h.to)}` : `no step waits behind it (into ${name(h.to)})`}`; });
  const queues = b.model.elements.filter((x) => x.kind === "queue" && st.path.includes(x.id)).map((x) => { const w = FLOWUI.wipNowWords(b, x.id); const s = b.flow!.elements[x.id]; return `- ${x.name}: ${w || (s?.wip ? `limit ${s.wip.value}; the tracker cannot say how many wait in it now` : "no WIP limit")}`; });
  const ml = FLOWUI.measuredLine(b, st);
  return { text: [`# ${st.title} (${st.view})`, FLOWUI.summary(b, st), ml, "", `## Handoffs ranked by the wait behind them (${hops.length})`, ...hops, "", `## Queues on the path (${queues.length})`, ...queues].filter((x) => x !== undefined).join("\n") };
}

export function call(b: Bundle, name: string, aIn: unknown): Out {
  if (aIn !== undefined && (aIn === null || typeof aIn !== "object" || Array.isArray(aIn)))
    return { text: `Arguments must be an object of named parameters, not ${aIn === null ? "null" : Array.isArray(aIn) ? "a list" : typeof aIn}.`, isError: true };
  const a = (aIn ?? {}) as Record<string, any>;
  const m = b.model, p = b.plan, an = b.analysis;
  switch (name) {
    case "overview": {
      const err = b.findings.filter(f => f.severity === "error").length;
      const warn = b.findings.length - err;
      const doneN = p.units.filter(done).length;
      const phases = [...p.phases].sort((x, y) => x.order - y.order).map(ph => {
        const s = an.phases.find(x => x.id === ph.id);
        return `- ${ph.id} ${ph.name}: ${s?.done ?? 0}/${s?.total ?? 0} done${s?.complete ? " (complete)" : ""}. Exit test: ${ph.exit_test}`;
      });
      return { text: [
        `# ${b.instance.title}`, b.instance.description ?? "",
        `Model: ${m.elements.length} elements, ${m.relationships.length} relationships, ${m.contracts.length} contracts, ${m.teams.length} teams, ${m.views.length} views.`,
        `Plan: ${p.units.length} units, ${doneN} done; ${an.frontier.length} can start now; critical path ${an.critical_path.length} units.`,
        `Checks (${b.instance.packs.map(x => x.name).join(", ")}): ${err} errors, ${warn} warnings.`,
        `Patches: ${b.patches.map(x => `${x.id} (${x.status})`).join(", ") || "none"}.`,
        "", "## Phases", ...phases,
      ].join("\n") };
    }
    case "find": {
      const q = String(a.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      if (!q.length) return { text: "Give some words to search for.", isError: true };
      const hit = (s: string) => q.every(w => s.toLowerCase().includes(w));
      const rows: string[] = [];
      for (const e of m.elements) if (hit([e.id, e.name, e.kind, e.description ?? ""].join(" "))) rows.push(`- element ${e.id}: ${e.name} (${e.kind})`);
      for (const u of p.units) if (hit([u.id, u.title, u.check, ...(u.provides ?? [])].join(" "))) rows.push(`- unit ${u.id}: ${u.title}`);
      for (const c of m.contracts) if (hit([c.name, c.description ?? ""].join(" "))) rows.push(`- contract ${c.name}`);
      for (const t of m.teams) if (hit([t.id, t.name].join(" "))) rows.push(`- team ${t.id}: ${t.name}`);
      for (const ph of p.phases) if (hit([ph.id, ph.name, ph.exit_test].join(" "))) rows.push(`- phase ${ph.id}: ${ph.name}`);
      return { text: rows.length ? `${rows.length} matches\n${rows.slice(0, 60).join("\n")}${rows.length > 60 ? "\n(first 60 shown)" : ""}` : "No matches." };
    }
    case "flow": return flowTool(b, a);
    case "element": {
      const e = m.elements.find(x => x.id === a.id) as Element | undefined;
      if (!e) return { text: `No element ${a.id}. Use find.`, isError: true };
      const team = m.teams.find(t => t.id === e.owner);
      const rel = (r: any, dir: "out" | "in") => `- ${dir === "out" ? "to" : "from"} ${dir === "out" ? r.to : r.from} [${r.kind}${r.optional ? ", optional" : ""}]${r.label ? ` "${r.label}"` : ""}${r.carries?.length ? ` carries ${r.carries.join(", ")}` : ""}`;
      const outs = m.relationships.filter(r => r.from === e.id).map(r => rel(r, "out"));
      const ins = m.relationships.filter(r => r.to === e.id).map(r => rel(r, "in"));
      const units = p.units.filter(u => u.elements?.some(x => x.id === e.id)).map(u => { const mv = u.elements!.find(x => x.id === e.id)!; return `- ${u.id} (${u.phase}, ${u.status ?? "todo"}): ${mv.from} to ${mv.to}`; });
      const fs = b.findings.filter(f => f.at === e.id).map(findingLine);
      return { text: [
        `# ${e.name} (${e.id})`, `Kind ${e.kind}; owner ${team ? team.name : e.owner ?? "none"}; zone ${e.zone ?? "none"}; system ${e.system ?? "none"}.`,
        e.description ?? "", e.attrs && Object.keys(e.attrs).length ? `Attributes: ${JSON.stringify(e.attrs)}` : "",
        ...(b.flow ? (() => { const rows = FLOWUI.partRows(b, e.id) as [string, string][]; return rows.length ? [`## Flow (${rows.length})`, ...rows.map(([k, v]) => `- ${k}: ${v}`)] : []; })() : []),
        `## Sends (${outs.length})`, ...outs, `## Receives (${ins.length})`, ...ins,
        `## Units that change it (${units.length})`, ...units, `## Findings (${fs.length})`, ...fs,
      ].filter(Boolean).join("\n") };
    }
    case "unit": {
      const u = p.units.find(x => x.id === a.id);
      if (!u) return { text: `No unit ${a.id}. Use find.`, isError: true };
      const providers = (cap: string) => p.units.filter(x => x.provides?.includes(cap)).map(x => `${x.id}${done(x) ? " (done)" : ""}`);
      const req = (u.requires ?? []).map(c => `- ${c}: provided by ${list(providers(c))}`);
      const bl = an.blocked[u.id];
      return { text: [
        `# ${u.id}: ${u.title}`, `Phase ${u.phase}; kind ${u.kind}; status ${u.status ?? "todo"}; owner ${u.owner ?? "none"}; feedback ${u.feedback ?? "unstated"}.`,
        `Done when: ${u.check}`,
        `## Requires`, ...(req.length ? req : ["- nothing"]),
        `## Provides`, `- ${list(u.provides ?? [])}`,
        `## Changes`, ...(u.elements?.map(x => `- ${x.id}: ${x.from} to ${x.to}`) ?? ["- no element"]),
        `## Unblocks`, ...((an.unblocks[u.id] ?? []).length ? an.unblocks[u.id].map(id => unitLine(b, id)) : ["- none"]),
        done(u) ? "Status: done." : an.frontier.includes(u.id) ? "Status: can start now." :
          bl ? `Blocked: missing ${list(bl.missing)}; waiting on ${list(bl.waitingOn)}.` : "",
      ].filter(Boolean).join("\n") };
    }
    case "what_can_start": {
      let phase: string | undefined;
      if (a.phase !== undefined && a.phase !== null && String(a.phase).trim() !== "") {
        const r = resolvePhase(b, a.phase);
        if (r.error) return { text: r.error, isError: true };
        phase = r.id;
      }
      const ids = an.frontier.filter(id => !phase || p.units.find(u => u.id === id)?.phase === phase);
      const where = phase ? ` in phase ${phase}` : "";
      return { text: ids.length ? `${ids.length} units can start now${where}\n${ids.map(id => unitLine(b, id)).join("\n")}` : `Nothing can start now${where}.` };
    }
    case "most_unblocking": {
      let phase: string | undefined;
      if (a.phase !== undefined && a.phase !== null && String(a.phase).trim() !== "") {
        const r = resolvePhase(b, a.phase);
        if (r.error) return { text: r.error, isError: true };
        phase = r.id;
      }
      const limit = a.limit === undefined ? 10 : Math.floor(Number(a.limit));
      if (!Number.isFinite(limit) || limit < 1) return { text: "limit must be a whole number of at least 1.", isError: true };
      const front = new Set(an.frontier);
      const startable = a.can_start === true || a.can_start === "true";
      const rows = unblockRanking(b).filter(r => (!phase || p.units.find(u => u.id === r.id)?.phase === phase) && (!startable || front.has(r.id)));
      const scope = `${startable ? " that can start now" : ""}${phase ? ` in phase ${phase}` : ""}`;
      if (!rows.length) return { text: `No open units${scope}.` };
      const lines = rows.slice(0, limit).map((r, i) => {
        const u = p.units.find(x => x.id === r.id)!;
        return `${i + 1}. ${u.id} (${u.phase}, ${front.has(u.id) ? "can start now" : "blocked"}): ${u.title}. Unblocks ${r.direct} directly, ${r.total} in all.`;
      });
      return { text: [`Most unblocking open units${scope} (${Math.min(limit, rows.length)} of ${rows.length}), counting open units downstream`, ...lines].join("\n") };
    }
    case "critical_path":
      return { text: `Critical path, ${an.critical_path.length} units\n${an.critical_path.map(id => unitLine(b, id)).join("\n")}` };
    case "findings": {
      const sev = a.severity ? String(a.severity).trim().toLowerCase() : "";
      const fs = b.findings.filter(f => (!a.rule || f.rule === a.rule) && (!sev || f.severity === sev) && (!a.at || f.at === a.at));
      return { text: fs.length ? `${fs.length} findings\n${fs.slice(0, 100).map(findingLine).join("\n")}` : "No findings match." };
    }
    case "impact": {
      const pt = b.patches.find(x => x.id === a.patch);
      if (!pt) return { text: `No patch ${a.patch}. Known: ${b.patches.map(x => x.id).join(", ")}`, isError: true };
      const i = pt.impact, rec = (xs: { kind: string; id: string }[]) => xs.map(x => `- ${x.kind} ${x.id}`);
      return { text: [
        `# ${pt.id}: ${pt.title} (${pt.status})`, `Why: ${pt.why}`,
        `## Added (${i.added.length})`, ...rec(i.added), `## Removed (${i.removed.length})`, ...rec(i.removed),
        `## Modified (${i.modified.length})`, ...i.modified.map(x => `- ${x.kind} ${x.id}: ${x.fields.join(", ")}`),
        `## Cascade (${i.cascade.length})`, ...i.cascade.map(x => `- ${x.kind} ${x.id}: ${x.because}`),
        `## Findings introduced (${i.findingsIntroduced.length})`, ...i.findingsIntroduced.map(findingLine),
        `## Findings resolved (${i.findingsResolved.length})`, ...i.findingsResolved.map(findingLine),
        `## Gone with the removed record (${(i.findingsGone ?? []).length})`, ...(i.findingsGone ?? []).map(findingLine),
        `## Units affected`, `- ${list(i.unitsAffected)}`,
        ...(i.errors.length ? ["## Ops that could not apply", ...i.errors.map(e => `- ${e}`)] : []),
      ].join("\n") };
    }
    case "path": {
      const ids = new Set(m.elements.map(e => e.id));
      if (!ids.has(a.from) || !ids.has(a.to)) return { text: "Both from and to must be element ids.", isError: true };
      const prev = new Map<string, { via: string; from: string }>(); const q = [a.from]; const seen = new Set([a.from]);
      while (q.length) {
        const cur = q.shift()!; if (cur === a.to) break;
        for (const r of m.relationships) if (r.from === cur && !seen.has(r.to)) { seen.add(r.to); prev.set(r.to, { via: r.id, from: cur }); q.push(r.to); }
      }
      if (!seen.has(a.to)) return { text: `No path from ${a.from} to ${a.to} following relationship direction.` };
      const steps: string[] = []; let cur = a.to;
      while (cur !== a.from) { const s = prev.get(cur)!; const r = m.relationships.find(x => x.id === s.via)!; steps.unshift(`- ${s.from} -> ${cur} [${r.kind}]${r.carries?.length ? ` carries ${r.carries.join(", ")}` : ""}`); cur = s.from; }
      return { text: `${steps.length} steps\n${steps.join("\n")}` };
    }
    case "tracker": return trackerTool(b, a.unit);
    case "premise": {
      const claims = m.claims ?? [];
      if (a.id === undefined || a.id === null || String(a.id).trim() === "") {
        if (!claims.length) return { text: "This instance declares no claims." };
        return { text: [`${claims.length} claims, ranked by how much rests on each:`, ...rankClaims(claims, b.premises ?? {}).map(c => `- ${c.id} (${c.kind}, ${c.grade}; ${b.premises?.[c.id] ? weight(b.premises[c.id]) : 0} rest on it): ${c.statement}`)].join("\n") };
      }
      const id = String(a.id).trim();
      if (!claims.some(c => c.id === id)) return { text: `No claim ${id}. Claims: ${claims.map(c => c.id).join(", ") || "none"}.`, isError: true };
      return { text: premiseMd(b, id) };
    }
    case "notes": {
      const all = b.notes?.items ?? [];
      if (!b.notes) return { text: "This instance has no notes.yaml yet. Add one with a top-level notes: list (see the README)." };
      const lc = (v: unknown) => (v === undefined || v === null || String(v).trim() === "" ? undefined : String(v).trim().toLowerCase());
      const tk = lc(a.target_kind), ti = a.target_id === undefined ? undefined : String(a.target_id).trim(), st = lc(a.status), kd = lc(a.kind);
      const hit = all.filter(n => (!tk || n.target.kind === tk) && (!ti || n.target.id === ti) && (!st || n.status === st) && (!kd || n.kind === kd));
      const open = all.filter(n => n.status === "open" && n.kind === "question").length;
      return { text: [`${hit.length} of ${all.length} notes (${open} open question${open === 1 ? "" : "s"} in all; file version ${b.notes.version}).`,
        ...hit.map(n => `- ${n.id} [${n.kind}, ${n.status}, by ${n.author}, updated ${n.updated}] on ${n.target.kind} ${n.target.id}: ${n.text}${n.answer ? `\n  Answer${n.answered_by === "agent" ? " (by an agent)" : n.answered_by === "person" ? " (by a person)" : ""}: ${n.answer}` : ""}`)].join("\n") };
    }
    default: return { text: `Unknown tool ${name}.`, isError: true };
  }
}

/** The tracker tool: reconciliation summary, or one unit's tracker state. */
export function trackerTool(b: Bundle, unitIn: unknown): Out {
  const t = b.tracker, r = t?.reconcile;
  if (!t) return { text: "This instance is not wired to a tracker (no tracker/ directory)." };
  if (!r) return { text: `The tracker is not reconciled yet: ${t.mapping ? "the raw export is not readable" : "there is no mapping.yaml"}.` };
  if (unitIn !== undefined && unitIn !== null && String(unitIn).trim() !== "") {
    const id = String(unitIn).trim();
    const u = b.plan.units.find(x => x.id === id);
    if (!u) return { text: `No unit ${id}. Use find.`, isError: true };
    const s = r.state[id];
    const lines = [`# ${u.id}: ${u.title}`, `Plan status: ${u.status ?? "todo"} (the plan's own; the tracker never overwrites it).`];
    if (s) {
      lines.push(`Issue ${s.issue} (${s.how === "label" ? "linked by label" : "confirmed in links.yaml"}): ${s.summary}`,
        `Tracker status: ${s.status} (maps to ${s.mapped}); assignee ${s.assignee ?? "none"}; sprint ${s.sprint ?? "none"}; team ${s.team ?? "none"}; parent ${s.parent ?? "none"}.`);
    } else {
      const p = r.proposed.find(x => x.unit === id);
      lines.push(p ? `No confirmed issue. Likely match ${p.issue}, score ${p.score}: ${p.reasons.join(", ")}. Confirm it in tracker/links.yaml.` : "No issue in the tracker.");
    }
    for (const d of r.statusDisagreements.filter(x => x.unit === id)) lines.push(`Disagrees: the plan says ${d.unitStatus}, ${d.issue} says "${d.trackerStatus}" (${d.mapped}).`);
    for (const d of r.phaseDisagreements.filter(x => x.unit === id)) lines.push(`Phase: the unit is in ${d.unitPhase}, ${d.issue} sits ${d.issuePhase ? `under ${d.issuePhase}` : "under no mapped phase"}.`);
    for (const d of r.dependencyOneSided.filter(x => x.unit === id)) lines.push(`Dependency on ${d.dependsOn} (${d.issue} -> ${d.dependsOnIssue}) is only in the ${d.side}.`);
    return { text: lines.join("\n") };
  }
  const c = r.counts;
  return { text: [
    `# Tracker reconciliation (${t.adapter}${t.inventory?.flavor ? `, ${t.inventory.flavor}` : ""})`,
    `Linked ${c.linked}; likely matches to confirm ${c.proposed}; units with no issue ${c.unitsWithoutIssue}; issues with no unit ${c.issuesWithoutUnit}; status disagreements ${c.statusDisagreements}; under another phase ${c.phaseDisagreements}; one-sided dependencies ${c.dependencyOneSided}.`,
    "## Likely matches to confirm", ...(r.proposed.length ? r.proposed.map(p => `- ${p.unit} ~ ${p.issue} (score ${p.score}: ${p.reasons.join(", ")})`) : ["- none"]),
    "## Units with no issue", `- ${list(r.unitsWithoutIssue)}`,
    "## Issues with no unit", ...(r.issuesWithoutUnit.length ? r.issuesWithoutUnit.map(i => `- ${i.issue} ${i.summary} (${i.type}, phase ${i.phase})`) : ["- none"]),
    "## Status disagreements", ...(r.statusDisagreements.length ? r.statusDisagreements.map(d => `- ${d.unit} is ${d.unitStatus}; ${d.issue} is "${d.trackerStatus}" (${d.mapped})`) : ["- none"]),
    "## Under another phase", ...(r.phaseDisagreements.length ? r.phaseDisagreements.map(d => `- ${d.unit} (${d.unitPhase}); ${d.issue} under ${d.issuePhase ?? "no mapped phase"}`) : ["- none"]),
    "## Dependencies on one side only", ...(r.dependencyOneSided.length ? r.dependencyOneSided.map(d => `- ${d.unit} -> ${d.dependsOn} (${d.issue} -> ${d.dependsOnIssue}): only in the ${d.side}`) : ["- none"]),
    ...(r.problems.length ? ["## Problems", ...r.problems.map(p => `- ${p}`)] : []),
  ].join("\n") };
}
