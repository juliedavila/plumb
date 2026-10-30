/* Plumb site client, part 1b: the grammar every page shares (Tier 1).
   - Records: every part, relationship, contract, team, unit, milestone, claim, finding, patch, note and view has a key
     "kind:id" and resolves through one table (RECORD), which gives its icon, noun, title, page and two to four
     prominent fields. One renderer (cardHtml) draws it in three sizes: a hover card, a drawer, a full page head.
   - Facets and the filter predicate: zone, system, kind, milestone, status, owner team, grade, rule, has-finding and
     has-note, derived for every record kind (a unit's zone is the zones of the parts it changes; a part's grade is
     the grades of the claims it rests on). One predicate (matches) is honoured by every page; a facet whose values
     no record of the page's kind carries is ignored on that page and the chip says so.
   - URL state: filters, the selection and the hop trail live in the hash query (#plan?zone=edge&grade=untested),
     so a link, a reload or Back lands on the same set. Values are escaped so ids with any character round-trip.
   - Links: a generic link table per record kind (LINKS) drives the drawer's "Linked" groups and the Follow menu;
     counts are computed from the bundle, as the union over a set.
   Everything here is pure (index in, data or HTML strings out) so the tests call it without a DOM. */

// ---------- records ----------
var KIND_PAGE = { element: "model", unit: "plan", claim: "strategy", finding: "checks", note: "notes", patch: "changes" };
var PAGE_KIND = { overview: "element", model: "element", plan: "unit", strategy: "claim", checks: "finding", notes: "note", changes: "patch", teams: "unit", tracker: "unit" };
/**
 * Filters a page's own drawings and tables do not follow, though the page lists a kind the facet applies to: the chip
 * says "not applied here" and why, rather than looking applied while the counts include everything.
 */
var PAGE_PARTIAL = {
  teams: { milestone: "The milestone filter applies to a team's open work only; the drawing, the matrix and the tables count every milestone." },
  tracker: { milestone: "The milestone filter is not applied on this page; Discover, Map and Match count every milestone." }
};
/** The facets set in F that this page does not apply, each with why: [{ key, note }]. */
function notAppliedHere(page, F) {
  var p = PAGE_PARTIAL[page] || {};
  return Object.keys(p).filter(function (k) { return arr(F && F[k]).length > 0; }).map(function (k) { return { key: k, note: p[k] }; });
}
var KIND_NOUN = {
  element: ["part", "parts"], relationship: ["relationship", "relationships"], contract: ["contract", "contracts"], team: ["team", "teams"],
  unit: ["unit", "units"], phase: ["milestone", "milestones"], claim: ["claim", "claims"], finding: ["finding", "findings"], patch: ["patch", "patches"],
  note: ["note", "notes"], view: ["view", "views"], zone: ["zone", "zones"]
};
var KIND_WORD = { element: "Part", relationship: "Relationship", contract: "Contract", team: "Team", unit: "Unit", phase: "Milestone", claim: "Claim", finding: "Finding", patch: "Patch", note: "Note", view: "View", zone: "Zone" };
var NONE = "_none";

function rkey(kind, id) { return kind + ":" + id; }
function splitKey(k) { k = str(k); var i = k.indexOf(":"); return i < 0 ? { kind: k, id: "" } : { kind: k.slice(0, i), id: k.slice(i + 1) }; }
function findingKey(f) { return f.pack + "/" + f.rule + "@" + f.at; }

/** Indexes the grammar reads, built once at the end of buildIndex. */
function indexGrammar(ix) {
  var b = ix.b;
  ix.finding = new Map();
  arr(b.findings).forEach(function (f) { if (f && !ix.finding.has(findingKey(f))) ix.finding.set(findingKey(f), f); });
  ix.noteById = new Map(); ix.notes.forEach(function (n) { ix.noteById.set(n.id, n); });
  // what each record rests on, through the premises' dependents (transitive) and the plan slice (units)
  ix.claimsOn = new Map(); ix.dependents = new Map();
  var on = function (k, c) { var s = ix.claimsOn.get(k); if (!s) { s = new Set(); ix.claimsOn.set(k, s); } s.add(c); };
  ix.claim.forEach(function (c, cid) {
    var im = ix.premises[cid] || {}, d = { element: [], relationship: [], unit: [], phase: [], claim: [] };
    arr(im.dependents).forEach(function (x) { if (!x) return; if (x.kind !== "unit") { on(rkey(x.kind, x.id), cid); if (d[x.kind] && d[x.kind].indexOf(x.id) < 0) d[x.kind].push(x.id); } });
    arr(im.units).forEach(function (g) { arr(g && g.units).forEach(function (u) { on(rkey("unit", u), cid); if (d.unit.indexOf(u) < 0) d.unit.push(u); }); });
    ix.dependents.set(cid, d);
  });
  ix.claimsOf.forEach(function (cs, k) { cs.forEach(function (c) { if (ix.claim.has(c)) on(k, c); }); });
  ix.unitsOfPhase = new Map(); ix.unit.forEach(function (u) { push(ix.unitsOfPhase, u.phase, u.id); });
  ix.patchEls = new Map(); ix.patchesAt.forEach(function (ps, k) { var s = splitKey(k); if (s.kind === "element") ps.forEach(function (p) { push(ix.patchEls, p, s.id); }); });
  ix.ownedParts = new Map(); ix.verifiedParts = new Map(); ix.el.forEach(function (e) { if (e.owner) push(ix.ownedParts, e.owner, e.id); if (e.verifier) push(ix.verifiedParts, e.verifier, e.id); });
  ix.ownedUnits = new Map(); ix.unit.forEach(function (u) { unitRolesOf(ix, u.id).owners.forEach(function (t) { push(ix.ownedUnits, t, u.id); }); });
  ix.contractsOf = new Map(); ix.contract.forEach(function (c, name) { arr(c.produced_by).concat(arr(c.consumed_by)).forEach(function (e) { push(ix.contractsOf, e, name); }); });
  ix.carriedBy = new Map(); ix.rel.forEach(function (r) { arr(r.carries).forEach(function (c) { push(ix.carriedBy, c, r.id); }); });
  ix.zoneScene = new Map(); arr(b.zoneScenes).forEach(function (s) { if (s) ix.zoneScene.set(s.zone == null ? NONE : s.zone, s); });
  ix._fv = new Map(); ix._uni = new Map();
}

/** The record a key names, or null. */
function recordOf(ix, kind, id) {
  switch (kind) {
    case "element": return ix.el.get(id) || null;
    case "relationship": return ix.rel.get(id) || null;
    case "contract": return ix.contract.get(id) || null;
    case "team": return ix.team.get(id) || null;
    case "unit": return ix.unit.get(id) || null;
    case "phase": return ix.phase.get(id) || null;
    case "claim": return ix.claim.get(id) || null;
    case "finding": return ix.finding.get(id) || null;
    case "patch": return ix.patch.get(id) || null;
    case "note": return ix.noteById.get(id) || null;
    case "view": return ix.view.get(id) || null;
    case "zone": return id === NONE ? { id: NONE, name: "No zone" } : ix.zone.get(id) || null;
    default: return null;
  }
}

/** Every id of a kind, in reading order. */
function recordsOf(ix, kind) {
  switch (kind) {
    case "element": return Array.from(ix.el.keys());
    case "relationship": return Array.from(ix.rel.keys());
    case "unit": return Array.from(ix.unit.keys());
    case "claim": return Array.from(ix.claim.keys());
    case "finding": return Array.from(ix.finding.keys());
    case "patch": return Array.from(ix.patch.keys());
    case "note": return ix.notes.map(function (n) { return n.id; });
    case "phase": return ix.phaseOrder.map(function (p) { return p.id; });
    case "team": return Array.from(ix.team.keys());
    case "view": return Array.from(ix.view.keys());
    case "contract": return Array.from(ix.contract.keys());
    default: return [];
  }
}

/** A record's display name. */
function recordTitle(ix, kind, id) {
  var r = recordOf(ix, kind, id);
  if (!r) return str(id);
  switch (kind) {
    case "element": case "team": case "zone": return r.name || id;
    case "relationship": { var a = ix.el.get(r.from), c = ix.el.get(r.to); return (a ? a.name : r.from) + " → " + (c ? c.name : r.to); }
    case "contract": return plainRef(ix, id);
    case "unit": return r.title || id;
    case "phase": return milestoneLabel(ix, id);
    case "claim": return r.statement || id;
    case "finding": { var rule = ix.rules.get(r.pack + "/" + r.rule); return rule ? rule.title : r.rule; }
    case "patch": return r.title || id;
    case "note": return clip(r.text, 90);
    case "view": return r.title || id;
    default: return str(id);
  }
}

