/* Plumb site client, part 3g: focus. A reader picks a team or a lead (a person: one lead string, wherever teams,
   milestones and units name it) in the header, and every page narrows to that focus or highlights it:
   - the Plan lists only the units they own or co-own, verify, decide or lead, and the open units waiting on those,
     each labelled with its relation; the road keeps only the milestones with their work, each with their share of its
     open path to green;
   - drawings keep their parts at full strength and dim the rest, keeping every line to or from their parts;
   - Checks, Changes and Notes list what touches their parts or units; the Tracker its disagreements on their units;
   - the Teams page opens with their card on top, through the owner filter's own section.
   A lead's focus is what the lead leads directly (units and milestones naming them) plus what they inherit through a
   team they lead, marked inherited. Focus is a reader's lens, not a link: it is kept in memory and, where the browser
   allows, in localStorage per page file; the hash never carries it. The tours and present mode set it aside.
   A design page built inside a portfolio (bundle.portfolio) shares the portfolio's key, and offers the portfolio's
   teams and leads beside its own, so a focus set on any page of the portfolio follows the reader here and back. The
   portfolio names a design's own team "<namespace>:<id>"; this page holds it bare.
   focusOptions and focusFacts are pure (the tests call them without a DOM). */

/** A team id as this page holds it: a portfolio's "<this namespace>:<id>" bare, anything else as it is. */
function focusTeamHere(ix, id) {
  var p = ix.b && ix.b.portfolio, pre = p && p.namespace ? p.namespace + ":" : "";
  return pre && str(id).indexOf(pre) === 0 ? str(id).slice(pre.length) : str(id);
}
/** A team id as the portfolio holds it: this page's own team "<namespace>:<id>", an org team as it is. */
function focusTeamThere(ix, id) {
  var p = ix.b && ix.b.portfolio;
  return p && p.namespace && str(id).indexOf(":") < 0 ? p.namespace + ":" + id : str(id);
}

/** A lead string as one person: trimmed, case and spacing ignored. */
function leadKey(s) { return str(s).replace(/\s+/g, " ").trim().toLowerCase(); }

/** Who can be focused on: every team, and every distinct lead named by a team, a milestone or a unit. */
function focusOptions(ix) {
  var teams = [];
  ix.team.forEach(function (t, id) { teams.push({ kind: "team", id: id, name: t.name || id }); });
  var leads = new Map();
  var add = function (l) { var k = leadKey(l); if (k && !leads.has(k)) leads.set(k, { kind: "lead", id: k, name: cap1(str(l).replace(/\s+/g, " ").trim()) }); };
  ix.team.forEach(function (t) { add(t.lead); });
  ix.phaseOrder.forEach(function (p) { add(p.lead); });
  ix.unit.forEach(function (u) { add(u.lead); });
  // inside a portfolio: its teams and leads too, so a focus set on another of its pages stays valid here
  var pf = ix.b && ix.b.portfolio && ix.b.portfolio.focus;
  if (pf) {
    arr(pf.teams).forEach(function (t) { var id = focusTeamHere(ix, t.id); if (!teams.some(function (x) { return x.id === id; })) teams.push({ kind: "team", id: id, name: t.name || id }); });
    arr(pf.leads).forEach(function (l) { if (l && l.id && !leads.has(l.id)) leads.set(l.id, { kind: "lead", id: l.id, name: l.name || l.id }); });
  }
  return { teams: teams, leads: Array.from(leads.values()).sort(function (a, b) { return natural(a.name, b.name); }) };
}
/** A focus is { kind: "team" | "lead", id }; it is valid when this build holds it. */
function focusValid(ix, f) {
  if (!f || typeof f !== "object") return false;
  if (f.kind === "team") return ix.team.has(f.id) || (!!(ix.b && ix.b.portfolio) && focusOptions(ix).teams.some(function (t) { return t.id === f.id; }));
  if (f.kind === "lead") return focusOptions(ix).leads.some(function (l) { return l.id === f.id; });
  return false;
}
function focusName(ix, f) {
  if (!f) return "";
  if (f.kind === "team") { if (ix.team.has(f.id)) return teamName(ix, f.id); var t = focusOptions(ix).teams.filter(function (x) { return x.id === f.id; })[0]; return t ? t.name : f.id; }
  var l = focusOptions(ix).leads.filter(function (x) { return x.id === f.id; })[0];
  return l ? l.name : f.id;
}

