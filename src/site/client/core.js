/* Plumb site client, part 1: helpers, the index, routes and the inspector bodies.
   Plain browser JavaScript, no library, no network. These four files are concatenated inside one function
   (see CLIENT_JS in render.ts), so they share one scope; `api` is what the page and the tests see.
   Everything here is pure (bundle in, HTML strings out) so tests run it without a DOM, and every lookup is
   defensive: a malformed bundle degrades to placeholders instead of a blank page. */

function arr(x) { return Array.isArray(x) ? x : []; }
function str(x) { return x == null ? "" : String(x); }
function esc(v) {
  return str(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function natural(a, b) { return str(a).localeCompare(str(b), undefined, { numeric: true, sensitivity: "base" }); }
function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d || 0); }
function plural(n, one, many) { return PROSE.count(n, one, many); }
function push(map, k, v) { var a = map.get(k); if (!a) { a = []; map.set(k, a); } if (a.indexOf(v) < 0) a.push(v); }
function slug(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other"; }
function r1(n) { return Math.round(n * 10) / 10; }
function cap1(s) { s = str(s); return s.charAt(0).toUpperCase() + s.slice(1); }

var enc = encodeURIComponent;
var R = {
  element: function (id) { return "#model/element/" + enc(id); },
  focus: function (id, depth) { return "#model/focus/" + enc(id) + (depth === 2 ? "?depth=2" : ""); },
  view: function (id) { return "#model/view/" + enc(id); },
  zone: function (id) { return "#model/zone/" + enc(id == null || id === "" ? "_none" : id); },
  unit: function (id) { return "#plan/unit/" + enc(id); },
  milestone: function (id) { return "#plan/milestone/" + enc(id); },
  rule: function (pack, rule) { return "#checks/rule/" + enc(pack) + "/" + enc(rule); },
  patch: function (id) { return "#changes/" + enc(id); },
  tracker: function (step, group) { return "#tracker/" + step + (group ? "/" + enc(group) : ""); },
  units: function () { return "#plan/units"; },
  claim: function (id) { return "#strategy/claim/" + enc(id); },
  note: function (id) { return "#notes/" + enc(id); },
  present: function (n) { return "#present" + (n > 1 ? "/" + n : ""); },
  teams: function () { return "#teams"; }
};

var UNIT_WORD = { done: "Done", doing: "In progress", ready: "Ready", blocked: "Blocked", noprov: "Needs work (unplanned)" };
var NOUN = { element: ["part", "parts"], unit: ["unit", "units"], relationship: ["relationship", "relationships"], contract: ["contract", "contracts"], phase: ["milestone", "milestones"], view: ["view", "views"], team: ["team", "teams"], system: ["system", "systems"], zone: ["zone", "zones"], instance: ["place", "places"] };

function icon(name, cls) { return '<svg class="' + (cls || "icon") + '" aria-hidden="true" focusable="false"><use href="#i-' + name + '"></use></svg>'; }
/** A milestone's status: an icon and a word (red, amber, green), never colour alone. */
var RAG_WORD = { red: "Red", amber: "Amber", green: "Green" };
function ragHtml(st, size) { return st ? '<span class="st rag-' + esc(st) + (size ? " " + size : "") + '">' + icon("rag-" + st) + '<span class="w">' + esc(RAG_WORD[st] || st) + "</span></span>" : ""; }
function msStatus(ix, phaseId) { return arr(ix.b && ix.b.status && ix.b.status.milestones).filter(function (m) { return m && m.phase === phaseId; })[0] || null; }
function statusHtml(kind, word, size) { return '<span class="st ' + esc(kind) + (size ? " " + size : "") + '">' + icon(kind) + '<span class="w">' + esc(word) + "</span></span>"; }
/** A patch's verdict as a small status: the core's level (an amber patch is never shown as passing), else breaks or passes. */
function verdictHtml(p) {
  var im = (p && p.impact) || {}, br = arr(im.findingsIntroduced).filter(function (f) { return f.severity === "error"; }).length;
  var lv = (im.verdict && im.verdict.level) || (br ? "fail" : "pass");
  return lv === "fail" ? statusHtml("fail", "Breaks " + PROSE.count(Math.max(br, 1), "check"), "sm") : lv === "caution" ? statusHtml("warning", "Review before accepting", "sm") : statusHtml("pass", "Passes every check", "sm");
}

// ---------- index ----------
function buildIndex(b) {
  b = b || {};
  var m = b.model || {}, p = b.plan || {}, a = b.analysis || {};
  var ix = {
    b: b, analysis: a,
    el: new Map(), rel: new Map(), unit: new Map(), team: new Map(), zone: new Map(), system: new Map(),
    phase: new Map(), contract: new Map(), view: new Map(), layout: new Map(), patch: new Map(),
    out: new Map(), inn: new Map(), providers: new Map(), requirers: new Map(), unitsByEl: new Map(),
    findingsAt: new Map(), viewsByEl: new Map(), patchesAt: new Map(), children: new Map(),
    zoneIdx: new Map(), teamIdx: new Map(), phaseOrder: [], issueOf: new Map(),
    frontier: new Set(arr(a.frontier)), critical: new Set(arr(a.critical_path)),
    ladder: arr(b.instance && b.instance.ladder).length ? b.instance.ladder : ["none", "stand-in", "existing-tool", "built"],
    rules: new Map()
  };
  arr(m.elements).forEach(function (e) { if (e && e.id != null) ix.el.set(e.id, e); });
  arr(m.elements).forEach(function (e) { if (e && e.parent) push(ix.children, e.parent, e.id); });
  arr(m.relationships).forEach(function (r) {
    if (!r || r.id == null) return;
    ix.rel.set(r.id, r); push(ix.out, r.from, r); push(ix.inn, r.to, r);
  });
  arr(m.teams).forEach(function (t, i) { if (t) { ix.team.set(t.id, t); ix.teamIdx.set(t.id, i); } });
  arr(m.zones).forEach(function (t, i) { if (t) { ix.zone.set(t.id, t); ix.zoneIdx.set(t.id, i); } });
  arr(m.systems).forEach(function (t) { if (t) ix.system.set(t.id, t); });
  arr(m.contracts).forEach(function (c) { if (c && c.name != null) ix.contract.set(c.name, c); });
  arr(m.views).forEach(function (v) {
    if (!v || v.id == null) return;
    ix.view.set(v.id, v);
    arr(v.elements).forEach(function (e) { push(ix.viewsByEl, e, v.id); });
  });
  arr(b.layouts).forEach(function (l) { if (l && l.view != null) ix.layout.set(l.view, l); });
  ix.phaseOrder = arr(p.phases).filter(Boolean).slice().sort(function (x, y) { return num(x.order) - num(y.order) || natural(x.id, y.id); });
  ix.phaseOrder.forEach(function (ph) { ix.phase.set(ph.id, ph); });
  arr(p.units).forEach(function (u) {
    if (!u || u.id == null || ix.unit.has(u.id)) return; // duplicate ids: the first wins, as in the analysis
    ix.unit.set(u.id, u);
    arr(u.provides).forEach(function (c) { push(ix.providers, c, u.id); });
    arr(u.requires).forEach(function (c) { push(ix.requirers, c, u.id); });
    arr(u.elements).forEach(function (mv) { if (mv) push(ix.unitsByEl, mv.id, { unit: u.id, from: mv.from, to: mv.to }); });
  });
  arr(b.findings).forEach(function (f) { if (f) push(ix.findingsAt, f.atKind + ":" + f.at, f); });
  arr(b.instance && b.instance.packs).forEach(function (pk) { arr(pk && pk.rules).forEach(function (r) { ix.rules.set(pk.name + "/" + r.id, r); }); });
  arr(b.patches).forEach(function (pt) {
    if (!pt) return;
    ix.patch.set(pt.id, pt);
    var im = pt.impact || {};
    ["added", "removed", "modified", "cascade"].forEach(function (k) { arr(im[k]).forEach(function (r) { if (r) push(ix.patchesAt, r.kind + ":" + r.id, pt.id); }); });
    arr(im.unitsAffected).forEach(function (u) { push(ix.patchesAt, "unit:" + u, pt.id); });
    // a relationship the patch adds or removes touches both of its ends
    ["added", "removed"].forEach(function (k) { arr(im[k]).forEach(function (r) {
      if (!r || r.kind !== "relationship") return;
      var s = im.records && im.records["relationship:" + r.id];
      if (s) { if (s.from) push(ix.patchesAt, "element:" + s.from, pt.id); if (s.to) push(ix.patchesAt, "element:" + s.to, pt.id); }
    }); });
  });
  var st = b.tracker && b.tracker.reconcile && b.tracker.reconcile.state;
  if (st && typeof st === "object") Object.keys(st).forEach(function (u) { if (st[u]) ix.issueOf.set(u, st[u].issue); });
  // current state (0.4): each part's record, and how a replaced or retired part's retirement stands (src/core/current.ts)
  ix.current = new Map(); ix.retire = new Map();
  arr(b.current && b.current.records).forEach(function (c) { if (c && c.part != null) ix.current.set(c.part, c); });
  arr(b.current && b.current.retirements).forEach(function (c) { if (c && c.part != null) ix.retire.set(c.part, c); });
  indexStrategy(ix);
  indexGrammar(ix);
  return ix;
}

function unitState(ix, u) {
  if (!u) return "blocked";
  var st = u.status || "todo";
  if (st === "done") return "done";
  if (st === "doing") return "doing";
  if (ix.frontier.has(u.id)) return "ready";
  var bl = ix.analysis.blocked && ix.analysis.blocked[u.id];
  var missing = bl ? arr(bl.missing) : arr(u.requires).filter(function (c) {
    return !(ix.providers.get(c) || []).some(function (pid) { var pu = ix.unit.get(pid); return pu && pu.status === "done"; });
  });
  return missing.some(function (c) { return !(ix.providers.get(c) || []).some(function (pid) { return pid !== u.id; }) && !acrossOf(ix, c); }) ? "noprov" : "blocked";
}
/** Who provides a capability across a seam (0.4), in words, or "". */
/** A namespaced reference as a reader names it: "shared:ProvenClass" is "ProvenClass" where its namespace is one this design knows (a 0.4 design's homes); anything else as written, so a lone instance's names never change. */
function plainRef(ix, id) { var s = str(id), i = s.indexOf(":"), homes = (ix && ix.b && ix.b.instance && ix.b.instance.homes) || {}; return i > 0 && homes[s.slice(0, i)] ? s.slice(i + 1) : s; }
function acrossOf(ix, c) { var b = ix.b || {}, p = ((b.analysis || {}).outside || {})[c]; return p ? PROSE.list(p.map(function (n) { return ((b.instance || {}).homes || {})[n] || n; })) + ", outside this design" : ""; }

function milestoneIndex(ix, phaseId) { for (var i = 0; i < ix.phaseOrder.length; i++) if (ix.phaseOrder[i].id === phaseId) return i; return -1; }
/** A milestone by its name (never by number): a checkpoint where a complete unit of value is delivered. */
function milestoneLabel(ix, phaseId) {
  var p = ix.phase.get(phaseId);
  if (!p) return str(phaseId);
  return p.name || str(phaseId);
}
function zoneTint(ix, zoneId) {
  var i = zoneId == null ? undefined : ix.zoneIdx.get(zoneId);
  if (i == null) return { cls: "t0", hatch: false };
  return { cls: "t" + ((i % 6) + 1), hatch: i >= 6 };
}

/** Open units that wait on this one, directly and through others, and the ones it alone readies. */
/** Every open unit downstream of this one, directly or through others: the set "unblocks N" counts, in plan order. */
function downstreamOf(ix, id) {
  var a = ix.analysis || {};
  var open = function (x) { var u = ix.unit.get(x); return u && u.status !== "done"; };
  var seen = new Set([id]), stack = [id], out = [];
  while (stack.length) arr(a.unblocks && a.unblocks[stack.pop()]).forEach(function (n) { if (open(n) && !seen.has(n)) { seen.add(n); stack.push(n); out.push(n); } });
  var order = function (x) { var u = ix.unit.get(x), p = u && ix.phase.get(u.phase); return p ? num(p.order) : 1e9; };
  return out.sort(function (x, y) { return order(x) - order(y) || natural(x, y); });
}
function unblockFacts(ix, id) {
  var a = ix.analysis || {};
  var open = function (x) { var u = ix.unit.get(x); return u && u.status !== "done"; };
  var direct = arr(a.unblocks && a.unblocks[id]).filter(function (x) { return x !== id && open(x); });
  var total;
  if (a.unblocksTransitive && a.unblocksTransitive[id] !== undefined) total = a.unblocksTransitive[id];
  else {
    var seen = new Set([id]), stack = [id];
    while (stack.length) arr(a.unblocks && a.unblocks[stack.pop()]).forEach(function (n) { if (open(n) && !seen.has(n)) { seen.add(n); stack.push(n); } });
    total = seen.size - 1;
  }
  var readies = direct.filter(function (d) {
    return arr(a.deps && a.deps[d]).every(function (x) { return x === id || !open(x); });
  });
  return { direct: direct, total: total, readies: readies };
}

/** The ranked frontier, as on the Plan page and in the MCP server: transitive, then direct, then id. */
function rankedFrontier(ix) {
  return arr(ix.analysis.frontier).filter(function (id) { return ix.unit.has(id); }).map(function (id) {
    var f = unblockFacts(ix, id); return { id: id, total: f.total, direct: f.direct.length };
  }).sort(function (x, y) { return y.total - x.total || y.direct - x.direct || natural(x.id, y.id); });
}

/** An element's current level on the ladder: the highest level a done unit moved it to, else where its first unit starts. */
function fidelityOf(ix, elId) {
  var moves = ix.unitsByEl.get(elId) || [];
  if (!moves.length) return -1;
  var L = ix.ladder, best = -1, start = 1e9;
  moves.forEach(function (mv) {
    var u = ix.unit.get(mv.unit);
    var ti = L.indexOf(mv.to), fi = L.indexOf(mv.from);
    if (u && u.status === "done" && ti > best) best = ti;
    if (fi >= 0 && fi < start) start = fi;
  });
  return best >= 0 ? best : (start < 1e9 ? start : 0);
}

/** An element's plan state across the units that touch it. */
function planStateOf(ix, elId) {
  var moves = ix.unitsByEl.get(elId) || [];
  if (!moves.length) return null;
  var states = moves.map(function (mv) { return unitState(ix, ix.unit.get(mv.unit)); });
  if (states.indexOf("doing") >= 0) return "doing";
  if (states.indexOf("ready") >= 0) return "ready";
  if (states.every(function (s) { return s === "done"; })) return "done";
  return "blocked";
}

// ---------- references ----------
function unitLink(ix, id, withTitle) {
  var u = ix.unit.get(id);
  if (!u) return '<span class="muted" title="Not in the plan">' + esc(id) + "</span>";
  var s = unitState(ix, u);
  // with its title, the id is only the tooltip and the hover card; a compact chip without one shows the id
  if (withTitle === false) return '<a class="unit-ref" href="' + R.unit(id) + '" data-unit="' + esc(id) + '" title="' + esc(u.title) + '">' + icon(s, "icon icon-sm st-" + s) + '<span class="sr-only">' + UNIT_WORD[s] + ': </span><span class="id">' + esc(id) + "</span></a>";
  return '<a class="unit-ref" href="' + R.unit(id) + '" data-unit="' + esc(id) + '" title="' + esc(id) + '">' + icon(s, "icon icon-sm st-" + s) + '<span class="sr-only">' + UNIT_WORD[s] + ': </span>' + esc(u.title) + "</a>";
}
function elLink(ix, id, label) {
  var e = ix.el.get(id);
  if (!e) return '<span class="muted" title="Not in the model">' + esc(label || id) + "</span>";
  return '<a href="' + R.element(id) + '" data-element="' + esc(id) + '">' + esc(e.name || id) + "</a>";
}
function capChip(ix, c) {
  return '<button type="button" class="chip' + (ix.providers.has(c) ? "" : " missing") + '" data-cap="' + esc(c) + '" aria-haspopup="dialog">' + esc(capWords(c, ix)) + "</button>";
}
function ladderHtml(ix, from, to) {
  return '<span class="ladder" aria-label="from ' + esc(from) + " to " + esc(to) + '"><span>' + esc(from) + '</span><span aria-hidden="true">&#8594;</span><span class="to">' + esc(to) + "</span></span>";
}
function sec(title, count, body) {
  if (!body) return "";
  return "<section><h3>" + esc(title) + (count != null ? ' <span class="count">' + count + "</span>" : "") + "</h3>" + body + "</section>";
}
function idCopy(id) { return '<code class="id">' + esc(id) + '</code><button type="button" class="copy-btn" data-copy="' + esc(id) + '" aria-label="Copy id ' + esc(id) + '">Copy</button>'; }
function findingsList(ix, kind, id) {
  var fs = ix.findingsAt.get(kind + ":" + id) || [];
  if (!fs.length) return "";
  return '<ul class="rows">' + fs.map(function (f) {
    var r = ix.rules.get(f.pack + "/" + f.rule);
    var sev = f.severity === "error" ? "fail" : "warning";
    return "<li>" + icon(sev, "icon st-" + sev) + '<span><a href="' + R.rule(f.pack, f.rule) + '">' + esc(r ? r.title : f.rule) + '</a> <span class="small fg2">' + esc(f.text || f.message) + "</span></span></li>";
  }).join("") + "</ul>";
}
function patchesList(ix, kind, id) {
  var ps = ix.patchesAt.get(kind + ":" + id) || [];
  if (!ps.length) return "";
  return '<ul class="rows">' + ps.map(function (pid) {
    var p = ix.patch.get(pid) || {};
    return '<li><a href="' + R.patch(pid) + '"><span class="id">' + esc(pid) + "</span> " + esc(p.title || pid) + '</a> <span class="tag">' + esc(cap1(p.status || "")) + "</span></li>";
  }).join("") + "</ul>";
}

// ---------- teams and roles ----------
/** A unit's owner and verifier teams (bundle.teams, inherited from its parts), else its own owner field. */
function unitRolesOf(ix, id) {
  var t = ix.b && ix.b.teams && ix.b.teams.units && ix.b.teams.units[id];
  if (t) return t;
  var u = ix.unit.get(id) || {};
  return { owners: u.owner ? [u.owner] : [], ownerSource: u.owner ? "declared" : "none", verifiers: u.verifier ? [u.verifier] : [], verifierSource: u.verifier ? "declared" : "none" };
}
function teamName(ix, id) { var t = ix.team.get(id); return t ? t.name : id; }
// ---------- named leads: who runs a team, owns a milestone, drives a unit ----------
// A missing lead is never a finding; where a lead would show, the page says "No lead named".
var NO_LEAD = "No lead named";
/** A unit's lead as the bundle computed it (src/core/teams.ts unitLeads): { lead, source: set | team | none, team, of }. */
function unitLeadOf(ix, id) {
  var l = ix.b && ix.b.leads && ix.b.leads.units && ix.b.leads.units[id];
  if (l) return l;
  var u = ix.unit.get(id) || {};
  if (u.lead) return { lead: u.lead, source: "set" };
  var o = unitRolesOf(ix, id).owners, t = o.length ? ix.team.get(o[0]) : null;
  return t && t.lead ? { lead: t.lead, source: "team", team: o[0], of: o.length > 1 ? o.length : undefined } : { source: "none" };
}
/** Where a unit's lead comes from, in words: set on the unit, or inherited from its owner team (the first of several). "" when none. */
function unitLeadFrom(ix, l) {
  if (!l || l.source === "none") return "";
  if (l.source === "set") return "set on this unit";
  return "inherited from " + teamName(ix, l.team) + (l.of > 1 ? ", the first of its " + l.of + " owner teams" : ", its owner team");
}
/** A unit's lead as HTML: the lead and a muted mark saying set or inherited, or "No lead named". */
function unitLeadHtml(ix, id) {
  var l = unitLeadOf(ix, id);
  if (!l.lead) return '<span class="novalue" data-lead="none">' + NO_LEAD + "</span>";
  return '<span data-lead="' + esc(l.source) + '">' + esc(cap1(l.lead)) + ' <span class="muted small">(' + esc(unitLeadFrom(ix, l)) + ")</span></span>";
}
/** A team's or a milestone's own lead as HTML, or "No lead named". */
function leadHtml(lead) { return lead ? '<span data-lead="set">' + esc(cap1(lead)) + "</span>" : '<span class="novalue" data-lead="none">' + NO_LEAD + "</span>"; }
/** Whom to ask about a unit, in words: up to two owner teams by name, "no clear owner (3 teams)" past two, or "needs an owner". */
function ownerWords(ix, id) {
  var o = unitRolesOf(ix, id).owners;
  return o.length && o.length <= 2 ? o.map(function (t) { return teamName(ix, t); }).join(", ") : o.length > 2 ? "no clear owner (" + o.length + " teams)" : "needs an owner";
}
/** What a blocked unit waits on, in words: the first open unit it depends on and its owner, and how many more. */
function waitsOnWords(ix, id) {
  var g = waitsOnGrouped(ix, id); if (g) return g;
  var a = ix.analysis || (ix.b && ix.b.analysis) || {};
  var deps = arr(a.deps && a.deps[id]).filter(function (d) { var x = ix.unit.get(d); return x && x.status !== "done"; });
  var mi = arr(a.blocked && a.blocked[id] && a.blocked[id].missing), ac = mi.map(function (c) { return acrossOf(ix, c); }).filter(Boolean)[0];
  if (!deps.length) return mi.length ? (ac ? esc("waits on " + ac) : "waits on something no unit provides") : "";
  var d = ix.unit.get(deps[0]);
  return 'waits on <a href="' + R.unit(d.id) + '" data-unit="' + esc(d.id) + '">' + esc(d.title) + "</a> (" + esc(ownerWords(ix, d.id)) + ")" + (deps.length > 1 ? " and " + esc(PROSE.count(deps.length - 1, "more unit")) : "");
}
/** A piece of work as a decision row: its title, then owner team, milestone and state; the id is the tooltip. */
function workRow(ix, id, o) {
  o = o || {};
  var u = ix.unit.get(id);
  if (!u) return '<li><span class="muted" title="' + esc(id) + '">A unit no longer in the plan</span></li>';
  var s = unitState(ix, u), owners = unitRolesOf(ix, id).owners;
  var who = owners.length && owners.length <= 2 ? owners.map(function (t) { return '<a href="#teams" data-team-open="' + esc(t) + '">' + esc(teamName(ix, t)) + "</a>"; }).join(", ") : owners.length ? '<span class="warn-text" title="' + esc(owners.map(function (t) { return teamName(ix, t); }).join(", ")) + '">no clear owner (' + owners.length + " teams)</span>" : '<span class="warn-text">needs an owner</span>';
  var waits = s === "blocked" || s === "noprov" ? waitsOnWords(ix, id) : "";
  return '<li class="work-row">' + statusHtml(s, UNIT_WORD[s], "sm") + ' <a href="' + R.unit(id) + '" data-unit="' + esc(id) + '" title="' + esc(id) + '">' + esc(u.title) + "</a>"
    + '<span class="xs fg2 work-meta">' + who + (o.milestone === false ? "" : " · " + esc(milestoneLabel(ix, u.phase))) + (waits ? " · " + waits : "") + "</span></li>";
}
/** One role line for a unit: who, and where it comes from (the parts, an override, the unit itself), or nobody. */
function roleLine(ix, u, role) {
  var r = unitRolesOf(ix, u.id), teams = role === "owner" ? r.owners : r.verifiers, from = role === "owner" ? r.ownerSource : r.verifierSource;
  var label = role === "owner" ? "Owner team" : "Verified by";
  if (!teams.length) return "<dt>" + label + "</dt><dd>" + (role === "owner" ? '<a class="tag warning" href="' + R.rule("teams", "unit-has-owner") + '">' + icon("warning", "icon icon-sm") + "No owner team</a>" : '<span class="muted">None named</span>') + "</dd>";
  var parts = arr(u.elements).map(function (m) { var e = ix.el.get(m && m.id); return e ? (role === "owner" ? e.owner : e.verifier) : null; }).filter(Boolean);
  var why = from === "parts" ? "from the parts it changes" : from === "override" ? "an override: its parts say " + PROSE.list(parts.filter(function (x, i) { return parts.indexOf(x) === i; }).map(function (x) { return teamName(ix, x); })) : from === "declared" ? "named on the unit, which changes no part with one" : "";
  return "<dt>" + label + "</dt><dd>" + esc(PROSE.list(teams.map(function (x) { return teamName(ix, x); }))) + (why ? ' <span class="muted small">(' + esc(why) + ")</span>" : "") + "</dd>";
}

// ---------- unit detail ----------
function unitDetail(ix, id, opts) {
  opts = opts || {};
  var u = ix.unit.get(id);
  if (!u) return '<p class="empty">No unit with id <code>' + esc(id) + "</code> in this plan.</p>";
  var a = ix.analysis || {}, s = unitState(ix, u);
  var roles = unitRolesOf(ix, id);
  var h = [];
  h.push('<div class="insp-head">' + (opts.close ? '<a class="btn quiet insp-close" href="' + opts.close + '" aria-label="Close the unit detail">' + icon("close") + "</a>" : "")
    + '<span class="kind">' + icon("k-unit", "icon icon-sm") + " Unit " + idCopy(id) + "</span><h2 tabindex=\"-1\">" + esc(u.title) + '</h2><div class="tags"><span class="tag">' + esc(cap1(u.kind)) + "</span>"
    + (ix.critical.has(id) ? '<span class="tag accent">On the critical path</span>' : "") + followBtn("unit", id) + "</div></div>");
  h.push(cardHtml(ix, "unit", id, "page"));
  h.push(sec("Teams", null, '<dl class="facts">' + roleLine(ix, u, "owner") + roleLine(ix, u, "verifier") + '<dt>Lead</dt><dd data-unit-lead="' + esc(id) + '">' + unitLeadHtml(ix, id) + "</dd></dl>"));

  if (s === "blocked" || s === "noprov") {
    // one row per capability it still needs, its provider or providers (alternatives said so); met ones collapsed
    var unmet = blockerGroups(ix, id).filter(function (g) { return !g.met; }).length;
    h.push(sec("Blocked by", unmet, blockersHtml(ix, id) || '<p class="small">It waits on unfinished units.</p>'));
  }

  var f = unblockFacts(ix, id);
  if (f.direct.length) {
    var line = u.status === "done" ? "Units that depended on this one:" : f.readies.length
      ? "Finishing this readies " + plural(f.readies.length, "unit") + (f.total > f.readies.length ? " and moves " + (f.total - f.readies.length) + " more closer" : "") + "."
      : f.total === 1 ? "Finishing this moves 1 unit closer; it waits on other units too." : "Finishing this moves " + plural(f.total, "unit") + " closer; each of them waits on other units too.";
    // grouped by the capability this unit provides, with the other units that provide it too
    h.push(sec("Blocking", f.direct.length, '<p class="small fg2" style="margin-bottom:4px">' + esc(line) + "</p>" + mirrorHtml(ix, id, { readies: f.readies })));
  }
  // the downstream delay risk: the number the can-start row shows, grouped by milestone, and a Follow to list them
  var down = u.status === "done" ? [] : downstreamOf(ix, id);
  if (down.length) {
    var byMs = [];
    down.forEach(function (d) { var ph = (ix.unit.get(d) || {}).phase, g = byMs.filter(function (x) { return x.phase === ph; })[0]; if (!g) byMs.push(g = { phase: ph, units: [] }); g.units.push(d); });
    var trail = "#plan/units?trail=" + trailString([{ kind: "unit", id: id, f: {} }, { link: "downstream", f: {} }]);
    h.push(sec("Downstream delay risk", down.length, '<p class="small fg2" style="margin-bottom:4px">' + esc(PROSE.sentence("Finishing this moves " + PROSE.count(down.length, "open unit") + " closer, directly or through others, in " + PROSE.count(byMs.length, "milestone"))) + ' <a href="' + esc(trail) + '">List them on the Plan</a></p>'
      + byMs.map(function (g) { return '<details class="disc slice-g"><summary>' + esc(ix.phase.has(g.phase) ? milestoneLabel(ix, g.phase) : "No milestone") + ' <span class="count">' + g.units.length + '</span></summary><div class="body"><ul class="rows work-rows">' + g.units.map(function (d) { return workRow(ix, d, { milestone: false }); }).join("") + "</ul></div></details>"; }).join("")));
  }
  h.push(restsOnSection(ix, "unit", id));
  var moves = arr(u.elements).filter(Boolean);
  if (moves.length) h.push(sec("What it changes", moves.length, '<ul class="rows">' + moves.map(function (mv) { return "<li>" + elLink(ix, mv.id) + " " + ladderHtml(ix, mv.from, mv.to) + "</li>"; }).join("") + "</ul>"));
  // the capability keys are mechanics: inside an "Under the hood" disclosure, never on the decision surface
  if (arr(u.requires).length || arr(u.provides).length) h.push('<details class="how"><summary>Under the hood: capabilities it needs and provides</summary>'
    + (arr(u.requires).length ? '<p class="small fg2" style="margin:6px 0 2px">Needs</p><div class="chips">' + u.requires.map(function (c) { return capChip(ix, c); }).join("") + "</div>" : "")
    + (arr(u.provides).length ? '<p class="small fg2" style="margin:6px 0 2px">Provides</p><div class="chips">' + u.provides.map(function (c) { return capChip(ix, c); }).join("") + "</div>" : "") + "</details>");
  h.push(trackerHtml(ix, id, u.status || "todo"));
  if (u.feedback) h.push(sec("Feedback speed", null, '<p class="small">' + esc({ minutes: "Minutes", "next-run": "The next run", "several-runs": "Several runs", weeks: "Weeks" }[u.feedback] || u.feedback) + "</p>"));
  var fl = findingsList(ix, "unit", id); if (fl) h.push(sec("Problems the checks found", (ix.findingsAt.get("unit:" + id) || []).length, fl));
  var pl = patchesList(ix, "unit", id); if (pl) h.push(sec("Changes that touch it", (ix.patchesAt.get("unit:" + id) || []).length, pl));
  h.push(notesBlock(ix, [{ kind: "unit", id: id }], { edit: ix.edit }));
  return h.join("");
}

// ---------- tracker state beside a unit (it never overwrites the unit) ----------
function trackerHtml(ix, id, own) {
  var t = ix.b && ix.b.tracker, r = t && t.reconcile;
  if (!r) return "";
  var s = r.state && r.state[id];
  var prov = '<p class="provenance-note">From ' + esc(t.adapter === "jira" ? "Jira" : t.adapter) + (t.latestUpdate ? ", issues as of " + esc(humanTime(t.latestUpdate)) : "") + ". Shown beside the unit, never copied into the plan.</p>";
  var prop = arr(r.proposed).filter(function (p) { return p && p.unit === id; })[0];
  if (!s) {
    if (prop) return sec("Tracker", null, '<p class="small">Likely <span class="id">' + esc(prop.issue) + "</span> (score " + esc(prop.score) + ": " + esc(arr(prop.reasons).join(", ")) + '). <a href="' + R.tracker("match") + '">Confirm it</a> in tracker/links.yaml to show its state.</p>' + prov);
    return sec("Tracker", null, '<p class="empty">No issue yet. <a href="' + R.tracker("match") + '">Plan execution work not in the tracker</a></p>');
  }
  var dis = arr(r.statusDisagreements).filter(function (d) { return d && d.unit === id; })[0];
  var ph = arr(r.phaseDisagreements).filter(function (d) { return d && d.unit === id; })[0];
  var od = arr(r.ownerDisagreements).filter(function (d) { return d && d.unit === id; })[0];
  var deps = arr(r.dependencyOneSided).filter(function (d) { return d && d.unit === id; });
  var W = { todo: "To do", doing: "In progress", done: "Done" };
  return sec("Tracker", null, '<dl class="facts"><dt>Issue</dt><dd><span class="id" style="color:var(--fg)">' + esc(s.issue) + "</span> " + esc(s.summary) + ' <span class="muted">(' + (s.how === "label" ? "by label" : "confirmed") + ")</span></dd>"
    + "<dt>Status</dt><dd>" + esc(s.status) + ' <span class="muted">(' + esc(W[s.mapped] || s.mapped) + ")</span></dd>"
    + (s.assignee ? "<dt>Assignee</dt><dd>" + esc(s.assignee) + "</dd>" : "")
    + (s.sprint ? "<dt>Sprint</dt><dd>" + esc(s.sprint) + "</dd>" : "")
    + (s.parent ? "<dt>Parent</dt><dd><span class=\"id\">" + esc(s.parent) + "</span></dd>" : "") + "</dl>"
    + (dis ? '<div class="callout warning" style="margin-top:8px">' + icon("warning") + "<div><b>Disagrees.</b> The plan says " + esc(W[own] || own) + "; the tracker says " + esc(s.status) + ". A person settles it on one side: <a href=\"" + R.tracker("match") + "\">why it appears and how to settle it</a>.</div></div>" : "")
    + (ph ? '<div class="callout warning" style="margin-top:8px">' + icon("warning") + "<div>The issue sits under another milestone's container.</div></div>" : "")
    + (od ? '<div class="callout warning" style="margin-top:8px">' + icon("warning") + "<div><b>Owner disagrees.</b> " + esc(PROSE.sentence("The model gives this unit to " + PROSE.list(arr(od.owners).map(function (x) { return teamName(ix, x); })) + "; the tracker assigns the issue to " + teamName(ix, od.trackerTeam))) + "</div></div>" : "")
    + (deps.length ? '<ul class="rows" style="margin-top:6px">' + deps.map(function (d) { return '<li><span class="tag warning">Only in the ' + (d.side === "model" ? "plan" : "tracker") + "</span> depends on " + unitLink(ix, d.dependsOn) + "</li>"; }).join("") + "</ul>" : "")
    + prov);
}

// the team or teams whose decision a part records (attrs.decider: one team id or a list)
function deciders(e) { var d = e.attrs && e.attrs.decider; return Array.isArray(d) ? d : d ? [d] : []; }

// ---------- current state (0.4) ----------
// A part's record in current.yaml: where it stands today, what happens to it, and who says so. A discovered record
// (no person has confirmed it) shows wherever the part shows, marked as discovered, never as settled.
function currentOf(ix, id) { return ix.current ? ix.current.get(id) : undefined; }
var DISPOSITION_WORD = { "new": "New: it does not exist yet", retain: "Retain: it stays as it is", transition: "Transition: it exists, and changes to meet the target", retire: "Retire: it goes away" };
/** The record's provenance sentence with its state's icon: amber for discovered (never green), a tick once a person confirmed it. The sentence says which in words. */
function currentStateHtml(c) { var ok = c.state === "confirmed"; return '<span class="cur-state" data-state="' + esc(c.state) + '">' + icon(ok ? "pass" : "warning", "icon icon-sm st-" + (ok ? "pass" : "warning")) + " " + esc(c.text) + "</span>"; }
/** What happens to the part, in words, with its replacement linked. */
function dispositionHtml(ix, c) {
  if (!c.disposition) return '<span class="novalue">Undecided: needs a disposition</span>';
  if (c.disposition === "replace") return esc("Replace: ") + (c.replaced_by ? elLink(ix, c.replaced_by) + esc(" takes over") : esc("nothing it names takes over"));
  return esc(DISPOSITION_WORD[c.disposition] || c.disposition);
}
/** A milestone named by its name, in this design or in another one ("<ns>:<id>", named with its design). */
function milestoneWords(ix, ref) {
  if (ix.phase.has(ref)) return PROSE.quote(milestoneLabel(ix, ref));
  var i = str(ref).indexOf(":"), ns = i > 0 ? ref.slice(0, i) : "";
  return ns ? "milestone " + ref.slice(i + 1) + " of " + (((ix.b.instance || {}).homes || {})[ns] || ns) : str(ref);
}
/** One line for a card: "exists only today, stands at built; to be replaced by “Reconciler”; discovered, not confirmed". */
function currentLine(ix, c) {
  var d = c.disposition === "replace" ? "to be replaced" + (c.replaced_by && ix.el.get(c.replaced_by) ? " by " + PROSE.quote(ix.el.get(c.replaced_by).name) : "") : { "new": "new", retain: "kept as it is", transition: "changes to meet the target", retire: "to be retired" }[c.disposition] || "";
  return cap1((c.todayOnly ? "exists only today, " : "") + "stands at " + c.baseline + "; " + (d || "disposition undecided") + "; " + (c.state === "confirmed" ? "confirmed" : "discovered, not confirmed"));
}
/** The part page's Today block: where the part stands today, what happens to it, how its retirement stands, and who says so. */
function todayHtml(ix, id) {
  var c = currentOf(ix, id);
  if (!c) return "";
  var rt = ix.retire ? ix.retire.get(id) : null, rows = [];
  if (c.todayOnly) rows.push(["Exists", esc("Only today: the target design has no part like it")]);
  rows.push(["Stands at", esc(c.baseline) + (c.baselineDefault ? ' <span class="muted small">(the ladder’s first level; the record does not say)</span>' : "")]);
  rows.push(["Disposition", dispositionHtml(ix, c)]);
  if (rt) {
    rows.push(["Retired by", arr(rt.by).length ? arr(rt.by).map(function (u) { return unitLink(ix, u); }).join(", ") + (rt.milestone ? esc(" in " + milestoneWords(ix, rt.milestone)) : "") : '<span class="novalue">No unit retires it yet</span>']);
    var q = rt.replacement;
    if (q) rows.push(["Replacement arrives", arr(q.units).length
      ? elLink(ix, q.part) + esc(" reaches " + (q.level || "its level") + " with ") + arr(q.units).slice(0, 2).map(function (u) { return unitLink(ix, u); }).join(", ") + (q.milestone ? esc(" in " + milestoneWords(ix, q.milestone) + (q.target ? ", target " + q.target : "")) : "")
      : '<span class="novalue">No unit in this build brings it to a level yet</span>']);
  }
  if (c.found && c.found.confidence) rows.push(["Confidence", esc(c.found.confidence)]);
  return sec("Today", null, '<p class="small" style="margin:0 0 8px">' + currentStateHtml(c) + "</p>"
    + '<dl class="facts">' + rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + r[1] + "</dd>"; }).join("") + "</dl>");
}