/** Where a record's full page is. */
function recordHref(ix, kind, id) {
  var r = recordOf(ix, kind, id);
  switch (kind) {
    case "element": return R.element(id);
    case "unit": return R.unit(id);
    case "claim": return R.claim(id);
    case "phase": return R.milestone(id);
    case "patch": return R.patch(id);
    case "note": return R.note(id);
    case "view": return R.view(id);
    case "zone": return R.zone(id);
    case "team": return R.teams();
    case "finding": return r ? R.rule(r.pack, r.rule) : "#checks";
    case "relationship": return r ? R.element(r.from) : "#model";
    case "contract": { var by = r && (arr(r.produced_by)[0] || arr(r.consumed_by)[0]); return by ? R.element(by) : "#model/elements"; }
    default: return "#overview";
  }
}

/** A reference to a record anywhere on the page: hover shows its card, a click opens its drawer. */
function refChip(ix, kind, id, label, cls, tip) {
  var r = recordOf(ix, kind, id);
  if (!r) return '<span class="muted">' + esc(label || id) + "</span>";
  return '<a class="ref' + (cls ? " " + cls : "") + '" href="' + esc(recordHref(ix, kind, id)) + '" data-ref="' + esc(rkey(kind, id)) + '"' + (tip ? ' title="' + esc(tip) + '"' : "") + ">" + icon("k-" + kind, "icon icon-sm kind-ic") + "<span>" + esc(label != null ? label : recordTitle(ix, kind, id)) + "</span></a>";
}

// ---------- the card: one table of prominent fields per kind ----------
var STATUS_WORD = { done: "Done", doing: "In progress", ready: "Ready", blocked: "Blocked", noprov: "Needs work (unplanned)", open: "Open", answered: "Answered", resolved: "Resolved", proposed: "Proposed", accepted: "Accepted", rejected: "Rejected" };
function zoneHtml(ix, z) {
  if (!z) return "";
  var t = zoneTint(ix, z), zz = ix.zone.get(z);
  return '<a class="ref" href="' + R.zone(z) + '" data-zone-open="' + esc(z) + '"><i class="swatch ' + t.cls + '" aria-hidden="true"></i>' + esc(zz ? zz.name : z) + "</a>";
}
function teamsHtml(ix, ids) { return arr(ids).map(function (t) { return refChip(ix, "team", t, teamName(ix, t)); }).join(" "); }
function countWord(n, one, many) { return n ? esc(PROSE.count(n, one, many)) : ""; }

/**
 * Each kind: an icon (k-<kind> in the sprite), its noun, and two to four prominent fields. A field's value is HTML, or
 * "" when the record has none, which the card shows as "Not set". The tests check this table directly.
 */
var CARD = {
  element: [
    ["Kind", function (ix, e) { return esc(e.kind); }],
    ["Zone", function (ix, e) { return zoneHtml(ix, e.zone); }],
    ["Owner team", function (ix, e) { return e.owner ? teamsHtml(ix, [e.owner]) : ""; }],
    ["Problems found", function (ix, e) { var fs = ix.findingsAt.get("element:" + e.id) || []; return countWord(fs.length, "problem"); }]
  ],
  relationship: [
    ["From", function (ix, r) { return refChip(ix, "element", r.from); }],
    ["To", function (ix, r) { return refChip(ix, "element", r.to); }],
    ["Kind", function (ix, r) { return esc(r.kind) + (r.label ? ' <span class="muted">' + esc(r.label) + "</span>" : ""); }],
    ["Carries", function (ix, r) { return arr(r.carries).map(function (c) { return refChip(ix, "contract", c, plainRef(ix, c)); }).join(" "); }]
  ],
  contract: [
    ["Produced by", function (ix, c) { return arr(c.produced_by).map(function (e) { return refChip(ix, "element", e); }).join(" "); }],
    ["Consumed by", function (ix, c) { return arr(c.consumed_by).map(function (e) { return refChip(ix, "element", e); }).join(" "); }],
    ["Description", function (ix, c) { return esc(c.description || ""); }]
  ],
  team: [
    ["Parts owned", function (ix, t) { return countWord((ix.ownedParts.get(t.id) || []).length, "part"); }],
    ["Open units owned", function (ix, t) { return countWord((ix.ownedUnits.get(t.id) || []).filter(function (u) { return (ix.unit.get(u) || {}).status !== "done"; }).length, "unit"); }],
    ["Description", function (ix, t) { return esc(t.description || ""); }],
    ["Lead", function (ix, t) { return leadHtml(t.lead); }]
  ],
  unit: [
    ["Status", function (ix, u) { var s = unitState(ix, u); return statusHtml(s, UNIT_WORD[s], "sm"); }],
    ["Milestone", function (ix, u) { return ix.phase.has(u.phase) ? refChip(ix, "phase", u.phase, milestoneLabel(ix, u.phase)) : esc(u.phase || ""); }],
    ["Owner team", function (ix, u) { return teamsHtml(ix, unitRolesOf(ix, u.id).owners); }],
    ["Done when", function (ix, u) { return esc(u.check || ""); }]
  ],
  phase: [
    ["Status", function (ix, p) { var m = msStatus(ix, p.id); if (!m) return ""; if (m.reached) return statusHtml("pass", "Reached", "sm");
      // an override shows what it hides: who set it, and the computed status with its reason
      var ov = m.override ? ' <span class="small fg2">Set manually by ' + esc(m.override.by) + (m.computed !== m.status ? "; computed " + esc(m.computed) : "") + "</span>" : "";
      // a call that needs a second look says so on the card, as on the road and the slide
      if (p.accountable) ov += ' <span class="small fg2">Accountable: ' + esc(p.accountable) + "</span>";
      ov += arr(m.flags).map(function (f) { return ' <span class="small ovr-flag-inline">' + icon("warning", "icon icon-sm st-warning") + esc(f.text) + "</span>"; }).join("");
      return ragHtml(m.status, "sm") + ov + (m.reasons[0] ? ' <span class="small fg2">' + esc(m.reasons[0].short || m.reasons[0].text) + "</span>" : ""); }],
    ["Delivers", function (ix, p) { return esc(p.delivers || ""); }],
    ["Progress", function (ix, p) { var us = ix.unitsOfPhase.get(p.id) || [], d = us.filter(function (u) { return (ix.unit.get(u) || {}).status === "done"; }).length; return us.length ? esc(PROSE.fmt(d) + " of " + PROSE.count(us.length, "unit") + " done") : ""; }],
    ["Reached when", function (ix, p) { return esc(p.exit_test || ""); }]
  ],
  claim: [
    ["Grade", function (ix, c) { return gradeHtml(c.grade); }],
    ["Kind", function (ix, c) { return esc(CLAIM_KIND[c.kind] || c.kind || ""); }],
    ["What rests on it", function (ix, c) { var w = claimWeight(ix, c.id); return w ? esc(PROSE.count(w, "record")) : ""; }],
    ["Fallback", function (ix, c) { return linkifyText(ix, c.fallback || ""); }]
  ],
  finding: [
    ["Severity", function (ix, f) { return f.severity === "error" ? statusHtml("fail", "Error", "sm") : statusHtml("warning", "Warning", "sm"); }],
    ["Found on", function (ix, f) { var k = f.atKind === "phase" || f.atKind === "element" || f.atKind === "unit" || f.atKind === "claim" || f.atKind === "relationship" || f.atKind === "view" || f.atKind === "team" || f.atKind === "contract" || f.atKind === "note" ? f.atKind : null; return k && recordOf(ix, k, f.at) ? refChip(ix, k, f.at) : esc(f.at); }],
    ["Message", function (ix, f) { return esc(f.text || f.message || ""); }]
  ],
  patch: [
    ["Status", function (ix, p) { return esc(STATUS_WORD[p.status] || p.status || ""); }],
    ["Verdict", function (ix, p) { return verdictHtml(p); }],
    ["Proposed by", function (ix, p) { return esc(proposedBy(p)); }],
    ["Work affected", function (ix, p) { var n = arr(p.impact && p.impact.unitsAffected).length; return countWord(n, "unit"); }]
  ],
  note: [
    ["Status", function (ix, n) { return esc((n.kind === "question" ? "Question, " : "Note, ") + (STATUS_WORD[n.status] || n.status || "").toLowerCase()); }],
    ["Pinned to", function (ix, n) { return n.target ? noteTargetHtml(ix, n.target) : ""; }],
    ["Answer", function (ix, n) { return esc(n.answer || ""); }],
    ["Written by", function (ix, n) { return n.author === "agent" ? "An agent" : "A person"; }]
  ],
  view: [
    ["Group", function (ix, v) { return esc(v.group || ""); }],
    ["Parts", function (ix, v) { return countWord(arr(v.elements).length, "part"); }],
    ["Description", function (ix, v) { return esc(v.description || ""); }]
  ],
  zone: [
    ["Parts", function (ix, z) { var s = ix.zoneScene.get(z.id); return s ? countWord(arr(s.layout && s.layout.nodes).length, "part") : ""; }],
    ["Description", function (ix, z) { return esc(z.description || ""); }]
  ]
};