var FOCUS_REL_ORDER = ["leads", "owns", "co-owns", "verifies", "decides"];
/**
 * What a focus covers. Relations are { rel, via }: rel is owns, co-owns, verifies, decides or leads; via names the team a
 * lead inherits it through (absent when direct).
 *   units     Map unit id -> relations (what they own or co-own, verify, decide or lead)
 *   waiting   Map unit id -> the related open units it waits on (open units waiting on their work, not related otherwise)
 *   parts     Map part id -> relations
 *   phases    Map milestone id -> { rels, units (their units in it), theirs, total (path-to-green steps that are theirs, of all) }
 *   findings, patches, notes, trackerUnits: Sets of what touches their parts or units
 *   teams     the teams in focus (the team, or the teams a lead leads)
 */
function focusFacts(ix, f) {
  var out = { kind: f && f.kind, id: f && f.id, name: focusName(ix, f), teams: [], units: new Map(), waiting: new Map(), parts: new Map(), phases: new Map(), findings: new Set(), patches: new Set(), notes: new Set(), trackerUnits: new Set() };
  if (!focusValid(ix, f)) return out;
  var add = function (map, id, rel, via) { var a = map.get(id); if (!a) { a = []; map.set(id, a); } if (!a.some(function (r) { return r.rel === rel && r.via === via; })) a.push({ rel: rel, via: via }); };
  var ownerTeams = function (e) { var o = (e.attrs && e.attrs.owner_teams) || []; return Array.isArray(o) ? o.map(String) : [String(o)]; };
  // a team's own relations: the parts it owns, co-owns, verifies or decides, and the units that take them
  var teamRels = function (T, via) {
    ix.el.forEach(function (e) {
      if (e.owner === T) add(out.parts, e.id, "owns", via);
      else if (ownerTeams(e).indexOf(T) >= 0) add(out.parts, e.id, "co-owns", via);
      if (e.verifier === T) add(out.parts, e.id, "verifies", via);
      if (deciders(e).indexOf(T) >= 0) add(out.parts, e.id, "decides", via);
    });
    ix.unit.forEach(function (u) {
      var r = unitRolesOf(ix, u.id), parts = arr(u.elements).map(function (m) { return ix.el.get(m && m.id); }).filter(Boolean);
      if (r.owners.indexOf(T) >= 0) add(out.units, u.id, r.owners.length > 1 ? "co-owns" : "owns", via);
      else if (parts.some(function (e) { return ownerTeams(e).indexOf(T) >= 0; })) add(out.units, u.id, "co-owns", via);
      if (r.verifiers.indexOf(T) >= 0) add(out.units, u.id, "verifies", via);
      if (parts.some(function (e) { return deciders(e).indexOf(T) >= 0; })) add(out.units, u.id, "decides", via);
    });
  };
  if (f.kind === "team") {
    out.teams = [f.id];
    teamRels(f.id);
    // the team's lead named on a unit of its own: that unit is theirs too
    var tl = leadKey((ix.team.get(f.id) || {}).lead);
    if (tl) ix.unit.forEach(function (u) { if (leadKey(u.lead) === tl) add(out.units, u.id, "leads"); });
  } else {
    ix.team.forEach(function (t, id) { if (leadKey(t.lead) === f.id) out.teams.push(id); });
    // what they lead directly: units and milestones naming them; then what they inherit through the teams they lead
    ix.unit.forEach(function (u) {
      var l = unitLeadOf(ix, u.id);
      if (l.source === "set" && leadKey(l.lead) === f.id) add(out.units, u.id, "leads");
      else if (l.source === "team" && out.teams.indexOf(l.team) >= 0) add(out.units, u.id, "leads", l.team);
    });
    out.units.forEach(function (rels, uid) {
      if (!rels.some(function (r) { return r.rel === "leads" && !r.via; })) return;
      arr((ix.unit.get(uid) || {}).elements).forEach(function (m) { if (m && ix.el.has(m.id)) add(out.parts, m.id, "leads"); });
    });
    ix.phaseOrder.forEach(function (p) { if (leadKey(p.lead) === f.id) out.phases.set(p.id, { rels: [{ rel: "leads" }] }); });
    out.teams.forEach(function (T) { teamRels(T, T); });
  }
  out.units.forEach(function (rels) { rels.sort(function (a, b) { return (a.via ? 1 : 0) - (b.via ? 1 : 0) || FOCUS_REL_ORDER.indexOf(a.rel) - FOCUS_REL_ORDER.indexOf(b.rel); }); });
  out.parts.forEach(function (rels) { rels.sort(function (a, b) { return (a.via ? 1 : 0) - (b.via ? 1 : 0) || FOCUS_REL_ORDER.indexOf(a.rel) - FOCUS_REL_ORDER.indexOf(b.rel); }); });
  // open units waiting on their open work
  var deps = (ix.analysis && ix.analysis.deps) || {};
  var openTheirs = function (x) { var u = ix.unit.get(x); return out.units.has(x) && u && u.status !== "done"; };
  ix.unit.forEach(function (u) {
    if (out.units.has(u.id) || u.status === "done") return;
    var on = arr(deps[u.id]).filter(openTheirs);
    if (on.length) out.waiting.set(u.id, on);
  });
  // milestones with their work, and their share of each one's open path to green
  ix.phaseOrder.forEach(function (p) {
    var us = (ix.unitsOfPhase.get(p.id) || []).filter(function (x) { return out.units.has(x); });
    if (!us.length && !out.phases.has(p.id)) return;
    var m = msStatus(ix, p.id), path = m && !m.reached ? arr(m.path) : [];
    var theirs = path.filter(function (a) { return (a.work && a.work.kind === "unit" && out.units.has(a.work.id)) || arr(a.teams).some(function (t) { return out.teams.indexOf(t) >= 0; }); }).length;
    var cur = out.phases.get(p.id) || { rels: [] };
    cur.units = us; cur.theirs = theirs; cur.total = path.length;
    out.phases.set(p.id, cur);
  });
  // what touches their parts or units
  out.units.forEach(function (_r, id) { out.trackerUnits.add(id); });
  arr(ix.b.findings).forEach(function (fd) {
    if (!fd) return;
    var r = fd.atKind === "relationship" ? ix.rel.get(fd.at) : null;
    if ((fd.atKind === "element" && out.parts.has(fd.at)) || (fd.atKind === "unit" && out.units.has(fd.at)) || (fd.atKind === "team" && out.teams.indexOf(fd.at) >= 0) || (r && (out.parts.has(r.from) || out.parts.has(r.to)))) out.findings.add(findingKey(fd));
  });
  ix.patch.forEach(function (p, id) {
    var im = p.impact || {};
    if ((ix.patchEls.get(id) || []).some(function (e) { return out.parts.has(e); }) || arr(im.unitsAffected).some(function (u) { return out.units.has(u); })) out.patches.add(id);
  });
  ix.notes.forEach(function (n) {
    var t = n.target || {}, r = t.kind === "relationship" ? ix.rel.get(t.id) : null;
    if ((t.kind === "element" && out.parts.has(t.id)) || (t.kind === "unit" && out.units.has(t.id)) || (t.kind === "finding" && out.findings.has(t.id)) || (t.kind === "patch" && out.patches.has(t.id)) || (r && (out.parts.has(r.from) || out.parts.has(r.to)))) out.notes.add(n.id);
  });
  return out;
}

