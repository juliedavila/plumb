/* Plumb site client, part 3e: the Overview (Tier 1). Tiles over a work area: selecting a tile switches the
   area below to that tile's lists (#overview/<tile>, a level change, so it pushes history). The lists are compact
   bars about a kind of record; clicking a bar sets the matching filter chip AND goes to the page that lists that kind,
   at its list (units: the Plan's unit table; parts: the Model's element list; claims: Strategy; findings: the rule on
   Checks; patches: Changes; tracker rows: the Match group), where the list's heading says what it shows. Back returns
   here with the same tile open. Lists put what needs attention first, and an empty list says what to click. */

var TILE_KIND = { design: "finding", plan: "unit", system: "element", premises: "claim", changes: "patch", tracker: "unit", owners: "unit" };

/** The filters with one facet set to these values (others kept). */
function setFacet(F, key, vals) {
  var out = {};
  Object.keys(F || {}).forEach(function (k) { if (k !== key) out[k] = F[k]; });
  if (vals && vals.length) out[key] = vals;
  return out;
}

/**
 * A compact bar list. rows: { label (html), count, of?, facet?, value?, also? ({facet: values} set together), to? (the
 * hash it lands on), href? (a plain destination, no chip), tone?, extra? (html after the row) }. A row with a facet is a
 * link that sets that chip on the page listing the list's kind (opts.kind), or on its own to; the bar's length is
 * count / max.
 */
function barList(S, title, rows, empty, note, opts) {
  opts = opts || {};
  var max = rows.reduce(function (m, r) { return Math.max(m, r.count); }, 0) || 1;
  var total = rows.reduce(function (t, r) { return t + r.count; }, 0);
  var body = rows.length ? '<ul class="bar-rows">' + rows.map(function (r) {
    var w = Math.max(r.count ? 2 : 0, Math.round(100 * r.count / max));
    var inner = '<span class="bl">' + r.label + '</span><span class="bt" aria-hidden="true"><span class="bf' + (r.tone ? " " + r.tone : "") + '" style="width:' + w + '%"></span></span><span class="bn">' + PROSE.fmt(r.count) + (r.of != null ? '<span class="muted"> of ' + PROSE.fmt(r.of) + "</span>" : "") + "</span>";
    if (r.href) return '<li><a class="bar-row" href="' + esc(r.href) + '" data-raw data-bar-to="' + esc(r.href) + '"' + (r.title ? ' title="' + esc(r.title) + '"' : "") + ">" + inner + "</a>" + (r.extra || "") + "</li>";
    if (!r.facet) return '<li><span class="bar-row static">' + inner + "</span>" + (r.extra || "") + "</li>";
    var F = setFacet(S.st.f, r.facet, [r.value]);
    if (r.also) Object.keys(r.also).forEach(function (k) { F = setFacet(F, k, r.also[k]); });
    var kind = opts.kind || pageKind(S) || "element";
    var to = withState(r.to || kindHash(kind), { f: F, sel: S.st.sel });
    var what = describeSet(S.ix, kind, appliedFilters(S.ix, kind, F).applied);
    return '<li><a class="bar-row" href="' + esc(to) + '" data-raw data-bar="' + esc(r.facet + "=" + r.value) + '" data-bar-to="' + esc(to.split("?")[0]) + '" title="' + esc("List the " + what.charAt(0).toLowerCase() + what.slice(1)) + '">' + inner + "</a>" + (r.extra || "") + "</li>";
  }).join("") + "</ul>" : '<p class="empty">' + esc(empty) + "</p>";
  return '<section class="barlist"><h3>' + esc(title) + (rows.length ? ' <span class="count">' + PROSE.fmt(total) + "</span>" : "") + "</h3>" + (note ? '<p class="small fg2">' + esc(note) + "</p>" : "") + body + "</section>";
}

/** What an empty list should say: with filters, what to click; without, what the build holds. */
function emptyFor(S, kind, plain) {
  return S.st && (hasFilters(S.st.f)) ? filteredNote(S, kind, 0, recordsOf(S.ix, kind).length) : plain;
}

/** The ids of a kind the Overview counts: the filtered set, else every record. */
function counted(S, kind) { var m = matchFor(S, kind); return m ? Array.from(m) : recordsOf(S.ix, kind); }
/** The same, leaving out the facets a list is about, so its own bars stay visible to switch between (as the chip popover counts). */
function countedExcept(S, kind, keys) {
  var F = {}; Object.keys(S.st.f || {}).forEach(function (k) { if (keys.indexOf(k) < 0) F[k] = S.st.f[k]; });
  var m = matchingSet(S.ix, kind, F, S.trailEval && S.trailEval.kind === kind ? S.trailEval : null);
  return m ? Array.from(m) : recordsOf(S.ix, kind);
}
function unitsOf(S, ids) { return ids.map(function (id) { return S.ix.unit.get(id); }).filter(Boolean); }