/** Who proposed a patch, in words: a person (by role), or an agent at someone's request. "" when not recorded. */
function proposedBy(p) {
  var pv = p && p.provenance; if (!pv) return "";
  if (pv.author === "agent" || pv.agent) return "An agent" + (pv.agent && pv.agent.tool ? " (" + pv.agent.tool + ")" : "") + (pv.requested_by ? ", at the request of " + pv.requested_by : "");
  var who = pv.author && pv.author !== "person" ? pv.author : pv.requested_by;
  return who ? cap1(who) + ", a person" : "A person";
}

// ---------- context: what a reference does not say ----------
/** A short list of unit titles, each a reference, then "and N more". */
function unitRefs(ix, ids, n) {
  ids = arr(ids); n = n || 2;
  return ids.slice(0, n).map(function (u) { return refChip(ix, "unit", u, PROSE.quote(clip((ix.unit.get(u) || {}).title || u, 48))); }).join(", ") + (ids.length > n ? esc(", and " + PROSE.count(ids.length - n, "more")) : "");
}
/** The open questions pinned to a record: the count and the first one's words. */
function openQuestions(ix, kind, id) {
  var qs = (ix.notesAt.get(kind + ":" + id) || []).filter(function (n) { return n.kind === "question" && n.status === "open"; });
  return qs.length ? esc(PROSE.count(qs.length, "open question")) + ': <span class="fg2">' + esc(PROSE.quote(clip(qs[0].text, 90))) + "</span>" : "";
}
/** Why a unit stands where it does, in one line. */
function unitWhy(ix, u) {
  var s = unitState(ix, u), a = ix.analysis || {};
  var set = u.attrs && u.attrs.status_set;
  var tr = ix.b.tracker && ix.b.tracker.reconcile, dis = tr && arr(tr.statusDisagreements).filter(function (d) { return d && d.unit === u.id; })[0];
  var trWords = dis ? " The tracker says " + dis.trackerStatus + "; a person settles which is right." : "";
  if (s === "done") return esc((set ? "Marked done by " + set.by + (set.date ? " on " + set.date : "") : "Done in the plan") + "." + trWords);
  if (s === "doing") return esc("Work has started; it is not done until its done-condition holds." + trWords);
  if (s === "ready") return esc("Everything it waits on is done, so it can start now." + trWords);
  var missing = arr(a.blocked && a.blocked[u.id] && a.blocked[u.id].missing);
  var none = missing.filter(function (c) { return !(ix.providers.get(c) || []).some(function (x) { return x !== u.id; }); });
  if (s === "noprov") return esc("It needs " + PROSE.list(none.length ? none : missing) + ", and no unit provides " + (none.length > 1 ? "them" : "it") + "." + trWords);
  var deps = arr(a.deps && a.deps[u.id]).filter(function (d) { var x = ix.unit.get(d); return x && x.status !== "done"; });
  var ac = missing.filter(function (c) { return acrossOf(ix, c); });
  if (ac.length && !deps.length) return esc("It waits on " + capWords(ac[0], ix) + " from " + acrossOf(ix, ac[0]) + "." + trWords);
  return esc("Blocked until " + (deps.length === 1 ? "the unit it waits on is" : "the " + PROSE.count(deps.length, "unit") + " it waits on are") + " done." + trWords);
}

/**
 * Context a card carries beyond its prominent fields: what the reference itself does not say (why a unit stands
 * where it does, what it waits on and unblocks, open questions; a part's units; a milestone's open work). A row with
 * no value is left out rather than shown as "Not set".
 */
var CARD_MORE = {
  unit: [
    ["Lead", function (ix, u) { return unitLeadHtml(ix, u.id); }],
    ["Why", function (ix, u) { return unitWhy(ix, u); }],
    ["Blocked by", function (ix, u) { var s = unitState(ix, u); return s === "blocked" || s === "noprov" ? blockersHtml(ix, u.id, { compact: true }) : ""; }],
    ["Blocking", function (ix, u) { if (u.status === "done") return ""; var f = unblockFacts(ix, u.id); if (!f.total) return ""; return esc(PROSE.count(f.total, "unit") + " wait on it" + (f.total > f.direct.length ? ", " + PROSE.fmt(f.direct.length) + " directly" : "")) + (f.direct.length ? ":" + mirrorHtml(ix, u.id, { compact: true }) : ""); }],
    ["Tracker", function (ix, u) { var st = ix.b.tracker && ix.b.tracker.reconcile && ix.b.tracker.reconcile.state && ix.b.tracker.reconcile.state[u.id]; return st ? esc(st.issue + ": " + st.status) : ""; }],
    ["Open questions", function (ix, u) { return openQuestions(ix, "unit", u.id); }]
  ],
  element: [
    ["Lives in", function (ix, e) { if (!e.home) return ""; var to = homePage(ix, e); return to ? "Outside this design: it lives in " + to + "." : esc("Outside this design: it lives in " + homeOf(ix, e) + "."); }],
    ["Today", function (ix, e) { var c = currentOf(ix, e.id); return c ? esc(currentLine(ix, c)) : ""; }],
    ["Work that changes it", function (ix, e) { if (e.home) return ""; var us = uniq((ix.unitsByEl.get(e.id) || []).map(function (x) { return x.unit; })); if (!us.length) return "No unit changes it yet"; var open = us.filter(function (x) { return (ix.unit.get(x) || {}).status !== "done"; }); return esc(PROSE.count(us.length, "unit") + " change it" + (open.length < us.length ? ", " + PROSE.fmt(open.length) + " open" : "")) + ": " + unitRefs(ix, us); }],
    ["Connects", function (ix, e) { var i = (ix.inn.get(e.id) || []).length, o = (ix.out.get(e.id) || []).length; return i + o ? esc(PROSE.fmt(i) + " in · " + PROSE.fmt(o) + " out") : ""; }],
    ["Rationale", function (ix, e) { var cs = claimsOnRec(ix, "element", e.id); return cs.length ? refChip(ix, "claim", cs[0], PROSE.quote(clip((ix.claim.get(cs[0]) || {}).statement || cs[0], 60))) + (cs.length > 1 ? esc(", and " + PROSE.count(cs.length - 1, "more")) : "") : ""; }],
    ["Open questions", function (ix, e) { return openQuestions(ix, "element", e.id); }]
  ],
  phase: [
    ["Lead", function (ix, p) { return leadHtml(p.lead); }],
    ["Open work", function (ix, p) { var us = (ix.unitsOfPhase.get(p.id) || []).filter(function (u) { return (ix.unit.get(u) || {}).status !== "done"; }); if (!us.length) return ""; var ready = us.filter(function (u) { return ix.frontier.has(u); }).length; return esc(PROSE.count(us.length, "open unit") + (ready ? ", " + PROSE.fmt(ready) + " can start now" : "")); }],
    ["Path to green", function (ix, p) { var m = msStatus(ix, p.id), path = m && !m.reached ? arr(m.path) : []; return path.length ? esc(PROSE.count(path.length, "step") + "; first: " + clip(path[0].text, 110)) : ""; }],
    ["Open questions", function (ix, p) { return openQuestions(ix, "phase", p.id); }]
  ],
  claim: [
    ["Tested by", function (ix, c) { var t = arr((c.attrs || {}).tested_by).filter(function (u) { return ix.unit.has(u); }); return t.length ? unitRefs(ix, t) : "Nothing tests it yet"; }],
    ["Open questions", function (ix, c) { return openQuestions(ix, "claim", c.id); }]
  ],
  patch: [
    ["Why", function (ix, p) { return esc(clip(p.why || "", 140)); }],
    ["Open questions", function (ix, p) { return openQuestions(ix, "patch", p.id); }]
  ]
};
function cardMore(ix, kind, id) {
  var r = recordOf(ix, kind, id), t = CARD_MORE[kind];
  if (!r || !t) return [];
  return t.map(function (f) { var v = ""; try { v = f[1](ix, r) || ""; } catch (e) { v = ""; } return { label: f[0], html: v }; }).filter(function (f) { return f.html; });
}
function cardMoreHtml(ix, kind, id) {
  var fs = cardMore(ix, kind, id);
  return fs.length ? '<dl class="card-more">' + fs.map(function (f) { return "<div><dt>" + esc(f.label) + "</dt><dd>" + f.html + "</dd></div>"; }).join("") + "</dl>" : "";
}

/** The prominent fields of one record: [{ label, html }], html "" when it has no value. */
function cardFields(ix, kind, id) {
  var r = recordOf(ix, kind, id), t = CARD[kind];
  if (!r || !t) return [];
  return t.map(function (f) { var v = ""; try { v = f[1](ix, r) || ""; } catch (e) { v = ""; } return { label: f[0], html: v }; });
}