/** Relations in words, direct first: "owns, verifies", "leads; owns, inherited from Platform". */
function focusRelWords(ix, rels) {
  var direct = arr(rels).filter(function (r) { return !r.via; }).map(function (r) { return r.rel; });
  var by = new Map(); arr(rels).forEach(function (r) { if (r.via) push(by, r.via, r.rel); });
  var parts = direct.length ? [direct.join(", ")] : [];
  by.forEach(function (rs, t) { parts.push(rs.join(", ") + ", inherited from " + teamName(ix, t)); });
  return parts.join("; ");
}
/** A unit's relation to the focus in words, or "" when it has none: its relations, or "blocked by them". */
function focusUnitWords(ix, ff, id) {
  if (!ff) return "";
  if (ff.units.has(id)) return focusRelWords(ix, ff.units.get(id));
  if (ff.waiting.has(id)) return "blocked by them";
  return "";
}
/** A milestone's share for the focus in words: "2 of the 5 steps on its path to green are theirs". */
function focusShareWords(ff, phaseId) {
  var p = ff && ff.phases.get(phaseId);
  if (!p) return "";
  if (!p.total) return "Its path to green has no open steps.";
  return PROSE.sentence((p.theirs ? PROSE.fmt(p.theirs) : "None") + " of the " + PROSE.count(p.total, "step") + " on its open path to green " + (p.theirs === 1 ? "is" : "are") + " theirs");
}