/** The bar lists of one tile's work area. Pure but for S (state and index). */
function barsFor(S, key) {
  var ix = S.ix, h = [];
  if (key === "design") {
    var by = new Map();
    countedExcept(S, "finding", ["rule"]).forEach(function (k) { var f = ix.finding.get(k); if (!f) return; var r = f.pack + "/" + f.rule; var x = by.get(r) || { n: 0, err: false }; x.n++; x.err = x.err || f.severity === "error"; by.set(r, x); });
    var rows = Array.from(by.keys()).sort(function (a, b) { return (by.get(b).err - by.get(a).err) || by.get(b).n - by.get(a).n || natural(a, b); }).map(function (r) {
      var x = by.get(r), rule = ix.rules.get(r);
      var pr = r.split("/");
      return { label: icon(x.err ? "fail" : "warning", "icon icon-sm st-" + (x.err ? "fail" : "warning")) + " " + esc(rule ? rule.title : r), count: x.n, facet: "rule", value: r, to: R.rule(pr[0], pr.slice(1).join("/")), tone: x.err ? "fail" : "warning" };
    });
    h.push(barList(S, "Problems by check", rows, emptyFor(S, "finding", "No problems: every check passes."), "Select a bar to see that check's problems on Checks.", { kind: "finding" }));
  } else if (key === "plan" || key === "owners") {
    if (key === "plan") {
      var byGate = unitsOf(S, countedExcept(S, "unit", ["milestone"]));
      h.push(barList(S, "Open units by milestone", ix.phaseOrder.map(function (p) {
        var inG = byGate.filter(function (u) { return u.phase === p.id; });
        return { label: esc(milestoneLabel(ix, p.id)), count: inG.filter(function (u) { return u.status !== "done"; }).length, of: inG.length, facet: "milestone", value: p.id, also: { status: ["open"] } };
      }).filter(function (r) { return r.of > 0; }), emptyFor(S, "unit", "The plan has no units."), "Milestones in plan order; select one to list its open units on the Plan.", { kind: "unit" }));
      var ORDER = ["noprov", "blocked", "ready", "doing", "done"];
      var st = new Map(); unitsOf(S, countedExcept(S, "unit", ["status"])).forEach(function (u) { var s = unitState(ix, u); st.set(s, (st.get(s) || 0) + 1); });
      h.push(barList(S, "Units by status", ORDER.filter(function (s) { return st.get(s); }).map(function (s) {
        return { label: statusHtml(s, UNIT_WORD[s], "sm"), count: st.get(s), facet: "status", value: s, tone: s === "noprov" ? "fail" : s === "blocked" ? "warning" : "" };
      }), emptyFor(S, "unit", "The plan has no units."), "Select a status to list those units on the Plan, with what each waits on.", { kind: "unit" }));
    }
    if (ix.b.teams) {
      var openUn = unitsOf(S, countedExcept(S, "unit", ["milestone", "owner"])).filter(function (u) { return u.status !== "done"; });
      h.push(barList(S, "Open units with no owner team, by milestone", ix.phaseOrder.map(function (p) {
        var n = openUn.filter(function (u) { return u.phase === p.id && !unitRolesOf(ix, u.id).owners.length; }).length;
        return { label: esc(milestoneLabel(ix, p.id)), count: n, facet: "milestone", value: p.id, also: { owner: [NONE], status: ["open"] }, tone: "warning" };
      }).filter(function (r) { return r.count > 0; }), hasFilters(S.st.f) ? "No open unit that matches the filters lacks an owner team." : "Every open unit has an owner team.", "Select a milestone to list its unowned units on the Plan.", { kind: "unit" }));
      if (key === "owners") {
        var byT = new Map(); unitsOf(S, countedExcept(S, "unit", ["owner"])).filter(function (u) { return u.status !== "done"; }).forEach(function (u) { unitRolesOf(ix, u.id).owners.forEach(function (t) { byT.set(t, (byT.get(t) || 0) + 1); }); });
        var ts = Array.from(byT.keys()).sort(function (a, b) { return byT.get(b) - byT.get(a) || natural(teamName(ix, a), teamName(ix, b)); });
        h.push(barList(S, "Open units by owner team", ts.slice(0, 12).map(function (t) { return { label: esc(teamName(ix, t)), count: byT.get(t), facet: "owner", value: t, also: { status: ["open"] } }; }),
          emptyFor(S, "unit", "No open unit has an owner team yet."), ts.length > 12 ? PROSE.sentence("The 12 teams with the most open units; " + PROSE.count(ts.length - 12, "more team") + " own fewer") : "Select a team to list its open units on the Plan.", { kind: "unit" }));
      }
    }
  } else if (key === "system") {
    var parts = countedExcept(S, "element", ["zone"]);
    var inZ = new Map(), withF = new Map();
    parts.forEach(function (id) { var e = ix.el.get(id); if (!e) return; var z = e.zone && ix.zone.has(e.zone) ? e.zone : NONE; inZ.set(z, (inZ.get(z) || 0) + 1); if ((ix.findingsAt.get("element:" + id) || []).length) withF.set(z, (withF.get(z) || 0) + 1); });
    var zs = Array.from(inZ.keys()).sort(function (a, b) { return (withF.get(b) || 0) - (withF.get(a) || 0) || inZ.get(b) - inZ.get(a) || natural(a, b); });
    h.push(barList(S, ix.zone.size ? "Parts by zone" : "Parts by system", ix.zone.size ? zs.map(function (z) {
      var t = zoneTint(ix, z === NONE ? null : z), nf = withF.get(z) || 0;
      return { label: (nf ? '<span title="' + esc(PROSE.fmt(nf) + " with " + (nf === 1 ? "a finding" : "findings")) + '">' + icon("warning", "icon icon-sm st-warning") + '<span class="sr-only">' + esc(PROSE.fmt(nf) + " with " + (nf === 1 ? "a finding" : "findings")) + ", </span></span> " : "") + '<i class="swatch ' + t.cls + '" aria-hidden="true"></i> ' + esc(z === NONE ? "No zone" : ix.zone.get(z).name), count: inZ.get(z), facet: "zone", value: z,
        extra: ix.zoneScene.has(z) ? '<a class="bar-open" href="' + esc(carryState(S, R.zone(z))) + '" data-raw>Open</a>' : "" };
    }) : [], emptyFor(S, "element", "The model has no zones; the views rail has its curated views."), "Zones holding parts with findings first (marked). Select a bar to list its parts on the Model; Open shows the zone and what crosses its border.", { kind: "element" }));
    var partsO = countedExcept(S, "element", ["owner"]);
    var noOwner = partsO.filter(function (id) { var e = ix.el.get(id); return e && !e.owner; }).length;
    if (noOwner) h.push(barList(S, "Parts with no owner team", [{ label: esc("No owner team"), count: noOwner, of: partsO.length, facet: "owner", value: NONE, tone: "warning" }], "", "", { kind: "element" }));
  } else if (key === "premises") {
    var cs = counted(S, "claim").map(function (id) { return ix.claim.get(id); }).filter(Boolean);
    var g = new Map(); countedExcept(S, "claim", ["grade"]).map(function (id) { return ix.claim.get(id); }).filter(Boolean).forEach(function (c) { g.set(c.grade || "untested", (g.get(c.grade || "untested") || 0) + 1); });
    h.push(barList(S, "Claims by grade", ["untested", "judgment", "inference", "evidence"].filter(function (x) { return g.get(x); }).map(function (x) {
      return { label: gradeHtml(x), count: g.get(x), facet: "grade", value: x, tone: x === "untested" ? "warning" : "" };
    }), emptyFor(S, "claim", "This design declares no claims."), "Select a grade to list those claims on Strategy.", { kind: "claim" }));
    var lb = arr(ix.b.findings).filter(function (f) { return f.pack === "premises" && f.rule === "load-bearing-untested"; }).map(function (f) { return f.at; }).filter(function (id) { return cs.some(function (c) { return c.id === id; }); });
    lb.sort(function (a, b) { return claimWeight(ix, b) - claimWeight(ix, a) || natural(a, b); });
    h.push('<section class="barlist"><h3>Untested, and much rests on it <span class="count">' + PROSE.fmt(lb.length) + "</span></h3>" + (lb.length ? '<ul class="rows">' + lb.map(function (id) { return "<li>" + refChip(ix, "claim", id) + '<span class="muted small num" style="margin-left:auto">' + esc(PROSE.count(claimWeight(ix, id), "record")) + "</span></li>"; }).join("") + "</ul>" : '<p class="empty">' + esc(emptyFor(S, "claim", "No untested premise carries much of the design.")) + "</p>") + "</section>");
  } else if (key === "changes") {
    var ps = counted(S, "patch").map(function (id) { return ix.patch.get(id); }).filter(Boolean);
    var breaks = function (p) { return arr(p.impact && p.impact.findingsIntroduced).filter(function (f) { return f.severity === "error"; }).length; };
    var byS = new Map(); countedExcept(S, "patch", ["status"]).map(function (id) { return ix.patch.get(id); }).filter(Boolean).forEach(function (p) { byS.set(p.status, (byS.get(p.status) || 0) + 1); });
    h.push(barList(S, "Changes by status", ["proposed", "accepted", "rejected"].filter(function (x) { return byS.get(x); }).map(function (x) { return { label: esc(STATUS_WORD[x]), count: byS.get(x), facet: "status", value: x }; }), emptyFor(S, "patch", "No patches yet. A change to the model is a file in patches/."), "Select a status to list those patches on Changes.", { kind: "patch" }));
    ps.sort(function (a, b) { return (a.status === "proposed" ? 0 : 1) - (b.status === "proposed" ? 0 : 1) || breaks(b) - breaks(a) || natural(a.id, b.id); });
    if (ps.length) h.push('<section class="barlist"><h3>Changes, proposed and breaking first</h3><ul class="rows">' + ps.map(function (p) {
      var n = breaks(p);
      return "<li>" + refChip(ix, "patch", p.id, p.id + " " + p.title) + '<span style="margin-left:auto" class="small">' + verdictHtml(p) + ' <span class="tag">' + esc(STATUS_WORD[p.status] || p.status) + "</span></span></li>";
    }).join("") + "</ul></section>");
  } else if (key === "tracker") {
    var r = ix.b.tracker && ix.b.tracker.reconcile, c = (r && r.counts) || {};
    var rows2 = [["Status disagreements", c.statusDisagreements, "warning", "status"], ["Owner team disagreements", arr(r && r.ownerDisagreements).length, "warning", "owner"], ["Dependencies on one side only", c.dependencyOneSided, "warning", "deps"], ["Milestone disagreements", c.phaseDisagreements, "warning", "phase"], ["Likely matches to confirm", c.proposed, "", "proposed"], ["Plan execution work not in the tracker", c.unitsWithoutIssue, "", "no-issue"], ["Tracker issues not in the plan", c.issuesWithoutUnit, "", "no-unit"], ["Matched", c.linked, "", "linked"]]
      .filter(function (x) { return x[1]; }).map(function (x) { return { label: esc(x[0]), count: x[1], tone: x[2], href: R.tracker("match", x[3]), title: "Open " + x[0].toLowerCase() + " on the Tracker" }; });
    h.push(barList(S, "The plan against the tracker", rows2, "No tracker export yet.", "Disagreements first; each opens its group on the Tracker's Match step."));
  }
  return h.join("");
}