/** The card's head: icon, kind word, id, the title (a link to the full page in the drawer). */
function cardHead(ix, kind, id, size) {
  var r = recordOf(ix, kind, id), title = recordTitle(ix, kind, id);
  var showId = kind !== "zone" && kind !== "team" && kind !== "contract";
  var idHtml = kind === "finding" && r ? '<span class="id">' + esc(r.at) + "</span>" : showId ? '<span class="id">' + esc(id) + "</span>" : "";
  var t = size === "drawer" ? '<a class="card-title" href="' + esc(recordHref(ix, kind, id)) + '" data-full-page>' + esc(title) + '<span class="sr-only"> (open the full page)</span></a>' : esc(title);
  return '<div class="card-head">' + icon("k-" + kind, "icon kind-ic") + '<span class="card-kind">' + esc(KIND_WORD[kind] || kind) + "</span>" + idHtml + "</div>"
    + (size === "page" ? "" : "<" + (size === "drawer" ? "h2" : "p") + ' class="card-t"' + (size === "drawer" ? ' tabindex="-1"' : "") + ">" + t + "</" + (size === "drawer" ? "h2" : "p") + ">");
}

/** The prominent fields as a list: label over value, "Not set" where the record has none. */
function cardFieldsHtml(ix, kind, id, size) {
  var fs = cardFields(ix, kind, id);
  if (size === "hover") fs = fs.slice(0, 4);
  return '<dl class="card-fields' + (size === "hover" ? " compact" : "") + '">' + fs.map(function (f) {
    return "<div><dt>" + esc(f.label) + "</dt><dd>" + (f.html || '<span class="novalue">Not set</span>') + "</dd></div>";
  }).join("") + "</dl>";
}

/** One renderer, three sizes: "hover" (a card), "drawer" (head, fields, linked groups), "page" (fields under a page head). */
function cardHtml(ix, kind, id, size) {
  if (!recordOf(ix, kind, id)) return '<p class="empty">No ' + esc((KIND_NOUN[kind] || [kind])[0]) + " " + esc(id) + " in this build.</p>";
  if (size === "page") return cardFieldsHtml(ix, kind, id, size);
  var h = cardHead(ix, kind, id, size) + cardFieldsHtml(ix, kind, id, size) + cardMoreHtml(ix, kind, id);
  if (size === "drawer") h += linkedHtml(ix, kind, id);
  return h;
}

// ---------- links: a generic table per kind ----------
function uniq(xs) { var s = new Set(), out = []; arr(xs).forEach(function (x) { if (x != null && !s.has(x)) { s.add(x); out.push(x); } }); return out; }
function findingsOn(ix, kind, id) { return (ix.findingsAt.get(kind + ":" + id) || []).map(findingKey); }
function notesOn(ix, kind, id) { return (ix.notesAt.get(kind + ":" + id) || []).map(function (n) { return n.id; }); }
function patchesOn(ix, kind, id) { return (ix.patchesAt.get(kind + ":" + id) || []).slice(); }
function claimsOnRec(ix, kind, id) { var s = ix.claimsOn.get(kind + ":" + id); return s ? Array.from(s) : []; }
function L(key, to, one, many, crumb, get) { return { key: key, to: to, one: one, many: many, crumb: crumb, get: get }; }

/**
 * For each kind, the links out of a record: key, the kind it reaches, the phrase for one record and for a set, the
 * crumb, and get(ix, id) -> ids of the target kind. A link to a kind with a list page (parts, units, claims,
 * findings, notes, patches) can be followed; the others show in the drawer only.
 */