// ---------- the page ----------
/** The facts of the focus that applies now: none in a tour or present mode. Cached per focus. */
function focusNow(S) {
  if (!S || !S.focus || (S.tour && S.tour.on) || S.page === "present") return null;
  var k = S.focus.kind + ":" + S.focus.id;
  if (S._ffKey !== k) { S._ff = focusFacts(S.ix, S.focus); S._ffKey = k; }
  return S._ff;
}
/** The ids of a kind the focus keeps (unit, element, finding, patch, note, phase, tracker), or null when no focus applies. */
function focusSet(S, kind) {
  var ff = focusNow(S); if (!ff) return null;
  var keys = function (m) { return new Set(Array.from(m.keys())); };
  if (kind === "unit") { var s = keys(ff.units); ff.waiting.forEach(function (_v, k) { s.add(k); }); return s; }
  if (kind === "element") return keys(ff.parts);
  if (kind === "phase") return keys(ff.phases);
  if (kind === "finding") return ff.findings;
  if (kind === "patch") return ff.patches;
  if (kind === "note") return ff.notes;
  if (kind === "tracker") return ff.trackerUnits;
  return null;
}
function focusKeeps(S, kind, id) { var s = focusSet(S, kind); return !s || s.has(id); }

/** Their parts at full strength, the rest dimmed; every line to or from their parts stays, and its other end dims less. */
function focusDrawing(S, svg) {
  if (!svg) return;
  var P = focusSet(S, "element");
  var nodes = $$(".node[data-id]", svg), lines = $$(".edge, .elabel", svg);
  if (!P) { svg.classList.remove("focused"); nodes.concat(lines).forEach(function (g) { g.classList.remove("fz-in", "fz-near", "fz-out"); }); return; }
  var inGroup = function (id) {
    var grp = arr(S.ix.b.summary && S.ix.b.summary.groups).filter(function (x) { return (x.id || NONE) === id || (id === "__none" && !x.id); })[0];
    return !!grp && arr(grp.elements).some(function (e) { return P.has(e); });
  };
  var isIn = function (g) { var id = g.getAttribute("data-id"); return g.hasAttribute("data-group") ? inGroup(id) : P.has(id); };
  var on = new Set(), near = new Set();
  nodes.forEach(function (g) { if (isIn(g)) on.add(g.getAttribute("data-id")); });
  lines.forEach(function (e) {
    var a = e.getAttribute("data-from"), b = e.getAttribute("data-to"), hit = on.has(a) || on.has(b);
    e.classList.toggle("fz-out", !hit); e.classList.toggle("fz-in", hit);
    if (hit) { near.add(a); near.add(b); }
  });
  nodes.forEach(function (g) {
    var id = g.getAttribute("data-id"), i = on.has(id), n = !i && near.has(id);
    g.classList.toggle("fz-in", i); g.classList.toggle("fz-near", n); g.classList.toggle("fz-out", !i && !n);
  });
  svg.classList.add("focused");
}