// ---------- element detail ----------
function elementDetail(ix, id, opts) {
  opts = opts || {};
  var e = ix.el.get(id);
  if (!e) return '<p class="empty">No element with id <code>' + esc(id) + "</code> in this model.</p>";
  var h = [];
  var outs = ix.out.get(id) || [], ins = ix.inn.get(id) || [];
  var views = ix.viewsByEl.get(id) || [];
  h.push('<div class="insp-head">' + (opts.close ? '<button type="button" class="btn quiet insp-close" data-insp-close aria-label="Clear the selection">' + icon("close") + "</button>" : "")
    + '<span class="kind">' + icon("k-element", "icon icon-sm") + " Part · " + idCopy(id) + "</span><h2 tabindex=\"-1\">" + esc(e.name || id) + '</h2><div class="tags">'
    + (e.system && ix.system.get(e.system) ? '<span class="tag">' + esc(ix.system.get(e.system).name) + "</span>" : "")
    + (e.todayOnly ? '<span class="tag">Today only</span>' : "")
    + (e.home ? '<span class="tag">Outside this design</span>' : e.owner ? "" : '<a class="tag warning" href="' + R.rule("generic", "element-has-owner") + '">' + icon("warning", "icon icon-sm") + "No owner team</a>")
    + (e.verifier ? '<span class="tag">Verified by ' + esc(teamName(ix, e.verifier)) + "</span>" : "")
    + (deciders(e).length ? '<span class="tag">Decided by: ' + esc(PROSE.list(deciders(e).map(function (x) { return teamName(ix, x); }))) + "</span>" : "")
    + followBtn("element", id) + "</div></div>");
  h.push(cardHtml(ix, "element", id, "page"));
  if (e.description) h.push('<p class="small fg2">' + esc(e.description) + "</p>");
  if (e.home) h.push('<p class="small" style="margin-top:4px">' + (homePage(ix, e) ? "Outside this design: it lives in " + homePage(ix, e) + "." : esc("Outside this design: it lives in " + homeOf(ix, e) + ".")) + "</p>");
  h.push('<div class="chipbar" style="margin-top:8px"><a class="btn" href="' + R.focus(id) + '" data-focus="' + esc(id) + '">Focus neighbourhood</a>'
    + (views.length ? '<span class="menu-wrap"><button type="button" class="btn" data-views-menu aria-expanded="false">Show in views (' + views.length + ')</button><span class="menu" hidden>' + views.map(function (v) {
      var vv = ix.view.get(v); return '<a class="list-row" style="grid-template-columns:1fr" href="' + R.view(v) + '" data-view-sel="' + esc(v) + '" data-el="' + esc(id) + '"><span class="t">' + esc(vv ? vv.title : v) + "</span></a>";
    }).join("") + "</span></span>" : '<span class="small muted">Not drawn in any curated view</span>') + "</div>");
  h.push(todayHtml(ix, id)); // current state (0.4): where it stands today and who says so

  var relGroup = function (list, dir) {
    var byKind = new Map();
    list.forEach(function (r) { push(byKind, r.kind || "link", r); });
    return Array.from(byKind.keys()).sort().map(function (k) {
      return '<li><span class="tag">' + esc(cap1(k)) + '</span><span class="sr-only">' + (dir === "out" ? " to" : " from") + '</span><span style="display:inline-flex;flex-wrap:wrap;gap:4px 10px;min-width:0">' + byKind.get(k).map(function (r) {
        var other = dir === "out" ? r.to : r.from;
        return "<span>" + elLink(ix, other) + (r.label ? ' <span class="muted small">' + esc(r.label) + "</span>" : "") + "</span>";
      }).join("") + "</span></li>";
    }).join("");
  };
  if (outs.length || ins.length) h.push(sec("Relationships", outs.length + ins.length,
    (outs.length ? '<h4 class="xs muted" style="margin:4px 0">Outgoing ' + outs.length + '</h4><ul class="rows">' + relGroup(outs, "out") + "</ul>" : "")
    + (ins.length ? '<h4 class="xs muted" style="margin:8px 0 4px">Incoming ' + ins.length + '</h4><ul class="rows">' + relGroup(ins, "in") + "</ul>" : "")));
  var produces = [], consumes = [];
  ix.contract.forEach(function (c, name) {
    if (arr(c.produced_by).indexOf(id) >= 0) produces.push(name);
    if (arr(c.consumed_by).indexOf(id) >= 0) consumes.push(name);
  });
  if (produces.length || consumes.length) h.push(sec("Contracts", produces.length + consumes.length, '<dl class="facts">'
    + (produces.length ? '<dt>Produces</dt><dd><span class="chips">' + produces.map(function (c) { return '<span class="chip"' + (plainRef(ix, c) !== c ? ' title="' + esc(c) + '"' : "") + ">" + esc(plainRef(ix, c)) + "</span>"; }).join("") + "</span></dd>" : "")
    + (consumes.length ? '<dt>Consumes</dt><dd><span class="chips">' + consumes.map(function (c) { return '<span class="chip"' + (plainRef(ix, c) !== c ? ' title="' + esc(c) + '"' : "") + ">" + esc(plainRef(ix, c)) + "</span>"; }).join("") + "</span></dd>" : "") + "</dl>"));
  h.push(restsOnSection(ix, "element", id));
  var flowRows = FLOWUI.partRows(ix.b, id);
  if (flowRows.length) h.push(sec("Flow", null, '<dl class="facts">' + flowRows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("") + "</dl>"));
  var us = ix.unitsByEl.get(id) || [];
  if (us.length) h.push(sec("Work that changes it", us.length, '<ul class="rows">' + us.map(function (x) { return "<li>" + unitLink(ix, x.unit) + " " + ladderHtml(ix, x.from, x.to) + "</li>"; }).join("") + "</ul>"));
  var fl = findingsList(ix, "element", id); if (fl) h.push(sec("Problems the checks found", (ix.findingsAt.get("element:" + id) || []).length, fl));
  var pl = patchesList(ix, "element", id); if (pl) h.push(sec("Changes that touch it", (ix.patchesAt.get("element:" + id) || []).length, pl));
  var issues = us.map(function (x) { return ix.issueOf.get(x.unit) ? { unit: x.unit, issue: ix.issueOf.get(x.unit) } : null; }).filter(Boolean);
  if (issues.length) h.push(sec("Tracker issues", issues.length, '<ul class="rows">' + issues.map(function (x) { return '<li><span class="id" style="color:var(--fg)">' + esc(x.issue) + "</span> via " + unitLink(ix, x.unit, false) + "</li>"; }).join("") + "</ul>"));
  var kids = ix.children.get(id) || [];
  if (e.parent || kids.length) h.push(sec("Structure", null, '<dl class="facts">' + (e.parent ? "<dt>Part of</dt><dd>" + elLink(ix, e.parent) + "</dd>" : "") + (kids.length ? "<dt>Contains</dt><dd>" + kids.map(function (k) { return elLink(ix, k); }).join(", ") + "</dd>" : "") + "</dl>"));
  // notes on the part, and on its relationships and contracts (those have no page of their own)
  var nt = [{ kind: "element", id: id, label: "This part" }];
  outs.concat(ins).forEach(function (r) { var o2 = ix.el.get(r.from === id ? r.to : r.from); nt.push({ kind: "relationship", id: r.id, label: (r.from === id ? "To " : "From ") + (o2 ? o2.name : (r.from === id ? r.to : r.from)) + (r.label ? ": " + r.label : "") }); });
  produces.concat(consumes).forEach(function (c) { if (!nt.some(function (t) { return t.kind === "contract" && t.id === c; })) nt.push({ kind: "contract", id: c, label: "Contract " + plainRef(ix, c) }); });
  h.push(notesBlock(ix, nt, { edit: ix.edit }));
  return h.join("");
}