var LINKS = {
  element: [
    L("changed-by", "unit", "Work that changes it", "Work that changes these", "work changing them", function (ix, id) { return (ix.unitsByEl.get(id) || []).map(function (x) { return x.unit; }); }),
    L("rests-on", "claim", "Rationale", "Rationale", "their rationale", function (ix, id) { return claimsOnRec(ix, "element", id); }),
    L("findings", "finding", "Problems the checks found", "Problems the checks found", "their problems", function (ix, id) { return findingsOn(ix, "element", id); }),
    L("notes", "note", "Notes", "Notes", "their notes", function (ix, id) { return notesOn(ix, "element", id); }),
    L("neighbours", "element", "Parts it connects to", "Parts they connect to", "their neighbours", function (ix, id) { return uniq((ix.out.get(id) || []).map(function (r) { return r.to; }).concat((ix.inn.get(id) || []).map(function (r) { return r.from; }))).filter(function (x) { return x !== id; }); }),
    L("patches", "patch", "Changes that touch it", "Changes that touch these", "changes touching them", function (ix, id) { return patchesOn(ix, "element", id); }),
    L("rel-out", "relationship", "Relationships out", "Relationships out", "relationships out", function (ix, id) { return (ix.out.get(id) || []).map(function (r) { return r.id; }); }),
    L("rel-in", "relationship", "Relationships in", "Relationships in", "relationships in", function (ix, id) { return (ix.inn.get(id) || []).map(function (r) { return r.id; }); }),
    L("contracts", "contract", "Contracts it produces or consumes", "Contracts", "their contracts", function (ix, id) { return ix.contractsOf.get(id) || []; }),
    L("views", "view", "Drawings it appears in", "Drawings they appear in", "their drawings", function (ix, id) { return ix.viewsByEl.get(id) || []; })
  ],
  unit: [
    L("parts", "element", "What it changes", "What they change", "parts they change", function (ix, id) { return uniq(arr((ix.unit.get(id) || {}).elements).map(function (m) { return m && m.id; })).filter(function (e) { return ix.el.has(e); }); }),
    L("depends-on", "unit", "Blocked by", "Blocked by", "units blocking them", function (ix, id) { return arr(ix.analysis.deps && ix.analysis.deps[id]).filter(function (x) { return x !== id; }); }),
    L("unblocks", "unit", "Blocking", "Blocking", "units they block", function (ix, id) { return arr(ix.analysis.unblocks && ix.analysis.unblocks[id]).filter(function (x) { return x !== id; }); }),
    L("downstream", "unit", "Downstream delay risk", "Downstream delay risk", "downstream delay risk", function (ix, id) { return downstreamOf(ix, id); }),
    L("rests-on", "claim", "Rationale", "Rationale", "their rationale", function (ix, id) { return claimsOnRec(ix, "unit", id); }),
    L("findings", "finding", "Problems the checks found", "Problems the checks found", "their problems", function (ix, id) { return findingsOn(ix, "unit", id); }),
    L("notes", "note", "Notes", "Notes", "their notes", function (ix, id) { return notesOn(ix, "unit", id); }),
    L("patches", "patch", "Changes that touch it", "Changes that touch these", "changes touching them", function (ix, id) { return patchesOn(ix, "unit", id); }),
    L("milestone", "phase", "Delivers toward", "Deliver toward", "their milestones", function (ix, id) { var u = ix.unit.get(id); return u && ix.phase.has(u.phase) ? [u.phase] : []; })
  ],
  claim: [
    L("parts", "element", "Parts that rest on it", "Parts that rest on these", "parts resting on them", function (ix, id) { return (ix.dependents.get(id) || {}).element || []; }),
    L("units", "unit", "Units that rest on it", "Units that rest on these", "units resting on them", function (ix, id) { return (ix.dependents.get(id) || {}).unit || []; }),
    L("rests-on", "claim", "Claims it builds on", "Claims they build on", "claims they build on", function (ix, id) { return arr((ix.claim.get(id) || {}).rests_on).filter(function (c) { return ix.claim.has(c); }); }),
    L("supports", "claim", "Claims built on it", "Claims built on these", "claims built on them", function (ix, id) { return (ix.dependents.get(id) || {}).claim || []; }),
    L("tested-by", "unit", "Work that tests it", "Work that tests these", "work testing them", function (ix, id) { return arr(((ix.claim.get(id) || {}).attrs || {}).tested_by).filter(function (u) { return ix.unit.has(u); }); }),
    L("findings", "finding", "Problems the checks found", "Problems the checks found", "their problems", function (ix, id) { return findingsOn(ix, "claim", id); }),
    L("notes", "note", "Notes", "Notes", "their notes", function (ix, id) { return notesOn(ix, "claim", id); }),
    L("relationships", "relationship", "Relationships that rest on it", "Relationships that rest on these", "relationships resting on them", function (ix, id) { return (ix.dependents.get(id) || {}).relationship || []; }),
    L("milestones", "phase", "Milestones that rest on it", "Milestones that rest on these", "milestones resting on them", function (ix, id) { return (ix.dependents.get(id) || {}).phase || []; })
  ],
  finding: [
    L("parts", "element", "The part it is on", "The parts they are on", "the parts they are on", function (ix, id) { var f = ix.finding.get(id); return f && f.atKind === "element" && ix.el.has(f.at) ? [f.at] : []; }),
    L("units", "unit", "The unit it is on", "The units they are on", "the units they are on", function (ix, id) { var f = ix.finding.get(id); return f && f.atKind === "unit" && ix.unit.has(f.at) ? [f.at] : []; }),
    L("claims", "claim", "The claim it is on", "The claims they are on", "the claims they are on", function (ix, id) { var f = ix.finding.get(id); return f && f.atKind === "claim" && ix.claim.has(f.at) ? [f.at] : []; }),
    L("notes", "note", "Notes", "Notes", "their notes", function (ix, id) { return notesOn(ix, "finding", id); })
  ],
  note: [
    L("parts", "element", "The part it is pinned to", "The parts they are pinned to", "the parts they are on", function (ix, id) { var n = ix.noteById.get(id); return n && n.target && n.target.kind === "element" && ix.el.has(n.target.id) ? [n.target.id] : []; }),
    L("units", "unit", "The unit it is pinned to", "The units they are pinned to", "the units they are on", function (ix, id) { var n = ix.noteById.get(id); return n && n.target && n.target.kind === "unit" && ix.unit.has(n.target.id) ? [n.target.id] : []; }),
    L("claims", "claim", "The claim it is pinned to", "The claims they are pinned to", "the claims they are on", function (ix, id) { var n = ix.noteById.get(id); return n && n.target && n.target.kind === "claim" && ix.claim.has(n.target.id) ? [n.target.id] : []; }),
    L("findings", "finding", "The finding it is pinned to", "The findings they are pinned to", "the findings they are on", function (ix, id) { var n = ix.noteById.get(id); return n && n.target && n.target.kind === "finding" && ix.finding.has(n.target.id) ? [n.target.id] : []; }),
    L("patches", "patch", "The patch it is pinned to", "The patches they are pinned to", "the patches they are on", function (ix, id) { var n = ix.noteById.get(id); return n && n.target && n.target.kind === "patch" && ix.patch.has(n.target.id) ? [n.target.id] : []; })
  ],
  patch: [
    L("parts", "element", "Parts it touches", "Parts they touch", "parts they touch", function (ix, id) { return (ix.patchEls.get(id) || []).filter(function (e) { return ix.el.has(e); }); }),
    L("units", "unit", "Units it affects", "Units they affect", "units they affect", function (ix, id) { return arr(((ix.patch.get(id) || {}).impact || {}).unitsAffected).filter(function (u) { return ix.unit.has(u); }); }),
    L("notes", "note", "Notes", "Notes", "their notes", function (ix, id) { return notesOn(ix, "patch", id); })
  ],
  relationship: [
    L("ends", "element", "The parts at its ends", "The parts at their ends", "the parts at their ends", function (ix, id) { var r = ix.rel.get(id); return r ? uniq([r.from, r.to]).filter(function (e) { return ix.el.has(e); }) : []; }),
    L("rests-on", "claim", "Rationale", "Rationale", "their rationale", function (ix, id) { return claimsOnRec(ix, "relationship", id); }),
    L("contracts", "contract", "Contracts it carries", "Contracts they carry", "contracts they carry", function (ix, id) { return arr((ix.rel.get(id) || {}).carries).filter(function (c) { return ix.contract.has(c); }); }),
    L("findings", "finding", "Problems the checks found", "Problems the checks found", "their problems", function (ix, id) { return findingsOn(ix, "relationship", id); }),
    L("notes", "note", "Notes", "Notes", "their notes", function (ix, id) { return notesOn(ix, "relationship", id); }),
    L("patches", "patch", "Changes that touch it", "Changes that touch these", "changes touching them", function (ix, id) { return patchesOn(ix, "relationship", id); })
  ],
  contract: [
    L("producers", "element", "Parts that produce it", "Parts that produce these", "parts producing them", function (ix, id) { return arr((ix.contract.get(id) || {}).produced_by).filter(function (e) { return ix.el.has(e); }); }),
    L("consumers", "element", "Parts that consume it", "Parts that consume these", "parts consuming them", function (ix, id) { return arr((ix.contract.get(id) || {}).consumed_by).filter(function (e) { return ix.el.has(e); }); }),
    L("carried-by", "relationship", "Relationships that carry it", "Relationships that carry these", "relationships carrying them", function (ix, id) { return ix.carriedBy.get(id) || []; }),
    L("notes", "note", "Notes", "Notes", "their notes", function (ix, id) { return notesOn(ix, "contract", id); })
  ],
  team: [
    L("parts", "element", "Parts it owns", "Parts they own", "parts they own", function (ix, id) { return ix.ownedParts.get(id) || []; }),
    L("units", "unit", "Units it owns", "Units they own", "units they own", function (ix, id) { return ix.ownedUnits.get(id) || []; }),
    L("verifies", "element", "Parts it verifies", "Parts they verify", "parts they verify", function (ix, id) { return ix.verifiedParts.get(id) || []; })
  ],
  phase: [
    L("units", "unit", "Work in it", "Work in these", "their work", function (ix, id) { return ix.unitsOfPhase.get(id) || []; }),
    L("rests-on", "claim", "Rationale", "Rationale", "their rationale", function (ix, id) { return claimsOnRec(ix, "phase", id); }),
    L("notes", "note", "Notes", "Notes", "their notes", function (ix, id) { return notesOn(ix, "phase", id); })
  ],
  view: [
    L("parts", "element", "Parts in it", "Parts in these", "their parts", function (ix, id) { return arr((ix.view.get(id) || {}).elements).filter(function (e) { return ix.el.has(e); }); })
  ],
  zone: [
    L("parts", "element", "Parts in it", "Parts in these", "their parts", function (ix, id) { var out = []; ix.el.forEach(function (e) { if ((e.zone || NONE) === id) out.push(e.id); }); return out; })
  ]
};
function linkOf(kind, key) { return arr(LINKS[kind]).filter(function (l) { return l.key === key; })[0] || null; }
function followable(l) { return !!KIND_PAGE[l.to]; }

/** The union of a link over a set of ids. */
function linkSet(ix, kind, ids, key) {
  var l = linkOf(kind, key); if (!l) return [];
  var seen = new Set(), out = [];
  arr(ids).forEach(function (id) { arr(l.get(ix, id)).forEach(function (t) { if (!seen.has(t)) { seen.add(t); out.push(t); } }); });
  return out;
}

/** Every link out of a set, with its count: what the Follow menu lists before you choose. Zero counts are dropped. */
function linkCounts(ix, kind, ids, opts) {
  opts = opts || {};
  return arr(LINKS[kind]).filter(function (l) { return !opts.followOnly || followable(l); }).map(function (l) {
    var set = linkSet(ix, kind, ids, l.key);
    return { key: l.key, to: l.to, label: ids.length === 1 ? l.one : l.many, crumb: l.crumb, count: set.length, ids: set };
  }).filter(function (x) { return x.count > 0; });
}

/** The drawer's "Linked" groups: one disclosure per link, its count in the summary, the records listed in place. */
function linkedHtml(ix, kind, id) {
  var gs = linkCounts(ix, kind, [id]);
  if (!gs.length) return '<section class="linked"><h3>Linked</h3><p class="small muted">Nothing links to this record.</p></section>';
  return '<section class="linked"><h3>Linked</h3>' + gs.map(function (g) {
    var shown = g.ids.slice(0, 40);
    // a unit's waits, both ways, grouped by capability: what it needs and from whom, and who needs what it provides
    var grouped = kind === "unit" && g.key === "depends-on" ? blockersHtml(ix, id) : kind === "unit" && g.key === "unblocks" ? mirrorHtml(ix, id) : "";
    if (grouped) return '<details class="disc linked-g" data-link="' + esc(g.key) + '"><summary><span>' + esc(g.label) + '</span><span class="count">' + PROSE.fmt(g.count) + '</span></summary><div class="body">' + grouped + "</div></details>";
    return '<details class="disc linked-g" data-link="' + esc(g.key) + '"><summary><span>' + esc(g.label) + '</span><span class="count">' + PROSE.fmt(g.count) + "</span></summary>"
      + '<div class="body"><ul class="rows">' + shown.map(function (t) { return "<li>" + refChip(ix, g.to, t) + "</li>"; }).join("")
      + (g.count > shown.length ? '<li class="small muted">' + esc(PROSE.fmt(g.count - shown.length) + " more") + (KIND_PAGE[g.to] ? "; follow them to see the whole set" : "") + "</li>" : "") + "</ul></div></details>";
  }).join("") + "</section>";
}