function overviewCtl(S) {
  var ix = S.ix;
  return {
    show: function (r) {
      var tiles = $$("#overview [data-tile]"), keys = tiles.map(function (t) { return t.getAttribute("data-tile"); });
      var key = keys.indexOf(r.sub) >= 0 ? r.sub : keys[0];
      S.overviewKind = TILE_KIND[key] || "element";
      tiles.forEach(function (t) { var on = t.getAttribute("data-tile") === key; t.setAttribute("aria-selected", on ? "true" : "false"); t.classList.toggle("on", on); });
      $$("#work [data-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== key; });
      var panel = document.querySelector('#work [data-panel="' + key + '"]');
      if (r.sub && panel && panel.getBoundingClientRect && panel.getBoundingClientRect().top > window.innerHeight - 160 && panel.scrollIntoView) panel.scrollIntoView({ block: "start", behavior: S.reduce ? "auto" : "smooth" });
      var host = document.querySelector('[data-bars="' + key + '"]');
      if (host) { host.innerHTML = barsFor(S, key); fillTimes(host); }
      if (key === "system") { landscape(S); var lsv = $("landscape") && $("landscape").querySelector("svg"); fadeDrawing(S, lsv); focusDrawing(S, lsv); }
      var wf = $("work-filter");
      if (wf) { var on = hasFilters(S.st.f); wf.hidden = !on; wf.textContent = on ? PROSE.sentence("The lists below count only what matches the filters; the tiles count the whole build") : ""; }
    }
  };
}
api.barsFor = barsFor; api.setFacet = setFacet;