/** The inspector with nothing selected: the view's description, the zones it holds and its parts by kind. */
function viewIntro(ix, viewId) {
  var v = ix.view.get(viewId);
  if (!v) return '<p class="empty">Select a part in the drawing to see its owner, relationships, contracts and the units that change it.</p>';
  var els = arr(v.elements).map(function (id) { return ix.el.get(id); }).filter(Boolean);
  var zones = new Map(), kinds = new Map();
  els.forEach(function (e) { zones.set(e.zone || "", (zones.get(e.zone || "") || 0) + 1); kinds.set(e.kind, (kinds.get(e.kind) || 0) + 1); });
  var fst = FLOWUI.stream(ix.b, viewId);
  return '<div class="insp-head"><span class="kind">View · ' + idCopy(viewId) + '</span><h2>' + esc(v.title) + "</h2></div>"
    + (v.description ? '<p class="small fg2">' + esc(v.description) + "</p>" : "")
    + (fst ? sec("Flow", null, '<p class="small">' + esc(FLOWUI.summary(ix.b, fst)) + '</p><p class="small muted">The numbers, the handoffs ranked by the wait behind them and what the tracker measured are under the drawing.</p>') : "")
    + sec("Zones", zones.size, '<ul class="rows">' + Array.from(zones.keys()).map(function (z) {
      var zz = ix.zone.get(z), t = zoneTint(ix, z || null);
      return '<li><i class="swatch ' + t.cls + '" aria-hidden="true"></i><span>' + esc(zz ? zz.name : "No zone") + '</span><span class="muted small num" style="margin-left:auto">' + zones.get(z) + "</span></li>";
    }).join("") + "</ul>")
    + sec("Parts by kind", els.length, '<ul class="rows">' + Array.from(kinds.keys()).sort().map(function (k) { return "<li><span>" + esc(k) + '</span><span class="muted small num" style="margin-left:auto">' + kinds.get(k) + "</span></li>"; }).join("") + "</ul>")
    + '<p class="small muted" style="margin-top:12px">Select a part to see its owner, relationships, contracts and the units that change it.</p>';
}