// ---------- facets and the filter predicate ----------
var FACETS = [
  { key: "zone", label: "Zone" }, { key: "system", label: "System" }, { key: "kind", label: "Kind" }, { key: "milestone", label: "Milestone" },
  { key: "status", label: "Status" }, { key: "owner", label: "Owner team" }, { key: "grade", label: "Grade" }, { key: "rule", label: "Rule" },
  { key: "finding", label: "Problems" }, { key: "note", label: "Notes" }
];
var FACET_KEYS = FACETS.map(function (f) { return f.key; });
var STATE_KEYS = FACET_KEYS.concat(["trail", "sel", "gate"]);

function addAll(set, xs) { arr(xs).forEach(function (x) { if (x != null && x !== "") set.add(x); }); }
function elFacets(ix, ids, out) {
  ids.forEach(function (id) {
    var e = ix.el.get(id); if (!e) return;
    out.zone.add(e.zone || NONE); if (ix.system.size) out.system.add(e.system || NONE);
    out.owner.add(e.owner || NONE);
  });
}

/** A record's values for every facet (sets of tokens). Memoized per index. */
function facetValues(ix, kind, id) {
  var k = kind + ":" + id;
  if (ix._fv.has(k)) return ix._fv.get(k);
  var o = {}; FACET_KEYS.forEach(function (f) { o[f] = new Set(); });
  var grades = function (cs) { cs.forEach(function (c) { var cc = ix.claim.get(c); if (cc) o.grade.add(cc.grade || "untested"); }); };
  var rules = function (fs) { fs.forEach(function (f) { o.rule.add(f.pack + "/" + f.rule); }); };
  var fsAt = function (k2) { return ix.findingsAt.get(k2) || []; };
  if (kind === "element") {
    var e = ix.el.get(id);
    if (e) {
      elFacets(ix, [id], o); o.kind.add(e.kind);
      (ix.unitsByEl.get(id) || []).forEach(function (x) { var u = ix.unit.get(x.unit); if (u) { o.milestone.add(u.phase); o.status.add(unitState(ix, u)); if (u.status !== "done") o.status.add("open"); } });
      grades(claimsOnRec(ix, "element", id)); rules(fsAt("element:" + id));
      o.finding.add(fsAt("element:" + id).length ? "yes" : "no"); o.note.add((ix.notesAt.get("element:" + id) || []).length ? "yes" : "no");
    }
  } else if (kind === "unit") {
    var u = ix.unit.get(id);
    if (u) {
      var parts = arr(u.elements).map(function (m) { return m && m.id; }).filter(function (x) { return ix.el.has(x); });
      parts.forEach(function (p) { var pe = ix.el.get(p); o.zone.add(pe.zone || NONE); if (ix.system.size) o.system.add(pe.system || NONE); });
      o.kind.add(u.kind); o.milestone.add(u.phase); o.status.add(unitState(ix, u)); if (u.status !== "done") o.status.add("open");
      var ow = unitRolesOf(ix, id).owners; if (ow.length) addAll(o.owner, ow); else o.owner.add(NONE);
      grades(claimsOnRec(ix, "unit", id)); rules(fsAt("unit:" + id));
      o.finding.add(fsAt("unit:" + id).length ? "yes" : "no"); o.note.add((ix.notesAt.get("unit:" + id) || []).length ? "yes" : "no");
    }
  } else if (kind === "claim") {
    var c = ix.claim.get(id);
    if (c) {
      var d = ix.dependents.get(id) || {};
      arr(d.element).forEach(function (p) { var pe = ix.el.get(p); if (pe) { o.zone.add(pe.zone || NONE); if (ix.system.size) o.system.add(pe.system || NONE); if (pe.owner) o.owner.add(pe.owner); } });
      arr(d.unit).forEach(function (x) { var uu = ix.unit.get(x); if (uu) o.milestone.add(uu.phase); });
      o.kind.add(c.kind || "premise"); o.grade.add(c.grade || "untested"); rules(fsAt("claim:" + id));
      o.finding.add(fsAt("claim:" + id).length ? "yes" : "no"); o.note.add((ix.notesAt.get("claim:" + id) || []).length ? "yes" : "no");
    }
  } else if (kind === "finding") {
    var f = ix.finding.get(id);
    if (f) {
      var sub = f.atKind === "element" || f.atKind === "unit" || f.atKind === "claim" ? facetValues(ix, f.atKind, f.at) : null;
      if (sub) ["zone", "system", "kind", "milestone", "status", "owner", "grade"].forEach(function (fk) { addAll(o[fk], Array.from(sub[fk])); });
      o.rule.add(f.pack + "/" + f.rule); o.finding.add("yes"); o.note.add((ix.notesAt.get("finding:" + id) || []).length ? "yes" : "no");
    }
  } else if (kind === "note") {
    var n = ix.noteById.get(id);
    if (n) {
      var tk = n.target && n.target.kind, tid = n.target && n.target.id;
      var ts = (tk === "element" || tk === "unit" || tk === "claim" || tk === "finding") && recordOf(ix, tk, tid) ? facetValues(ix, tk, tid) : null;
      if (ts) ["zone", "system", "milestone", "owner", "grade", "rule", "finding"].forEach(function (fk) { addAll(o[fk], Array.from(ts[fk])); });
      o.kind.add(n.kind); o.status.add(n.status || "open"); o.note.add("yes");
    }
  } else if (kind === "patch") {
    var p = ix.patch.get(id);
    if (p) {
      elFacets(ix, (ix.patchEls.get(id) || []).filter(function (x) { return ix.el.has(x); }), o);
      arr(p.impact && p.impact.unitsAffected).forEach(function (x) { var uu = ix.unit.get(x); if (uu) o.milestone.add(uu.phase); });
      o.status.add(p.status); o.finding.add(arr(p.impact && p.impact.findingsIntroduced).length ? "yes" : "no");
      rules(arr(p.impact && p.impact.findingsIntroduced)); o.note.add((ix.notesAt.get("patch:" + id) || []).length ? "yes" : "no");
    }
  } else if (kind === "relationship") {
    var r = ix.rel.get(id);
    if (r) { elFacets(ix, [r.from, r.to], o); o.kind.add(r.kind); grades(claimsOnRec(ix, "relationship", id)); }
  }
  ix._fv.set(k, o);
  return o;
}

/** Every value a facet takes over a kind: what the chip's popover lists, and whether a facet applies on a page. */
function facetUniverse(ix, kind, key) {
  var k = kind + "|" + key;
  if (ix._uni.has(k)) return ix._uni.get(k);
  var s = new Set();
  recordsOf(ix, kind).forEach(function (id) { facetValues(ix, kind, id)[key].forEach(function (v) { s.add(v); }); });
  ix._uni.set(k, s);
  return s;
}

/** The filters that apply to a kind, and the ones that do not (no record of that kind carries any selected value). */
function appliedFilters(ix, kind, F) {
  var applied = {}, ignored = [];
  FACET_KEYS.forEach(function (key) {
    var vals = arr(F && F[key]); if (!vals.length) return;
    var uni = facetUniverse(ix, kind, key);
    if (vals.some(function (v) { return uni.has(v); })) applied[key] = vals; else ignored.push(key);
  });
  return { applied: applied, ignored: ignored };
}

/** The one filter predicate: within a facet any value, across facets every facet. Ignored facets do not count. */
function matches(ix, kind, id, F, applied) {
  var A = applied || appliedFilters(ix, kind, F).applied;
  var fv = facetValues(ix, kind, id);
  for (var key in A) {
    var vals = A[key], have = fv[key];
    if (!have || !vals.some(function (v) { return have.has(v); })) return false;
  }
  return true;
}
function hasFilters(F) { return FACET_KEYS.some(function (k) { return arr(F && F[k]).length > 0; }); }

/** The records of a kind that match, as a Set; null when no filter applies (everything matches). */
function matchingSet(ix, kind, F, trail) {
  var A = appliedFilters(ix, kind, F).applied, any = Object.keys(A).length > 0;
  var base = trail && trail.kind === kind ? Array.from(trail.ids) : null;
  if (!any && !base) return null;
  var out = new Set();
  (base || recordsOf(ix, kind)).forEach(function (id) { if (!any || matches(ix, kind, id, F, A)) out.add(id); });
  return out;
}

/** A facet value as words. */
function facetLabel(ix, key, v) {
  if (key === "zone") return v === NONE ? "No zone" : (ix.zone.get(v) || {}).name || v;
  if (key === "system") return v === NONE ? "No system" : (ix.system.get(v) || {}).name || v;
  if (key === "milestone") return ix.phase.has(v) ? milestoneLabel(ix, v) : v;
  if (key === "status") return STATUS_WORD[v] || v;
  if (key === "owner") return v === NONE ? "No owner team" : teamName(ix, v);
  if (key === "grade") return (GRADES[v] || [0, cap1(v)])[1];
  if (key === "rule") { var r = ix.rules.get(v); return r ? r.title : v; }
  if (key === "finding") return v === "yes" ? "Has a problem" : "No problem";
  if (key === "note") return v === "yes" ? "Has a note" : "No note";
  return v;
}
/** The chip's text: "Zone: Edge or Control", "Has a problem". */
function chipText(ix, key, vals) {
  var facet = FACETS.filter(function (f) { return f.key === key; })[0];
  var words = arr(vals).map(function (v) { return facetLabel(ix, key, v); });
  if ((key === "finding" || key === "note") && words.length === 1) return words[0];
  return (facet ? facet.label : key) + ": " + PROSE.list(words, { conj: "or", max: 3 });
}