/** The relation label in a list row: added once, replaced on every apply, removed without a focus. */
function focusLabel(el, words) {
  if (!el) return;
  var cur = el.querySelector(":scope > .focus-rel");
  if (!words) { if (cur) cur.remove(); return; }
  if (!cur) { cur = document.createElement("span"); cur.className = "tag focus-rel"; el.appendChild(cur); }
  cur.textContent = words;
}

/** The Plan's milestones under a focus: the road keeps those with their work, each with their share; a panel says it. */
function focusMilestones(S) {
  var ff = focusNow(S);
  $$("#plan .road li").forEach(function (li) {
    var a = li.querySelector("a[data-gate]"); if (!a) return;
    var id = a.getAttribute("data-gate"), keep = !ff || ff.phases.has(id);
    li.hidden = !keep;
    var lab = li.querySelector(".lab"), cur = lab && lab.querySelector(".fz-share");
    if (ff && keep && lab) { if (!cur) { cur = document.createElement("span"); cur.className = "fz-share xs"; lab.appendChild(cur); } cur.textContent = focusShareWords(ff, id); }
    else if (cur) cur.remove();
  });
  $$("[data-gate-panel]").forEach(function (p) {
    var id = p.getAttribute("data-gate-panel"), cur = p.querySelector(".fz-share-line");
    if (!ff) { if (cur) cur.remove(); return; }
    if (!cur) { cur = document.createElement("p"); cur.className = "callout info small fz-share-line"; var h = p.querySelector(".section-head"); if (h) h.insertAdjacentElement("afterend", cur); else p.prepend(cur); }
    cur.textContent = ff.phases.has(id) ? PROSE.sentence(ff.name + ": " + PROSE.count(arr(ff.phases.get(id).units).length, "unit") + " of theirs here. " + focusShareWords(ff, id)) : PROSE.sentence("None of " + ff.name + "'s work is in this milestone");
  });
}

/** The Tracker under a focus: each group's rows on their units stay; the others are hidden, and an empty group says so. */
function focusTracker(S) {
  var T = focusSet(S, "tracker"), page = $("tracker"); if (!page) return;
  $$("[data-tr-step] ul.rows > li", page).forEach(function (li) {
    var us = $$("[data-unit]", li).map(function (a) { return a.getAttribute("data-unit"); });
    li.hidden = !!T && !!us.length && !us.some(function (u) { return T.has(u); });
  });
}