/** Providers and requirers of one capability. */
function capDetail(ix, c) {
  var prov = ix.providers.get(c) || [], req = ix.requirers.get(c) || [];
  return '<p style="margin-bottom:8px;overflow-wrap:anywhere">' + esc(capWords(c, ix)) + '</p><p><code>' + esc(c) + '</code></p>'
    + "<h4 class=\"xs muted\">Provided by</h4>" + (prov.length ? '<ul class="rows">' + prov.map(function (p) { return "<li>" + unitLink(ix, p) + "</li>"; }).join("") + "</ul>" : '<p class="st noprov sm">' + icon("noprov") + '<span class="w">No unit provides this</span></p>')
    + '<h4 class="xs muted" style="margin-top:8px">Required by</h4>' + (req.length ? '<ul class="rows">' + req.slice(0, 20).map(function (p) { return "<li>" + unitLink(ix, p) + "</li>"; }).join("") + "</ul>" + (req.length > 20 ? '<p class="small muted">and ' + (req.length - 20) + " more</p>" : "") : '<p class="small muted">Nothing requires it.</p>');
}

// ---------- routes ----------
function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
/** Parse a location hash into a route. Old fragments (#element-x, #unit-x, #view-x ...) still work. */
function parseRoute(h) {
  var raw = str(h).replace(/^#/, "");
  var q = {}, rq = {}, qi = raw.indexOf("?");
  if (qi >= 0) { raw.slice(qi + 1).split("&").forEach(function (kv) { var p = kv.split("="); if (p[0]) { q[dec(p[0])] = dec(p.slice(1).join("=")); rq[dec(p[0])] = p.slice(1).join("="); } }); raw = raw.slice(0, qi); }
  var seg = raw.split("/");
  var page = dec(seg[0] || "");
  var out = { page: "overview", q: q, raw: rq };
  var PAGES = ["overview", "model", "plan", "strategy", "teams", "checks", "changes", "tracker", "notes", "tour", "learn", "present"];
  if (!page) return out;
  if (PAGES.indexOf(page) >= 0) {
    out.page = page;
    if (page === "model") {
      if (seg[1] === "view" && seg[2] != null) { out.sub = "view"; out.id = dec(seg.slice(2).join("/")); }
      else if (seg[1] === "element" && seg[2] != null) { out.sub = "element"; out.id = dec(seg.slice(2).join("/")); }
      else if (seg[1] === "focus" && seg[2] != null) { out.sub = "focus"; out.id = dec(seg.slice(2).join("/")); out.depth = q.depth === "2" ? 2 : 1; }
      else if (seg[1] === "zone" && seg[2] != null) { out.sub = "zone"; out.id = dec(seg.slice(2).join("/")); }
      else if (seg[1] === "elements") out.sub = "elements";
      else if (seg[1] === "matrix") out.sub = "matrix";
    } else if (page === "overview") {
      if (seg[1]) out.sub = dec(seg[1]);
    } else if (page === "plan") {
      if (seg[1] === "unit" && seg[2] != null) { out.sub = "unit"; out.id = dec(seg.slice(2).join("/")); }
      else if ((seg[1] === "milestone" || seg[1] === "gate") && seg[2] != null) { out.sub = "milestone"; out.id = dec(seg.slice(2).join("/")); }
      else if (seg[1] === "units") out.sub = "units";
    } else if (page === "checks") {
      if (seg[1] === "rule" && seg[2] != null) { out.sub = "rule"; out.pack = dec(seg[2]); out.id = dec(seg.slice(3).join("/")); }
    } else if (page === "changes") {
      if (seg[1] != null && seg[1] !== "") { out.sub = "patch"; out.id = dec(seg.slice(1).join("/")); }
    } else if (page === "tracker") {
      if (["discover", "map", "match"].indexOf(seg[1]) >= 0) { out.sub = seg[1]; if (seg[1] === "match" && seg[2]) out.id = dec(seg[2]); }
    } else if (page === "strategy") {
      if (seg[1] === "claim" && seg[2] != null) { out.sub = "claim"; out.id = dec(seg.slice(2).join("/")); }
    } else if (page === "notes") {
      if (seg[1] != null && seg[1] !== "") { out.sub = "note"; out.id = dec(seg.slice(1).join("/")); }
    } else if (page === "present") {
      out.n = Math.max(1, parseInt(seg[1], 10) || 1);
    } else if (page === "tour" || page === "learn") {
      out.n = Math.max(1, Math.floor(num(seg[1], 1)));
    }
    return out;
  }
  var s = dec(raw);
  var legacy = [["unit-", "plan", "unit"], ["phase-", "plan", "milestone"], ["element-", "model", "element"], ["view-", "model", "view"],
    ["patch-", "changes", "patch"], ["rule-", "checks", "legacy-rule"], ["pack-", "checks", "pack"], ["tracker-", "tracker", "anchor"]];
  for (var i = 0; i < legacy.length; i++) {
    if (s.indexOf(legacy[i][0]) === 0) return { page: legacy[i][1], sub: legacy[i][2], id: s.slice(legacy[i][0].length), q: q, raw: rq };
  }
  return out;
}

/** Times in local human form ("21 Oct 2026, 11:30"); a bare date stays a date. */
function humanTime(iso) {
  var s = str(iso);
  if (!s) return "";
  var d = new Date(s.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  if (isNaN(d.getTime())) return s;
  var M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (/^\d{4}-\d\d-\d\d$/.test(s)) return Number(s.slice(8, 10)) + " " + M[Number(s.slice(5, 7)) - 1] + " " + s.slice(0, 4);
  return d.getDate() + " " + M[d.getMonth()] + " " + d.getFullYear() + ", " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

api.unitRolesOf = unitRolesOf; api.roleLine = roleLine; api.unitLeadOf = unitLeadOf; api.unitLeadHtml = unitLeadHtml; api.unitLeadFrom = unitLeadFrom; api.leadHtml = leadHtml; api.NO_LEAD = NO_LEAD;
api.downstreamOf = downstreamOf; api.workRow = workRow; api.ownerWords = ownerWords;
api.esc = esc; api.plainRef = plainRef; api.buildIndex = buildIndex; api.unitDetail = unitDetail; api.elementDetail = elementDetail; api.viewIntro = viewIntro;
api.todayHtml = todayHtml; api.currentLine = currentLine;
api.parseRoute = parseRoute; api.unitState = unitState; api.rankedFrontier = rankedFrontier; api.unblockFacts = unblockFacts;
api.ladderHtml = ladderHtml; api.capDetail = capDetail; api.humanTime = humanTime; api.R = R; api.fidelityOf = fidelityOf;