/** Counts per value of one facet over a kind, under every other filter: what the chip's popover lists. */
function facetCounts(ix, kind, key, F, trail) {
  var others = {}; FACET_KEYS.forEach(function (k) { if (k !== key && arr(F && F[k]).length) others[k] = F[k]; });
  var A = appliedFilters(ix, kind, others).applied;
  var base = trail && trail.kind === kind ? Array.from(trail.ids) : recordsOf(ix, kind);
  var c = new Map();
  facetUniverse(ix, kind, key).forEach(function (v) { c.set(v, 0); });
  base.forEach(function (id) { if (!matches(ix, kind, id, others, A)) return; facetValues(ix, kind, id)[key].forEach(function (v) { c.set(v, (c.get(v) || 0) + 1); }); });
  return Array.from(c.keys()).map(function (v) { return { value: v, label: facetLabel(ix, key, v), count: c.get(v) }; })
    .sort(function (a, b) { return (b.count > 0) - (a.count > 0) || (key === "milestone" ? milestoneIndex(ix, a.value) - milestoneIndex(ix, b.value) : 0) || (a.value === NONE) - (b.value === NONE) || b.count - a.count || natural(a.label, b.label); });
}

/**
 * A set described as a noun phrase: "Ready units in “See the stream”", "Parts in Edge", "Untested claims". With a count
 * n it leads with the number and agrees with it: "6 blocked units", "1 open unit in “See the stream”".
 */
function describeSet(ix, kind, F, n) {
  F = F || {};
  var nouns = KIND_NOUN[kind] || [kind, kind + "s"], noun = n === 1 ? nouns[0] : nouns[1];
  var adj = [];
  ["status", "grade"].forEach(function (k) { if (arr(F[k]).length) adj.push(PROSE.list(F[k].map(function (v) { return facetLabel(ix, k, v).toLowerCase(); }), { conj: "or" })); });
  var q = [];
  if (arr(F.zone).length) q.push("in " + PROSE.list(F.zone.map(function (v) { return facetLabel(ix, "zone", v); }), { conj: "or" }));
  if (arr(F.system).length) q.push("in " + PROSE.list(F.system.map(function (v) { return facetLabel(ix, "system", v); }), { conj: "or" }));
  if (arr(F.milestone).length) q.push("in " + PROSE.list(F.milestone.map(function (v) { return ix.phase.has(v) ? PROSE.quote(milestoneLabel(ix, v)) : v; }), { conj: "or" }));
  if (arr(F.kind).length) q.push("of kind " + PROSE.list(F.kind, { conj: "or" }));
  if (arr(F.owner).length) q.push(F.owner.length === 1 && F.owner[0] === NONE ? "with no owner team" : "owned by " + PROSE.list(F.owner.map(function (v) { return facetLabel(ix, "owner", v); }), { conj: "or" }));
  if (arr(F.rule).length) q.push("under " + PROSE.list(F.rule.map(function (v) { return PROSE.quote(facetLabel(ix, "rule", v)); }), { conj: "or" }));
  if (arr(F.finding).length === 1) q.push(F.finding[0] === "yes" ? "with a finding" : "with no finding");
  if (arr(F.note).length === 1) q.push(F.note[0] === "yes" ? "with a note" : "with no note");
  var phrase = (adj.length ? adj.join(" ") + " " : "") + noun + (q.length ? " " + q.join(" ") : "");
  return n != null ? PROSE.fmt(n) + " " + phrase : cap1(phrase);
}