/** The header control and the chip: pick a team or a lead, clear it; remembered per browser where storage allows. */
function wireFocus(S, store) {
  var ix = S.ix, btn = $("focus-btn"); if (!btn) return;
  // inside a portfolio, the key every page of the portfolio shares; else this page file's own
  var pf = ix.b.portfolio;
  var key = pf && pf.focusKey ? pf.focusKey : "de-focus:" + location.pathname + ":" + ((ix.b.instance && ix.b.instance.name) || "");
  var here = function (f) { return f && f.kind === "team" ? { kind: "team", id: focusTeamHere(ix, f.id) } : f; };
  var there = function (f) { return f && f.kind === "team" ? { kind: "team", id: focusTeamThere(ix, f.id) } : f; };
  try { var saved = JSON.parse(store.get(key) || "null"); saved = here(saved); if (focusValid(ix, saved)) S.focus = { kind: saved.kind, id: saved.id }; } catch (e) { /* no saved focus */ }
  var opts = focusOptions(ix);
  if (!opts.teams.length && !opts.leads.length) return;
  btn.hidden = false;
  function label() {
    var lb = btn.querySelector(".lbl"), on = !!S.focus;
    if (lb) lb.textContent = on ? "Focus: " + focusName(ix, S.focus) : "Focus";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? "Focus: " + focusName(ix, S.focus) + " (" + (S.focus.kind === "team" ? "team" : "lead") + "). Change or clear it." : "Focus on a team or a lead");
  }
  S.setFocus = function (f) {
    S.focus = f && focusValid(ix, f) ? { kind: f.kind, id: f.id } : null;
    S._ffKey = null;
    try { if (S.focus) store.set(key, JSON.stringify(pf ? there(S.focus) : S.focus)); else localStorage.removeItem(key); } catch (e) { /* storage unavailable: the focus holds for this visit */ }
    label();
    if (S.reroute) S.reroute();
    S.announce(S.focus ? "Focused on " + focusName(ix, S.focus) + ". Each page shows their work." : "Focus cleared. Each page shows everything.");
  };
  function menu() {
    var item = function (o) { var on = S.focus && S.focus.kind === o.kind && S.focus.id === o.id; return '<li><button type="button" role="menuitemradio" aria-checked="' + (on ? "true" : "false") + '" data-focus-pick="' + esc(o.kind + ":" + o.id) + '"><span class="v">' + esc(o.name) + '</span><span class="n">' + (o.kind === "team" ? "Team" : "Lead") + "</span></button></li>"; };
    return '<p class="gpop-h">Focus each page on a team or a lead</p>'
      + (S.focus ? '<ul class="gpop-list" role="menu"><li><button type="button" role="menuitem" data-focus-clear><span class="v">Clear focus</span><span class="n"></span></button></li></ul>' : "")
      + (opts.teams.length ? '<p class="gpop-h">Teams</p><ul class="gpop-list" role="menu">' + opts.teams.map(item).join("") + "</ul>" : "")
      + (opts.leads.length ? '<p class="gpop-h">Leads</p><ul class="gpop-list" role="menu">' + opts.leads.map(item).join("") + "</ul>" : "");
  }
  btn.addEventListener("click", function (ev) { ev.stopPropagation(); if (gpop && gpop._trigger === btn) { closeGpop(); return; } openGpop(btn, menu(), "Focus"); btn.setAttribute("aria-expanded", "true"); });
  document.addEventListener("click", function (ev) {
    var p = ev.target.closest && ev.target.closest("[data-focus-pick]");
    if (p) { var v = p.getAttribute("data-focus-pick"), i = v.indexOf(":"); closeGpop(); S.setFocus({ kind: v.slice(0, i), id: v.slice(i + 1) }); return; }
    if (ev.target.closest && ev.target.closest("[data-focus-clear]")) { closeGpop(); S.setFocus(null); }
  });
  // the menu's buttons: Up and Down move between them, as in the theme menu
  document.addEventListener("keydown", function (ev) {
    if (!gpop || gpop._trigger !== btn || (ev.key !== "ArrowDown" && ev.key !== "ArrowUp")) return;
    var items = $$("button", gpop), i = items.indexOf(document.activeElement);
    ev.preventDefault(); items[(i + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  });
  label();
}

/** The chip under the header while a focus applies: who, and a way to clear it (the header's label hides on a phone). */
function focusChipHtml(S) {
  var ff = focusNow(S); if (!ff) return "";
  return '<span class="fchip-x focus-chip"><span class="fc">' + esc("Focus: " + ff.name) + '</span><button type="button" class="fx" data-focus-clear aria-label="' + esc("Clear the focus on " + ff.name) + '">' + icon("close", "icon icon-sm") + "</button></span>";
}

api.focusTeamHere = focusTeamHere; api.focusTeamThere = focusTeamThere;
api.focusOptions = focusOptions; api.focusFacts = focusFacts; api.focusRelWords = focusRelWords; api.focusUnitWords = focusUnitWords; api.focusShareWords = focusShareWords; api.focusValid = focusValid; api.leadKey = leadKey;