// ---------- URL state ----------
/** Escape one value so ids with any character survive the hash: everything but letters, digits and - _ . */
function escV(s) { return encodeURIComponent(str(s)).replace(/[!'()*~]/g, function (c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); }); }
function unescV(s) { return dec(str(s)); }
function filterPart(F) {
  return FACET_KEYS.filter(function (k) { return arr(F && F[k]).length; }).map(function (k) { return k + "=" + F[k].map(escV).join(","); });
}
var FACET_ALIAS = { gate: "milestone" }; // older links
function parseFilterPart(get) {
  var F = {};
  FACET_KEYS.forEach(function (k) { var v = get(k); if (!v) Object.keys(FACET_ALIAS).forEach(function (old) { if (FACET_ALIAS[old] === k && get(old)) v = get(old); }); if (v) { var xs = uniq(str(v).split(",").filter(Boolean).map(unescV)); if (xs.length) F[k] = xs; } });
  return F;
}
/** The trail as text: steps joined by "~"; a step is a head ("element", "element:<id>" or a link key) then "!key=v,v" filters. */
function trailString(steps) {
  return arr(steps).map(function (s, i) {
    var head = i === 0 ? (s.id != null ? s.kind + ":" + escV(s.id) : s.kind) : s.link;
    var fs = filterPart(s.f || {});
    return [head].concat(fs).join("!");
  }).join("~");
}
function parseTrail(t) {
  if (!t) return null;
  var steps = str(t).split("~").map(function (part, i) {
    var bits = part.split("!"), head = bits[0], f = {};
    bits.slice(1).forEach(function (kv) { var j = kv.indexOf("="), key = FACET_ALIAS[kv.slice(0, j)] || kv.slice(0, j); if (j > 0 && FACET_KEYS.indexOf(key) >= 0) { var xs = kv.slice(j + 1).split(",").filter(Boolean).map(unescV); if (xs.length) f[key] = xs; } });
    if (i === 0) { var c = head.indexOf(":"); return c < 0 ? { kind: head, f: f } : { kind: head.slice(0, c), id: unescV(head.slice(c + 1)), f: f }; }
    return { link: head, f: f };
  });
  return steps.length && steps[0].kind ? steps : null;
}
/** Page state from a parsed route's raw query: filters, the trail and the selection. */
function stateOf(r) {
  var raw = (r && r.raw) || {};
  var get = function (k) { return raw[k]; };
  var sel = raw.sel ? unescV(raw.sel) : null;
  return { f: parseFilterPart(get), trail: parseTrail(raw.trail), sel: sel && sel.indexOf(":") > 0 ? sel : null };
}
/** The query text for a state, in a stable order. */
function stateQuery(st) {
  st = st || {};
  var parts = filterPart(st.f || {});
  if (st.trail && st.trail.length) parts.push("trail=" + trailString(st.trail));
  if (st.sel) parts.push("sel=" + escV(st.sel));
  return parts.join("&");
}
/** A route hash with this state in its query; the hash's own query keys (depth, at ...) stay, its state keys are replaced. */
function withState(hash, st) {
  var h = str(hash), qi = h.indexOf("?"), base = qi < 0 ? h : h.slice(0, qi), own = qi < 0 ? [] : h.slice(qi + 1).split("&").filter(function (kv) { return kv && STATE_KEYS.indexOf(kv.split("=")[0]) < 0; });
  var q = own.concat(stateQuery(st) ? [stateQuery(st)] : []).join("&");
  return base + (q ? "?" + q : "");
}
/** Whether a hash names any state key of its own (then a link keeps it as written). */
function hashHasState(hash) {
  var h = str(hash), qi = h.indexOf("?"); if (qi < 0) return false;
  return h.slice(qi + 1).split("&").some(function (kv) { return STATE_KEYS.indexOf(kv.split("=")[0]) >= 0; });
}

// ---------- the hop trail ----------
/** Evaluate a trail: the set each step reaches, its crumb, its count. The last step's own filter is the live one (F). */
function evalTrail(ix, steps, F) {
  if (!steps || !steps.length) return null;
  var s0 = steps[0], kind = s0.kind, ids;
  if (s0.id != null) ids = recordOf(ix, kind, s0.id) ? [s0.id] : [];
  else { var A0 = appliedFilters(ix, kind, s0.f).applied; ids = recordsOf(ix, kind).filter(function (id) { return matches(ix, kind, id, s0.f, A0); }); }
  var crumbs = [{ label: s0.id != null ? recordTitle(ix, kind, s0.id) : describeSet(ix, kind, s0.f), kind: kind, count: ids.length }];
  for (var i = 1; i < steps.length; i++) {
    var st = steps[i], l = linkOf(kind, st.link);
    if (!l) break;
    var next = linkSet(ix, kind, ids, st.link);
    kind = l.to;
    var Ai = appliedFilters(ix, kind, st.f).applied;
    if (i < steps.length - 1 && Object.keys(Ai).length) next = next.filter(function (id) { return matches(ix, kind, id, st.f, Ai); });
    ids = next;
    var adj = i < steps.length - 1 ? st.f : F;
    var shown = ids.length;
    if (i === steps.length - 1 && hasFilters(F)) { var AF = appliedFilters(ix, kind, F).applied; shown = ids.filter(function (id) { return matches(ix, kind, id, F, AF); }).length; }
    crumbs.push({ label: l.crumb + (hasFilters(adj) ? " · " + filterWords(ix, adj) : ""), kind: kind, count: shown, link: st.link });
  }
  return { kind: kind, ids: new Set(ids), crumbs: crumbs, steps: steps.slice(0, crumbs.length) };
}

/** A filter as a few words for a crumb: "untested, in Edge". */
function filterWords(ix, F) {
  var w = [];
  FACET_KEYS.forEach(function (k) { if (arr(F[k]).length) w.push(k === "zone" || k === "system" || k === "milestone" ? "in " + PROSE.list(F[k].map(function (v) { return facetLabel(ix, k, v); }), { conj: "or" }) : PROSE.list(F[k].map(function (v) { return facetLabel(ix, k, v).toLowerCase(); }), { conj: "or" })); });
  return w.join(", ");
}

/** The hash a crumb climbs to: the trail up to that step, that step's filter live again, on the page of its kind. */
function crumbHash(steps, i) {
  var kept = steps.slice(0, i + 1).map(function (s) { return { kind: s.kind, id: s.id, link: s.link, f: s.f }; });
  var last = kept[kept.length - 1], f = last.f || {};
  var kind = kindOfStep(kept);
  last.f = {};
  var trail = kept.length === 1 && kept[0].id == null ? null : kept;
  return withState(kindHash(kind), { f: f, trail: trail });
}
function kindOfStep(steps) {
  var kind = steps[0].kind;
  for (var i = 1; i < steps.length; i++) { var l = linkOf(kind, steps[i].link); if (!l) break; kind = l.to; }
  return kind;
}
/** The page a set of a kind is listed on, at its list: the Plan's unit table, the Model's element list. */
function kindHash(kind) { return { element: "#model/elements", unit: "#plan/units", claim: "#strategy", finding: "#checks", note: "#notes", patch: "#changes" }[kind] || "#overview"; }

/** Follow a link from a set: the new hash. From a record (start {kind, id}) or from a list (its trail and live filter). */
function followHash(start, key) {
  var steps;
  if (start.trail && start.trail.length) {
    steps = start.trail.map(function (s) { return { kind: s.kind, id: s.id, link: s.link, f: s.f || {} }; });
    steps[steps.length - 1].f = start.f || {};
  } else steps = [start.id != null ? { kind: start.kind, id: start.id, f: {} } : { kind: start.kind, f: start.f || {} }];
  steps.push({ link: key, f: {} });
  var kind = kindOfStep(steps);
  return withState(kindHash(kind), { f: {}, trail: steps });
}

// ---------- ids in prose ----------
/** Known ids in plain text become record chips (hover card, drawer). Text is escaped; only whole tokens match. */
/** Attribute keys an author may write in prose, in words (the same words core uses for findings, src/core/reader.ts). */
var KEY_WORDS = { "attrs.wip_limit": "WIP limit", wip_limit: "WIP limit", "attrs.wait_days": "wait in days", wait_days: "wait in days", partitioned_by: "partition key" };
/** Ids in a text become references named by what they point at; verbatim (a person's or Claude's own words, a note): the text stays exactly as written, its ids still linked. */
function linkifyText(ix, text, verbatim) {
  var t = verbatim ? str(text) : str(text).replace(/\b(attrs\.)?(wip_limit|wait_days|partitioned_by)\b/g, function (m) { return KEY_WORDS[m] || m; });
  return t.split(/([A-Za-z0-9][A-Za-z0-9:._\/@-]*[A-Za-z0-9])/).map(function (tok, i) {
    if (i % 2 === 0) return esc(tok);
    var k = idKind(ix, tok);
    return k ? refChip(ix, k, tok, verbatim ? tok : k === "note" ? "a note" : k === "unit" ? PROSE.quote(ix.unit.get(tok).title) : k === "claim" ? PROSE.quote(clip(ix.claim.get(tok).statement, 60)) : k === "patch" ? PROSE.quote(ix.patch.get(tok).title) : recordTitle(ix, k, tok), "inline-ref", tok) : esc(tok);
  }).join("");
}
function idKind(ix, tok) {
  if (ix.unit.has(tok)) return "unit";
  if (ix.claim.has(tok)) return "claim";
  if (ix.patch.has(tok)) return "patch";
  if (/^N-\d+$/.test(tok) && ix.noteById.has(tok)) return "note";
  if (ix.el.has(tok) && /[.\-]/.test(tok)) return "element";
  if (ix.rel.has(tok) && /\d/.test(tok)) return "relationship";
  return null;
}

api.cardFields = cardFields; api.cardHtml = cardHtml; api.CARD = CARD; api.CARD_MORE = CARD_MORE; api.cardMore = cardMore; api.proposedBy = proposedBy; api.LINKS = LINKS; api.linkCounts = linkCounts; api.linkSet = linkSet;
api.facetValues = facetValues; api.matches = matches; api.matchingSet = matchingSet; api.appliedFilters = appliedFilters; api.facetCounts = facetCounts;
api.stateOf = stateOf; api.stateQuery = stateQuery; api.withState = withState; api.parseTrail = parseTrail; api.trailString = trailString;
api.kindHash = kindHash; api.evalTrail = evalTrail; api.crumbHash = crumbHash; api.followHash = followHash; api.describeSet = describeSet; api.chipText = chipText;
api.recordOf = recordOf; api.recordsOf = recordsOf; api.recordTitle = recordTitle; api.recordHref = recordHref; api.linkifyText = linkifyText;
api.KIND_PAGE = KIND_PAGE; api.FACETS = FACETS; api.escV = escV; api.notAppliedHere = notAppliedHere;

/** The Model inspector for a zone scene with nothing selected: the zone, its parts by kind, its portals. */
function zoneIntro(ix, zoneId) {
  var s = ix.zoneScene.get(zoneId);
  if (!s) return '<p class="empty">Pick a zone in the rail.</p>';
  var kinds = new Map();
  arr(s.layout.nodes).forEach(function (n) { var e = ix.el.get(n.id); if (e) kinds.set(e.kind, (kinds.get(e.kind) || 0) + 1); });
  var z = ix.zone.get(zoneId), t = zoneTint(ix, zoneId === NONE ? null : zoneId);
  var portal = function (p) { return '<li><a href="' + R.zone(p.zone == null ? NONE : p.zone) + '"><i class="swatch ' + zoneTint(ix, p.zone).cls + '" aria-hidden="true"></i>' + esc(p.name) + '</a><span class="muted small num" style="margin-left:auto">' + PROSE.fmt(p.count) + "</span></li>"; };
  var outs = arr(s.portals).filter(function (p) { return p.dir === "out"; }), ins = arr(s.portals).filter(function (p) { return p.dir === "in"; });
  return '<div class="insp-head"><span class="kind">' + icon("k-zone", "icon icon-sm") + ' Zone</span><h2><i class="swatch ' + t.cls + '" aria-hidden="true"></i> ' + esc(s.name) + "</h2></div>"
    + (z && z.description ? '<p class="small fg2">' + esc(z.description) + "</p>" : "")
    + sec("Parts by kind", arr(s.layout.nodes).length, '<ul class="rows">' + Array.from(kinds.keys()).sort().map(function (k) { return "<li><span>" + esc(k) + '</span><span class="muted small num" style="margin-left:auto">' + kinds.get(k) + "</span></li>"; }).join("") + "</ul>")
    + (outs.length ? sec("Relationships out, by zone", outs.reduce(function (n, p) { return n + p.count; }, 0), '<ul class="rows">' + outs.map(portal).join("") + "</ul>") : "")
    + (ins.length ? sec("Relationships in, by zone", ins.reduce(function (n, p) { return n + p.count; }, 0), '<ul class="rows">' + ins.map(portal).join("") + "</ul>") : "")
    + '<p class="small muted" style="margin-top:12px">Select a part to see its detail, or a doorway to open that zone.</p>';
}
api.zoneIntro = zoneIntro;

/** A Follow button for a record's full page; the menu lists its links with counts. */
function followBtn(kind, id) {
  if (!ixHasFollow(kind)) return "";
  return '<span class="menu-wrap"><button type="button" class="btn sm follow-rec" data-follow-rec="' + esc(rkey(kind, id)) + '" aria-haspopup="true">' + icon("follow", "icon icon-sm") + "Follow</button></span>";
}
function ixHasFollow(kind) { return arr(LINKS[kind]).some(followable); }
