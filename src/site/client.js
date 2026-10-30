/* Plumb site client. Plain browser JavaScript, no library, no network.
   The first part is pure (bundle in, HTML strings out) so tests can run it without a DOM;
   boot() wires it to the page. Every lookup is defensive: a malformed bundle degrades to
   placeholders instead of a blank page. */
var DE = (function () {
  "use strict";

  var TABS = ["overview", "plan", "model", "checks", "changes", "tracker"]; // tracker only when the bundle has one
  var STATUS = { todo: "To do", doing: "In progress", done: "Done" };

  function arr(x) { return Array.isArray(x) ? x : []; }
  function str(x) { return x == null ? "" : String(x); }
  function esc(v) {
    return str(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function natural(a, b) { return str(a).localeCompare(str(b), undefined, { numeric: true, sensitivity: "base" }); }
  function href(prefix, id) { return "#" + prefix + "-" + encodeURIComponent(str(id)); }
  function slug(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other"; }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d || 0); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function push(map, k, v) { var a = map.get(k); if (!a) { a = []; map.set(k, a); } if (a.indexOf(v) < 0) a.push(v); }

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
      tintIdx: { zone: new Map(), system: new Map(), owner: new Map() },
      frontier: new Set(arr(a.frontier)), critical: new Set(arr(a.critical_path)),
      ladder: arr(b.instance && b.instance.ladder).length ? b.instance.ladder : ["none", "stand-in", "existing-tool", "built"]
    };
    arr(m.elements).forEach(function (e) { if (e && e.id != null) ix.el.set(e.id, e); });
    arr(m.elements).forEach(function (e) { if (e && e.parent) push(ix.children, e.parent, e.id); });
    arr(m.relationships).forEach(function (r) {
      if (!r || r.id == null) return;
      ix.rel.set(r.id, r); push(ix.out, r.from, r); push(ix.inn, r.to, r);
    });
    arr(m.teams).forEach(function (t, i) { if (t) { ix.team.set(t.id, t); ix.tintIdx.owner.set(t.id, i); } });
    arr(m.zones).forEach(function (t, i) { if (t) { ix.zone.set(t.id, t); ix.tintIdx.zone.set(t.id, i); } });
    arr(m.systems).forEach(function (t, i) { if (t) { ix.system.set(t.id, t); ix.tintIdx.system.set(t.id, i); } });
    arr(m.contracts).forEach(function (c) { if (c && c.name != null) ix.contract.set(c.name, c); });
    arr(m.views).forEach(function (v) {
      if (!v || v.id == null) return;
      ix.view.set(v.id, v);
      arr(v.elements).forEach(function (e) { push(ix.viewsByEl, e, v.id); });
    });
    arr(b.layouts).forEach(function (l) { if (l && l.view != null) ix.layout.set(l.view, l); });
    arr(p.phases).forEach(function (ph) { if (ph) ix.phase.set(ph.id, ph); });
    arr(p.units).forEach(function (u) {
      if (!u || u.id == null || ix.unit.has(u.id)) return; // duplicate ids: the first wins, as in the analysis
      ix.unit.set(u.id, u);
      arr(u.provides).forEach(function (c) { push(ix.providers, c, u.id); });
      arr(u.requires).forEach(function (c) { push(ix.requirers, c, u.id); });
      arr(u.elements).forEach(function (mv) { if (mv) push(ix.unitsByEl, mv.id, { unit: u.id, from: mv.from, to: mv.to }); });
    });
    arr(b.findings).forEach(function (f) { if (f) push(ix.findingsAt, f.atKind + ":" + f.at, f); });
    arr(b.patches).forEach(function (pt) {
      if (!pt) return;
      ix.patch.set(pt.id, pt);
      var im = pt.impact || {};
      ["added", "removed", "modified", "cascade"].forEach(function (k) {
        arr(im[k]).forEach(function (r) { if (r) push(ix.patchesAt, r.kind + ":" + r.id, pt.id); });
      });
      arr(im.unitsAffected).forEach(function (u) { push(ix.patchesAt, "unit:" + u, pt.id); });
    });
    return ix;
  }

  // ---------- references ----------
  function unitLink(ix, id, withTitle) {
    var u = ix.unit.get(id);
    if (!u) return '<span class="ref-missing" title="Not in the plan">' + esc(id) + "</span>";
    var st = u.status || "todo";
    return '<a class="unit-link" href="' + href("unit", id) + '"><span class="dot ' + esc(st) + '" aria-hidden="true"></span><code>' + esc(id) + "</code>"
      + (withTitle === false ? "" : " <span>" + esc(u.title) + "</span>")
      + '<span class="sr-only"> (' + esc(STATUS[st] || st) + ")</span></a>";
  }
  function elLink(ix, id) {
    var e = ix.el.get(id);
    if (!e) return '<span class="ref-missing" title="Not in the model">' + esc(id) + "</span>";
    return '<a href="' + href("element", id) + '">' + esc(e.name || id) + "</a>";
  }
  function nameOf(map, id, fallback) {
    if (id == null || id === "") return '<span class="muted">' + esc(fallback || "None") + "</span>";
    var r = map.get(id);
    return r ? esc(r.name || id) : '<span class="ref-missing">' + esc(id) + "</span>";
  }
  function contractChip(ix, name) {
    var c = ix.contract.get(name);
    return '<span class="chip' + (c ? "" : " missing") + '"' + (c && c.description ? ' title="' + esc(c.description) + '"' : "") + ">" + esc(name) + "</span>";
  }
  function capChip(ix, cap) {
    return '<span class="chip' + (ix.providers.has(cap) ? "" : " missing") + '">' + esc(cap) + "</span>";
  }
  function ladderHtml(ix, from, to) {
    var L = ix.ladder, fi = L.indexOf(from), ti = L.indexOf(to);
    if (fi < 0 || ti < 0) return '<span class="ladder"><span class="from">' + esc(from) + '</span><span aria-hidden="true">→</span><span class="to">' + esc(to) + "</span></span>";
    var parts = L.map(function (lv, i) {
      var cls = i === fi ? "from" : i === ti ? "to" : (i > fi && i < ti) ? "between" : "";
      return "<span" + (cls ? ' class="' + cls + '"' : "") + ">" + esc(lv) + "</span>";
    });
    return '<span class="ladder" aria-label="from ' + esc(from) + " to " + esc(to) + '">' + parts.join("") + "</span>";
  }
  function findingsHtml(ix, kind, id) {
    var fs = ix.findingsAt.get(kind + ":" + id) || [];
    if (!fs.length) return "";
    return "<section><h4>Findings</h4><ul class=\"finding-list\">" + fs.map(function (f) {
      return '<li><span class="badge ' + (f.severity === "error" ? "error" : "warning") + '">' + (f.severity === "error" ? "Error" : "Warning")
        + "</span><span>" + esc(f.message) + '</span><span class="where"><a href="' + href("rule", f.pack + "-" + f.rule) + '">' + esc(f.pack) + "/" + esc(f.rule) + "</a></span></li>";
    }).join("") + "</ul></section>";
  }
  function patchesHtml(ix, kind, id) {
    var ps = ix.patchesAt.get(kind + ":" + id) || [];
    if (!ps.length) return "";
    return "<section><h4>Changed by</h4><ul class=\"rows\">" + ps.map(function (pid) {
      var p = ix.patch.get(pid) || {};
      return '<li><a href="' + href("patch", pid) + '">' + esc(p.title || pid) + '</a> <span class="badge ' + esc(p.status) + '">' + esc(p.status || "") + "</span></li>";
    }).join("") + "</ul></section>";
  }
  function badgeCounts(ix, kind, id) {
    var fs = ix.findingsAt.get(kind + ":" + id) || [];
    var e = fs.filter(function (f) { return f.severity === "error"; }).length, w = fs.length - e;
    return (e ? '<span class="badge error">' + plural(e, "error") + "</span>" : "") + (w ? '<span class="badge warning">' + plural(w, "warning") + "</span>" : "");
  }

  // ---------- unit detail ----------
  function unitState(ix, u) {
    var st = u.status || "todo";
    if (st === "done") return { key: "done", label: "Done" };
    if (ix.frontier.has(u.id)) return { key: "ready", label: st === "doing" ? "In progress" : "Can start" };
    return { key: "blocked", label: "Blocked" };
  }
  function unitDetail(ix, id) {
    var u = ix.unit.get(id);
    if (!u) return '<p class="placeholder">No unit with id <code>' + esc(id) + "</code> in this plan.</p>";
    var a = ix.analysis || {}, st = u.status || "todo", state = unitState(ix, u);
    var deps = arr(a.deps && a.deps[id]), unblocks = arr(a.unblocks && a.unblocks[id]);
    var blocked = a.blocked && a.blocked[id];
    var owner = u.owner ? ix.team.get(u.owner) : null;
    var phase = ix.phase.get(u.phase);
    var h = [];
    h.push('<header><p class="eyebrow">Unit ' + esc(id) + " · " + esc(u.kind) + '</p><h2 class="detail-title">' + esc(u.title) + '</h2><div class="badges">'
      + '<span class="badge ' + esc(st) + '">' + esc(STATUS[st] || st) + "</span>"
      + '<span class="badge ' + state.key + '">' + state.label + "</span>"
      + (ix.critical.has(id) ? '<span class="badge">On the critical path</span>' : "") + badgeCounts(ix, "unit", id) + "</div></header>");
    h.push('<dl class="facts"><dt>Phase</dt><dd>' + (phase ? '<a href="' + href("phase", u.phase) + '">' + esc(phase.name) + "</a>" : '<span class="ref-missing">' + esc(u.phase) + "</span>") + "</dd>"
      + "<dt>Owner</dt><dd>" + (u.owner ? (owner ? esc(owner.name) : '<span class="ref-missing">' + esc(u.owner) + "</span>") : '<span class="muted">No owner</span>') + "</dd>"
      + (u.feedback ? "<dt>Feedback</dt><dd>" + esc(u.feedback) + "</dd>" : "") + "</dl>");
    h.push('<section><h4>Done when</h4><p class="done-when">' + esc(u.check || "No done-condition written.") + "</p></section>");
    h.push(trackerHtml(ix, id, st));

    if (state.key === "blocked") {
      var missing = arr(blocked && blocked.missing), waiting = arr(blocked && blocked.waitingOn);
      if (!blocked) {
        missing = arr(u.requires).filter(function (c) {
          return !(ix.providers.get(c) || []).some(function (pid) { var pu = ix.unit.get(pid); return pu && pu.status === "done"; });
        });
      }
      var items = missing.map(function (c) {
        var prov = (ix.providers.get(c) || []).filter(function (pid) { var pu = ix.unit.get(pid); return !pu || pu.status !== "done"; });
        return "<li>" + capChip(ix, c) + " " + (prov.length ? '<span class="sub">waiting on</span> ' + prov.map(function (pid) { return unitLink(ix, pid); }).join(", ")
          : '<span class="sub">no unit in the plan provides this</span>') + "</li>";
      });
      var others = waiting.filter(function (w) { return !missing.some(function (c) { return (ix.providers.get(c) || []).indexOf(w) >= 0; }); });
      h.push('<section><h4>Why it is blocked</h4><div class="why-blocked">' + (items.length
        ? "<p>" + plural(missing.length, "capability", "capabilities") + " not yet provided by a finished unit:</p><ul>" + items.join("") + "</ul>"
        : "<p>It waits on unfinished units.</p>")
        + (others.length ? '<p class="small" style="margin-top:6px">Also waiting on ' + others.map(function (w) { return unitLink(ix, w); }).join(", ") + "</p>" : "") + "</div></section>");
    }

    var req = arr(u.requires).map(function (c) {
      var prov = ix.providers.get(c) || [];
      return "<li>" + capChip(ix, c) + " " + (prov.length ? '<span class="sub">provided by</span> ' + prov.map(function (pid) { return unitLink(ix, pid); }).join(", ")
        : '<span class="badge error">No unit provides this</span>') + "</li>";
    });
    h.push("<section><h4>Requires</h4>" + (req.length ? '<ul class="rows">' + req.join("") + "</ul>" : '<p class="empty">Nothing. It can start whenever its owner is ready.</p>') + "</section>");
    var prov = arr(u.provides).map(function (c) {
      var by = (ix.requirers.get(c) || []).filter(function (r) { return r !== id; });
      return "<li>" + capChip(ix, c) + " " + (by.length ? '<span class="sub">needed by</span> ' + by.map(function (r) { return unitLink(ix, r); }).join(", ") : '<span class="sub">nothing in the plan needs this yet</span>') + "</li>";
    });
    h.push("<section><h4>Provides</h4>" + (prov.length ? '<ul class="rows">' + prov.join("") + "</ul>" : '<p class="empty">No capabilities.</p>') + "</section>");
    if (deps.length) h.push('<section><h4>Depends on</h4><ul class="rows">' + deps.map(function (d) { return "<li>" + unitLink(ix, d) + "</li>"; }).join("") + "</ul></section>");
    var unb = unblocks.map(function (d) {
      var du = ix.unit.get(d);
      var others = arr(a.deps && a.deps[d]).filter(function (x) { if (x === id) return false; var xu = ix.unit.get(x); return !xu || xu.status !== "done"; });
      var next = du && du.status !== "done" && !others.length;
      return "<li>" + unitLink(ix, d) + (next ? ' <span class="badge ready">Starts when this is done</span>' : others.length ? ' <span class="sub">also needs ' + others.map(function (x) { return esc(x); }).join(", ") + "</span>" : "") + "</li>";
    });
    h.push("<section><h4>Unblocks</h4>" + (unb.length ? '<ul class="rows">' + unb.join("") + "</ul>" : '<p class="empty">Nothing depends on it.</p>') + "</section>");
    var moves = arr(u.elements).map(function (mv) { return "<li>" + elLink(ix, mv && mv.id) + " " + ladderHtml(ix, mv && mv.from, mv && mv.to) + "</li>"; });
    if (moves.length) h.push('<section><h4>Upgrades</h4><ul class="rows">' + moves.join("") + "</ul></section>");
    h.push(findingsHtml(ix, "unit", id));
    h.push(patchesHtml(ix, "unit", id));
    return h.join("");
  }

  // ---------- tracker state (read-only beside the unit; it never overwrites the unit) ----------
  function trackerHtml(ix, id, own) {
    var t = ix.b && ix.b.tracker, r = t && t.reconcile;
    if (!r) return "";
    var s = r.state && r.state[id];
    var prop = arr(r.proposed).filter(function (p) { return p && p.unit === id; })[0];
    if (!s) {
      if (prop) return '<section><h4>Tracker</h4><p class="small">Likely ' + "<code>" + esc(prop.issue) + "</code> (score " + esc(prop.score) + ": " + esc(arr(prop.reasons).join(", ")) + '). <span class="muted">Confirm it in tracker/links.yaml to show its state.</span></p></section>';
      return '<section><h4>Tracker</h4><p class="empty">No issue. <a href="#tracker-no-issue">Units with no issue</a></p></section>';
    }
    var dis = arr(r.statusDisagreements).filter(function (d) { return d && d.unit === id; })[0];
    var ph = arr(r.phaseDisagreements).filter(function (d) { return d && d.unit === id; })[0];
    var deps = arr(r.dependencyOneSided).filter(function (d) { return d && d.unit === id; });
    return '<section><h4>Tracker</h4><dl class="facts"><dt>Issue</dt><dd><code>' + esc(s.issue) + "</code> " + esc(s.summary) + ' <span class="sub">(' + (s.how === "label" ? "by label" : "confirmed") + ")</span></dd>"
      + "<dt>Status</dt><dd>" + esc(s.status) + ' <span class="sub">(' + esc(STATUS[s.mapped] || s.mapped) + ")</span>"
      + (dis ? ' <span class="badge warning">Disagrees: the plan says ' + esc(STATUS[own] || own) + "</span>" : "") + "</dd>"
      + (s.assignee ? "<dt>Assignee</dt><dd>" + esc(s.assignee) + "</dd>" : "")
      + (s.sprint ? "<dt>Sprint</dt><dd>" + esc(s.sprint) + "</dd>" : "")
      + (s.team ? "<dt>Team</dt><dd>" + esc(ix.team.has(s.team) ? ix.team.get(s.team).name || s.team : s.team) + "</dd>" : "")
      + (s.parent ? "<dt>Parent</dt><dd><code>" + esc(s.parent) + "</code>" + (ph ? ' <span class="badge warning">Another phase\'s container</span>' : "") + "</dd>" : "")
      + "</dl>"
      + (deps.length ? '<ul class="rows" style="margin-top:6px">' + deps.map(function (d) { return '<li><span class="badge warning">Only in the ' + esc(d.side) + "</span> depends on " + unitLink(ix, d.dependsOn) + "</li>"; }).join("") + "</ul>" : "")
      + '<p class="small muted" style="margin-top:6px">Tracker state is shown, never copied into the plan.</p></section>';
  }

  // ---------- element detail ----------
  function relRow(ix, r, dir) {
    var other = dir === "out" ? r.to : r.from;
    return '<li><span class="badge">' + esc(r.kind) + '</span><span class="arrow" aria-hidden="true">' + (dir === "out" ? "→" : "←") + "</span>"
      + '<span class="sr-only">' + (dir === "out" ? "to" : "from") + " </span>" + elLink(ix, other)
      + (r.label ? ' <span class="sub">' + esc(r.label) + "</span>" : "")
      + (r.optional ? ' <span class="sub">(optional)</span>' : "")
      + (arr(r.carries).length ? ' <span class="chips">' + arr(r.carries).map(function (c) { return contractChip(ix, c); }).join("") + "</span>" : "") + "</li>";
  }
  function attrValue(v) {
    if (v == null) return "";
    if (typeof v === "object") { try { return JSON.stringify(v); } catch (e) { return String(v); } }
    return String(v);
  }
  function elementDetail(ix, id, currentView) {
    var e = ix.el.get(id);
    if (!e) return '<p class="placeholder">No element with id <code>' + esc(id) + "</code> in this model.</p>";
    var h = [];
    h.push('<header><p class="eyebrow">' + esc(e.kind) + " · " + esc(id) + '</p><h2 class="detail-title">' + esc(e.name || id) + "</h2>"
      + (badgeCounts(ix, "element", id) ? '<div class="badges">' + badgeCounts(ix, "element", id) + "</div>" : "") + "</header>");
    if (e.description) h.push("<p>" + esc(e.description) + "</p>");
    var kids = ix.children.get(id) || [];
    h.push('<dl class="facts"><dt>Owner</dt><dd>' + nameOf(ix.team, e.owner, "No owner team") + "</dd>"
      + "<dt>Zone</dt><dd>" + nameOf(ix.zone, e.zone) + "</dd><dt>System</dt><dd>" + nameOf(ix.system, e.system) + "</dd>"
      + (e.parent ? "<dt>Part of</dt><dd>" + elLink(ix, e.parent) + "</dd>" : "")
      + (kids.length ? "<dt>Contains</dt><dd>" + kids.map(function (k) { return elLink(ix, k); }).join(", ") + "</dd>" : "")
      + Object.keys(e.attrs && typeof e.attrs === "object" ? e.attrs : {}).map(function (k) { return "<dt><code>" + esc(k) + "</code></dt><dd>" + esc(attrValue(e.attrs[k])) + "</dd>"; }).join("")
      + "</dl>");
    var views = ix.viewsByEl.get(id) || [];
    h.push("<section><h4>Views</h4>" + (views.length ? '<ul class="rows">' + views.map(function (v) {
      var vv = ix.view.get(v);
      return "<li>" + (v === currentView ? "<span>" + esc(vv ? vv.title : v) + ' <span class="sub">(showing)</span></span>'
        : '<a href="' + href("view", v) + '" data-show-view="' + esc(v) + '" data-show-element="' + esc(id) + '">' + esc(vv ? vv.title : v) + "</a>") + "</li>";
    }).join("") + "</ul>" : '<p class="empty">Not drawn in any view.</p>') + "</section>");
    var outs = ix.out.get(id) || [], ins = ix.inn.get(id) || [];
    h.push("<section><h4>Outgoing (" + outs.length + ")</h4>" + (outs.length ? '<ul class="rows">' + outs.map(function (r) { return relRow(ix, r, "out"); }).join("") + "</ul>" : '<p class="empty">None</p>') + "</section>");
    h.push("<section><h4>Incoming (" + ins.length + ")</h4>" + (ins.length ? '<ul class="rows">' + ins.map(function (r) { return relRow(ix, r, "in"); }).join("") + "</ul>" : '<p class="empty">None</p>') + "</section>");
    var produces = [], consumes = [];
    ix.contract.forEach(function (c, name) {
      if (arr(c.produced_by).indexOf(id) >= 0) produces.push(name);
      if (arr(c.consumed_by).indexOf(id) >= 0) consumes.push(name);
    });
    if (produces.length || consumes.length) {
      h.push('<section><h4>Contracts</h4><dl class="facts">'
        + (produces.length ? '<dt>Produces</dt><dd><span class="chips">' + produces.map(function (c) { return contractChip(ix, c); }).join("") + "</span></dd>" : "")
        + (consumes.length ? '<dt>Consumes</dt><dd><span class="chips">' + consumes.map(function (c) { return contractChip(ix, c); }).join("") + "</span></dd>" : "")
        + "</dl></section>");
    }
    var us = ix.unitsByEl.get(id) || [];
    h.push("<section><h4>Units that touch it</h4>" + (us.length ? '<ul class="rows">' + us.map(function (x) {
      return "<li>" + unitLink(ix, x.unit) + " " + ladderHtml(ix, x.from, x.to) + "</li>";
    }).join("") + "</ul>" : '<p class="empty">No unit in the plan changes it.</p>') + "</section>");
    h.push(findingsHtml(ix, "element", id));
    h.push(patchesHtml(ix, "element", id));
    return h.join("");
  }

  // ---------- SVG ----------
  function wrapLabel(text, maxChars, maxLines) {
    var words = str(text).split(/\s+/).filter(Boolean), lines = [], cur = "";
    maxChars = Math.max(4, maxChars | 0); maxLines = Math.max(1, maxLines | 0);
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var next = cur ? cur + " " + w : w;
      if (next.length <= maxChars) { cur = next; continue; }
      if (cur) lines.push(cur);
      cur = w.length > maxChars ? w.slice(0, maxChars - 1) + "…" : w;
      if (lines.length === maxLines) break;
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    if (lines.length > maxLines) lines = lines.slice(0, maxLines);
    var used = lines.join(" ").replace(/…/g, "").length;
    if (used < str(text).replace(/\s+/g, " ").trim().length && lines.length) {
      var last = lines[lines.length - 1];
      if (last.slice(-1) !== "…") lines[lines.length - 1] = (last.length >= maxChars ? last.slice(0, maxChars - 1) : last) + "…";
    }
    return lines;
  }
  function tintOf(ix, e, by) {
    var key = by === "system" ? e.system : by === "owner" ? e.owner : e.zone;
    var i = key == null ? undefined : ix.tintIdx[by === "system" ? "system" : by === "owner" ? "owner" : "zone"].get(key);
    return i == null ? "none" : String(i % 8);
  }
  // Point halfway along a polyline, with the length and direction of the segment it falls on.
  function midpoint(pts) {
    var total = 0, i, segs = [];
    for (i = 1; i < pts.length; i++) {
      var d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      segs.push(d); total += d;
    }
    var half = total / 2;
    for (i = 1; i < pts.length; i++) {
      if (half <= segs[i - 1] || i === pts.length - 1) {
        var t = segs[i - 1] ? Math.min(1, half / segs[i - 1]) : 0;
        var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
        return { x: pts[i - 1][0] + dx * t, y: pts[i - 1][1] + dy * t, len: segs[i - 1], vertical: Math.abs(dy) > Math.abs(dx) };
      }
      half -= segs[i - 1];
    }
    return { x: pts[0][0], y: pts[0][1], len: 0, vertical: false };
  }
  function r1(n) { return Math.round(n * 10) / 10; }

  function viewSvg(ix, viewId, opts) {
    opts = opts || {};
    var L = ix.layout.get(viewId), v = ix.view.get(viewId);
    if (!L) return null;
    var by = opts.tint || "zone", nodes = [], edges = [], labels = [], kinds = new Map(), tints = new Map();
    arr(L.edges).forEach(function (ed) {
      if (!ed) return;
      var pts = arr(ed.points).filter(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]); });
      if (pts.length < 2) return;
      var r = ix.rel.get(ed.id), kind = r ? r.kind : "link";
      kinds.set(slug(kind), kind);
      var from = r ? r.from : ed.from, to = r ? r.to : ed.to;
      var fe = ix.el.get(from), te = ix.el.get(to);
      var tip = (fe ? fe.name : from) + " → " + (te ? te.name : to) + " · " + kind + (r && r.label ? " · " + r.label : "") + (r && arr(r.carries).length ? " · carries " + r.carries.join(", ") : "");
      var ps = pts.map(function (p) { return r1(p[0]) + "," + r1(p[1]); }).join(" ");
      edges.push('<g class="edge e-' + slug(kind) + (r && r.optional ? " optional" : "") + '" data-edge="' + esc(ed.id) + '" data-from="' + esc(from) + '" data-to="' + esc(to) + '">'
        + '<polyline class="line" points="' + ps + '" marker-end="url(#de-ah)"></polyline><polyline class="hit" points="' + ps + '"></polyline><title>' + esc(tip) + "</title></g>");
      var text = r ? (r.label || arr(r.carries).join(", ")) : "";
      if (text) {
        if (text.length > 30) text = text.slice(0, 29) + "…";
        var mp = midpoint(pts), tw = text.length * 5.6 + 10;
        // A label that would not fit beside its segment is left to the tooltip rather than drawn over the boxes.
        if (mp.vertical ? mp.len >= 34 : mp.len >= tw) {
          labels.push('<text class="elabel" data-edge="' + esc(ed.id) + '" x="' + r1(mp.vertical ? mp.x + 6 : mp.x) + '" y="' + r1(mp.vertical ? mp.y + 3.5 : mp.y - 4) + '" text-anchor="' + (mp.vertical ? "start" : "middle") + '">' + esc(text) + "</text>");
        }
      }
    });
    arr(L.nodes).forEach(function (n) {
      if (!n) return;
      var e = ix.el.get(n.id) || { id: n.id, name: n.id, kind: "unknown" };
      var x = num(n.x), y = num(n.y), w = Math.max(20, num(n.w, 160)), hh = Math.max(16, num(n.h, 50));
      var t = tintOf(ix, e, by);
      var tk = by === "system" ? e.system : by === "owner" ? e.owner : e.zone;
      if (!tints.has(t + "|" + (tk || ""))) tints.set(t + "|" + (tk || ""), { tint: t, key: tk });
      var kind = str(e.kind), ks = slug(kind);
      var rx = ks === "person" ? Math.min(hh / 2, 22) : 6;
      var showKind = hh >= 40;
      var lines = wrapLabel(e.name || e.id, Math.floor((w - 14) / 7), hh >= 54 ? 2 : 1);
      var block = lines.length * 15 + (showKind ? 13 : 0);
      var ty = y + hh / 2 - block / 2 + 11.5;
      var cx = r1(x + w / 2);
      var deco = ks === "store" ? '<path class="deco" d="M' + r1(x + 1) + " " + r1(y + 7) + " Q" + cx + " " + r1(y + 13) + " " + r1(x + w - 1) + " " + r1(y + 7) + '"></path>' : "";
      var text = '<text class="nl" text-anchor="middle">' + lines.map(function (ln, i) { return '<tspan x="' + cx + '" y="' + r1(ty + i * 15) + '">' + esc(ln) + "</tspan>"; }).join("") + "</text>"
        + (showKind ? '<text class="nk" text-anchor="middle" x="' + cx + '" y="' + r1(ty + lines.length * 15 - 1) + '">' + esc(kind) + "</text>" : "");
      nodes.push('<g class="node k-' + ks + " tint-" + t + '" data-id="' + esc(n.id) + '" tabindex="0" role="button" aria-label="' + esc((e.name || e.id) + ", " + kind) + '">'
        + '<rect class="box" x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(hh) + '" rx="' + r1(rx) + '"></rect>' + deco + text
        + "<title>" + esc((e.name || e.id) + " (" + kind + ")") + "</title></g>");
    });
    var defs = '<defs><marker id="de-ah" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path class="ahp" d="M0,0.8 L10,5 L0,9.2 z"></path></marker>'
      + '<marker id="de-ah-sel" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path class="ahp sel" d="M0,0.8 L10,5 L0,9.2 z"></path></marker></defs>';
    var svg = '<svg id="de-svg" aria-label="' + esc(v ? v.title : viewId) + '"><title>' + esc(v ? v.title : viewId) + "</title>" + defs
      + '<g class="viewport"><g class="edges">' + edges.join("") + '</g><g class="labels"' + (opts.labels === false ? ' style="display:none"' : "") + ">" + labels.join("") + '</g><g class="nodes">' + nodes.join("") + "</g></g></svg>";
    // legend
    var leg = [];
    Array.from(kinds.keys()).sort().forEach(function (k) {
      leg.push('<span><svg width="34" height="10" aria-hidden="true"><g class="edge e-' + k + '"><polyline class="line" points="1,5 33,5"></polyline></g></svg>' + esc(kinds.get(k)) + "</span>");
    });
    var tintMap = by === "system" ? ix.system : by === "owner" ? ix.team : ix.zone;
    Array.from(tints.values()).sort(function (a, c) { return natural(a.tint, c.tint); }).forEach(function (t) {
      var rec = t.key != null ? tintMap.get(t.key) : null;
      var label = t.key == null || t.key === "" ? (by === "owner" ? "No owner" : by === "system" ? "No system" : "No zone") : (rec ? rec.name : t.key);
      leg.push('<span><i class="swatch tint-' + t.tint + '" aria-hidden="true"></i>' + esc(label) + "</span>");
    });
    return { svg: svg, legend: leg.join(""), width: Math.max(1, num(L.width, 800)), height: Math.max(1, num(L.height, 600)), nodes: arr(L.nodes).length, edges: edges.length };
  }

  // ---------- routing ----------
  function parseHash(h) {
    var raw = str(h).replace(/^#/, "");
    var s = raw;
    try { s = decodeURIComponent(raw); } catch (e) { s = raw; }
    if (!s) return { tab: "overview" };
    if (TABS.indexOf(s) >= 0) return { tab: s };
    var pre = [["unit-", "plan", "unit"], ["phase-", "plan", "phase"], ["element-", "model", "element"], ["view-", "model", "view"],
      ["patch-", "changes", "patch"], ["rule-", "checks", "rule"], ["pack-", "checks", "pack"], ["tracker-", "tracker", "tracker"]];
    for (var i = 0; i < pre.length; i++) {
      if (s.indexOf(pre[i][0]) === 0) return { tab: pre[i][1], kind: pre[i][2], id: s.slice(pre[i][0].length) };
    }
    return { tab: "overview" };
  }

  // ---------- DOM ----------
  function boot() {
    var $ = function (id) { return document.getElementById(id); };
    var dataEl = $("de-bundle"), bundle;
    try { bundle = JSON.parse(dataEl.textContent || "{}"); } catch (e) { bundle = {}; console.error("Plumb: bundle JSON did not parse", e); }
    var ix = buildIndex(bundle);
    var title = (bundle.instance && bundle.instance.title) || document.title;
    var wide = function () { return window.matchMedia ? window.matchMedia("(min-width: 1060px)").matches : window.innerWidth >= 1060; };
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var scrollTo = function (el, block) { if (el && el.scrollIntoView) el.scrollIntoView({ block: block || "start", behavior: reduce ? "auto" : "smooth" }); };
    var safe = function (name, fn) { try { fn(); } catch (e) { console.error("Plumb: " + name + " failed", e); } };

    // theme
    safe("theme", function () {
      var btn = $("theme-btn"), order = ["auto", "light", "dark"], labels = { auto: "Auto", light: "Light", dark: "Dark" }, cur = "auto";
      try { cur = localStorage.getItem("de-theme") || "auto"; } catch (e) { /* storage unavailable */ }
      if (order.indexOf(cur) < 0) cur = "auto";
      var apply = function () {
        if (cur === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", cur);
        btn.textContent = "Theme: " + labels[cur];
        btn.setAttribute("aria-label", "Color theme: " + labels[cur] + ". Activate to change.");
      };
      btn.hidden = false; apply();
      btn.addEventListener("click", function () {
        cur = order[(order.indexOf(cur) + 1) % order.length]; apply();
        try { localStorage.setItem("de-theme", cur); } catch (e) { /* ignore */ }
      });
    });

    // tabs
    var pages = Array.prototype.slice.call(document.querySelectorAll("[data-page]"));
    var tabLinks = Array.prototype.slice.call(document.querySelectorAll("[data-tab]"));
    var currentTab = null;
    function showTab(name) {
      if (TABS.indexOf(name) < 0 || !pages.some(function (p) { return p.getAttribute("data-page") === name; })) name = "overview";
      pages.forEach(function (p) { p.hidden = p.getAttribute("data-page") !== name; });
      tabLinks.forEach(function (a) { if (a.getAttribute("data-tab") === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
      var label = name.charAt(0).toUpperCase() + name.slice(1);
      document.title = (name === "overview" ? "" : label + " · ") + title;
      var changed = currentTab !== name;
      currentTab = name;
      if (changed && name === "model") safe("view", function () { if (!currentView) setView(firstView()); else if (needsFit) fit(); });
      return changed;
    }

    // ---------- plan ----------
    var unitDetailEl = $("unit-detail"), unitRows = Array.prototype.slice.call(document.querySelectorAll("#unit-rows tr"));
    var selectedUnit = null;
    var F = { text: $("f-text"), phase: $("f-phase"), status: $("f-status"), owner: $("f-owner"), kind: $("f-kind") };
    function applyFilters() {
      var q = (F.text && F.text.value || "").toLowerCase().split(/\s+/).filter(Boolean);
      var ph = F.phase ? F.phase.value : "", sv = F.status ? F.status.value : "", ow = F.owner ? F.owner.value : "", kd = F.kind ? F.kind.value : "";
      var shown = 0;
      unitRows.forEach(function (tr) {
        var d = tr.dataset, ok = true;
        if (ph && d.phase !== ph) ok = false;
        if (ok && sv) ok = (sv === "ready" || sv === "blocked") ? d.state === sv : d.status === sv;
        if (ok && ow && d.owner !== ow) ok = false;
        if (ok && kd && d.kind !== kd) ok = false;
        if (ok && q.length) { var t = d.text || ""; ok = q.every(function (w) { return t.indexOf(w) >= 0; }); }
        tr.hidden = !ok; if (ok) shown++;
      });
      var c = $("unit-count");
      if (c) c.textContent = shown === unitRows.length ? plural(shown, "unit") : "Showing " + shown + " of " + plural(unitRows.length, "unit");
      var none = $("unit-none"); if (none) none.hidden = shown !== 0;
    }
    safe("filters", function () {
      Object.keys(F).forEach(function (k) { if (F[k]) F[k].addEventListener(k === "text" ? "input" : "change", applyFilters); });
      var form = $("unit-filters");
      if (form) form.addEventListener("reset", function () { setTimeout(applyFilters, 0); });
      unitRows.forEach(function (tr) {
        tr.addEventListener("click", function (ev) {
          if (ev.target && ev.target.closest && ev.target.closest("a")) return;
          location.hash = "unit-" + encodeURIComponent(tr.dataset.unit);
        });
      });
    });
    function selectUnit(id, scroll) {
      selectedUnit = id;
      if (unitDetailEl) unitDetailEl.innerHTML = unitDetail(ix, id);
      var row = null;
      unitRows.forEach(function (tr) { var on = tr.dataset.unit === id; tr.classList.toggle("selected", on); if (on) { row = tr; tr.setAttribute("aria-selected", "true"); } else tr.removeAttribute("aria-selected"); });
      if (scroll) {
        if (row && row.hidden) { Object.keys(F).forEach(function (k) { if (F[k]) F[k].value = ""; }); applyFilters(); }
        if (wide()) { scrollTo(row, "nearest"); if (unitDetailEl) unitDetailEl.scrollTop = 0; } else scrollTo(unitDetailEl, "start");
      }
    }
    function filterPhase(id) {
      Object.keys(F).forEach(function (k) { if (F[k]) F[k].value = ""; });
      if (F.phase) F.phase.value = id;
      applyFilters();
      scrollTo($("h-units"), "start");
    }

    // ---------- model ----------
    var canvas = $("canvas"), legend = $("legend"), viewSel = $("view-select"), tintSel = $("tint-select"), labelsT = $("labels-toggle");
    var elDetail = $("element-detail"), elRows = Array.prototype.slice.call(document.querySelectorAll("#element-rows tr"));
    var currentView = null, selectedEl = null, st = { k: 1, tx: 0, ty: 0 }, dims = { w: 1, h: 1 }, userMoved = false, needsFit = false;
    function firstView() { var v = bundle.model && arr(bundle.model.views)[0]; return v ? v.id : null; }
    function svgEl() { return canvas ? canvas.querySelector("svg") : null; }
    function applyT() { var s = svgEl(); var vp = s && s.querySelector(".viewport"); if (vp) vp.setAttribute("transform", "translate(" + r1(st.tx) + " " + r1(st.ty) + ") scale(" + Math.round(st.k * 1000) / 1000 + ")"); }
    // The canvas takes the drawing's aspect ratio at its current width, kept between 280px and 75% of the window,
    // so Fit fills it instead of leaving bands above and below a wide drawing.
    function sizeCanvas() {
      if (!canvas) return;
      var cw = canvas.clientWidth;
      if (!cw) return;
      var max = Math.max(280, Math.round(window.innerHeight * 0.75));
      var h = Math.round(cw * dims.h / Math.max(1, dims.w) / 0.96);
      canvas.style.height = Math.max(280, Math.min(max, h)) + "px";
    }
    function fit() {
      if (!canvas) return;
      sizeCanvas();
      var cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) { needsFit = true; return; }
      needsFit = false;
      var k = Math.min(cw / dims.w, ch / dims.h) * 0.96;
      st.k = Math.max(0.05, Math.min(1.4, k));
      st.tx = (cw - dims.w * st.k) / 2; st.ty = (ch - dims.h * st.k) / 2;
      userMoved = false; applyT();
    }
    function zoomAt(f, px, py) {
      var nk = Math.max(0.05, Math.min(6, st.k * f));
      st.tx = px - (px - st.tx) * (nk / st.k); st.ty = py - (py - st.ty) * (nk / st.k); st.k = nk;
      userMoved = true; applyT();
    }
    function zoomCenter(f) { if (canvas) zoomAt(f, canvas.clientWidth / 2, canvas.clientHeight / 2); }
    function setView(id) {
      if (!canvas) return;
      currentView = id;
      if (viewSel && id != null) viewSel.value = id;
      var out = id != null ? viewSvg(ix, id, { tint: tintSel ? tintSel.value : "zone", labels: labelsT ? labelsT.checked : true }) : null;
      if (!out) {
        canvas.innerHTML = '<p class="placeholder" style="margin:16px">' + (id == null ? "This model has no views." : "No layout was built for this view.") + "</p>";
        if (legend) legend.innerHTML = ""; return;
      }
      canvas.innerHTML = out.svg;
      if (legend) legend.innerHTML = out.legend;
      dims = { w: out.width, h: out.height };
      fit();
      highlight(selectedEl);
      if (selectedEl && elDetail) elDetail.innerHTML = elementDetail(ix, selectedEl, currentView);
    }
    function highlight(id) {
      var s = svgEl(); if (!s) return;
      var has = false;
      Array.prototype.forEach.call(s.querySelectorAll(".node"), function (g) {
        g.classList.remove("sel", "nb"); if (g.getAttribute("data-id") === id) { g.classList.add("sel"); has = true; }
      });
      Array.prototype.forEach.call(s.querySelectorAll(".edge"), function (g) {
        var on = has && (g.getAttribute("data-from") === id || g.getAttribute("data-to") === id);
        g.classList.toggle("on", on);
        var ln = g.querySelector(".line"); if (ln) ln.setAttribute("marker-end", on ? "url(#de-ah-sel)" : "url(#de-ah)");
        if (on) {
          var other = g.getAttribute("data-from") === id ? g.getAttribute("data-to") : g.getAttribute("data-from");
          Array.prototype.forEach.call(s.querySelectorAll(".node"), function (n) { if (n.getAttribute("data-id") === other) n.classList.add("nb"); });
        }
      });
      Array.prototype.forEach.call(s.querySelectorAll(".elabel"), function (t) {
        var g = s.querySelector('.edge.on[data-edge="' + (window.CSS && CSS.escape ? CSS.escape(t.getAttribute("data-edge")) : t.getAttribute("data-edge")) + '"]');
        t.classList.toggle("on", !!g);
      });
      s.classList.toggle("has-sel", has);
      return has;
    }
    function centerOn(id) {
      var L = ix.layout.get(currentView); if (!L || !canvas) return;
      var n = arr(L.nodes).filter(function (x) { return x && x.id === id; })[0]; if (!n) return;
      var cw = canvas.clientWidth, ch = canvas.clientHeight;
      var nx = (num(n.x) + num(n.w) / 2) * st.k + st.tx, ny = (num(n.y) + num(n.h) / 2) * st.k + st.ty;
      if (nx > 40 && nx < cw - 40 && ny > 30 && ny < ch - 30) return;
      st.tx = cw / 2 - (num(n.x) + num(n.w) / 2) * st.k; st.ty = ch / 2 - (num(n.y) + num(n.h) / 2) * st.k; applyT();
    }
    function selectElement(id, opts) {
      opts = opts || {};
      selectedEl = id;
      var views = ix.viewsByEl.get(id) || [];
      if (opts.view && ix.view.has(opts.view)) { if (currentView !== opts.view) setView(opts.view); }
      else if (views.length && views.indexOf(currentView) < 0) setView(views[0]);
      else if (!currentView) setView(firstView());
      highlight(id);
      if (!opts.fromCanvas) centerOn(id);
      if (elDetail) elDetail.innerHTML = elementDetail(ix, id, currentView);
      elRows.forEach(function (tr) { tr.classList.toggle("selected", tr.dataset.element === id); });
      if (opts.scroll) {
        if (opts.fromRow) scrollTo(wide() ? canvas : elDetail, "start");
        else if (opts.fromLoad) { if (window.scrollTo) window.scrollTo(0, 0); }
        else if (!opts.fromCanvas) scrollTo($("h-model"), "start");
        else if (!wide()) scrollTo(elDetail, "nearest");
      }
    }
    function clearSelection() {
      selectedEl = null; highlight(null);
      elRows.forEach(function (tr) { tr.classList.remove("selected"); });
      if (history.replaceState) history.replaceState(null, "", currentView ? "#view-" + encodeURIComponent(currentView) : "#model");
    }
    var navFrom = null;
    function goElement(id, from) { navFrom = from; var h = "element-" + encodeURIComponent(id); if (location.hash === "#" + h) { route(); } else location.hash = h; }

    safe("model", function () {
      if (!canvas) return;
      if (viewSel) viewSel.addEventListener("change", function () {
        setView(viewSel.value);
        if (history.replaceState) history.replaceState(null, "", "#view-" + encodeURIComponent(viewSel.value));
      });
      if (tintSel) tintSel.addEventListener("change", function () { var keep = { k: st.k, tx: st.tx, ty: st.ty }, um = userMoved; setView(currentView); if (um) { st = keep; userMoved = true; applyT(); } });
      if (labelsT) labelsT.addEventListener("change", function () { var s = svgEl(); var g = s && s.querySelector(".labels"); if (g) g.style.display = labelsT.checked ? "" : "none"; });
      var zi = $("zoom-in"), zo = $("zoom-out"), zf = $("zoom-fit");
      if (zi) zi.addEventListener("click", function () { zoomCenter(1.25); });
      if (zo) zo.addEventListener("click", function () { zoomCenter(0.8); });
      if (zf) zf.addEventListener("click", fit);
      canvas.addEventListener("wheel", function (ev) {
        if (!svgEl()) return;
        ev.preventDefault();
        var rect = canvas.getBoundingClientRect();
        var dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
        zoomAt(Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0015)), ev.clientX - rect.left, ev.clientY - rect.top);
      }, { passive: false });
      var pointers = new Map(), drag = null, pinch = null;
      canvas.addEventListener("pointerdown", function (ev) {
        if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === "mouse") return;
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pointers.size === 1) drag = { x: ev.clientX, y: ev.clientY, tx: st.tx, ty: st.ty, moved: false, target: ev.target };
        else if (pointers.size === 2) {
          var ps = Array.from(pointers.values()), rect = canvas.getBoundingClientRect();
          pinch = { d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1, k: st.k, tx: st.tx, ty: st.ty,
            mx: (ps[0].x + ps[1].x) / 2 - rect.left, my: (ps[0].y + ps[1].y) / 2 - rect.top };
          if (drag) drag.moved = true;
        }
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      });
      canvas.addEventListener("pointermove", function (ev) {
        if (!pointers.has(ev.pointerId)) return;
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pinch && pointers.size >= 2) {
          var ps = Array.from(pointers.values()), rect = canvas.getBoundingClientRect();
          var d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1;
          var mx = (ps[0].x + ps[1].x) / 2 - rect.left, my = (ps[0].y + ps[1].y) / 2 - rect.top;
          var nk = Math.max(0.05, Math.min(6, pinch.k * d / pinch.d));
          st.tx = mx - (pinch.mx - pinch.tx) * (nk / pinch.k); st.ty = my - (pinch.my - pinch.ty) * (nk / pinch.k); st.k = nk;
          userMoved = true; applyT(); return;
        }
        if (!drag) return;
        var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; canvas.classList.add("dragging"); }
        if (drag.moved) { st.tx = drag.tx + dx; st.ty = drag.ty + dy; userMoved = true; applyT(); }
      });
      var end = function (ev) {
        if (!pointers.has(ev.pointerId)) return;
        pointers.delete(ev.pointerId);
        if (pointers.size < 2) pinch = null;
        if (pointers.size === 0) {
          canvas.classList.remove("dragging");
          if (drag && !drag.moved && ev.type === "pointerup") {
            var node = drag.target && drag.target.closest ? drag.target.closest(".node") : null;
            if (node) goElement(node.getAttribute("data-id"), "canvas"); else if (selectedEl) clearSelection();
          }
          drag = null;
        }
      };
      canvas.addEventListener("pointerup", end);
      canvas.addEventListener("pointercancel", end);
      canvas.addEventListener("keydown", function (ev) {
        var k = ev.key, step = ev.shiftKey ? 160 : 48, handled = true;
        var node = ev.target && ev.target.closest ? ev.target.closest(".node") : null;
        if ((k === "Enter" || k === " ") && node) goElement(node.getAttribute("data-id"), "canvas");
        else if (k === "ArrowLeft") { st.tx += step; userMoved = true; applyT(); }
        else if (k === "ArrowRight") { st.tx -= step; userMoved = true; applyT(); }
        else if (k === "ArrowUp") { st.ty += step; userMoved = true; applyT(); }
        else if (k === "ArrowDown") { st.ty -= step; userMoved = true; applyT(); }
        else if (k === "+" || k === "=") zoomCenter(1.25);
        else if (k === "-" || k === "_") zoomCenter(0.8);
        else if (k === "0") fit();
        else if (k === "Escape" && selectedEl) clearSelection();
        else handled = false;
        if (handled) ev.preventDefault();
      });
      var rt = null;
      window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (currentTab !== "model") return; if (userMoved) sizeCanvas(); else fit(); }, 120); });
      if (elDetail) elDetail.addEventListener("click", function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest("[data-show-view]") : null;
        if (!a) return;
        ev.preventDefault();
        var vid = a.getAttribute("data-show-view"), eid = a.getAttribute("data-show-element");
        selectElement(eid, { view: vid });
        if (history.replaceState) history.replaceState(null, "", "#element-" + encodeURIComponent(eid));
      });
      var elText = $("el-text");
      if (elText) elText.addEventListener("input", function () {
        var q = elText.value.toLowerCase().split(/\s+/).filter(Boolean);
        elRows.forEach(function (tr) { var t = tr.dataset.text || ""; tr.hidden = !q.every(function (w) { return t.indexOf(w) >= 0; }); });
      });
      elRows.forEach(function (tr) {
        tr.addEventListener("click", function (ev) {
          if (ev.target && ev.target.closest && ev.target.closest("a")) { navFrom = "row"; return; }
          goElement(tr.dataset.element, "row");
        });
      });
    });

    // long exit tests: clamp to four lines with a button to expand
    safe("clamp", function () {
      Array.prototype.forEach.call(document.querySelectorAll(".road-exit"), function (box) {
        var p = box.querySelector(".clamp"), btn = box.querySelector("[data-unclamp]");
        if (!p || !btn || (p.textContent || "").length < 220) return;
        p.classList.add("on"); btn.hidden = false;
        btn.addEventListener("click", function () {
          var on = p.classList.toggle("on");
          btn.textContent = on ? "Show the whole test" : "Show less";
          btn.setAttribute("aria-expanded", on ? "false" : "true");
        });
        btn.setAttribute("aria-expanded", "false");
      });
    });

    // ---------- checks ----------
    safe("checks", function () {
      var hp = $("hide-passing"), page = $("checks");
      if (hp && page) hp.addEventListener("change", function () { page.classList.toggle("hide-passing", hp.checked); });
    });

    // ---------- router ----------
    function route() {
      var r = parseHash(location.hash), from = navFrom; navFrom = null;
      var changed = showTab(r.tab);
      if (!r.kind) { if (changed) window.scrollTo(0, 0); return; }
      if (r.kind === "unit") selectUnit(r.id, true);
      else if (r.kind === "phase") filterPhase(r.id);
      else if (r.kind === "element") selectElement(r.id, { scroll: true, fromCanvas: from === "canvas", fromRow: from === "row" || (!from && !changed), fromLoad: from === "load" });
      else if (r.kind === "view") { if (ix.view.has(r.id)) setView(r.id); scrollTo($("h-model"), "start"); }
      else {
        var target = $(r.kind + "-" + r.id.replace(/\s/g, "_"));
        if (target) { if (target.tagName === "DETAILS") target.open = true; scrollTo(target, "start"); }
      }
    }
    window.addEventListener("hashchange", route);
    safe("route", route);
    // The browser scrolls to a fragment target (a table row) after load; route once more so a deep
    // link lands on the diagram or the detail panel rather than the row.
    if (parseHash(location.hash).kind) window.addEventListener("load", function () { setTimeout(function () { navFrom = "load"; safe("route", route); }, 0); });
    document.documentElement.classList.add("js");
  }

  return { esc: esc, buildIndex: buildIndex, unitDetail: unitDetail, elementDetail: elementDetail, viewSvg: viewSvg, parseHash: parseHash, wrapLabel: wrapLabel, ladderHtml: ladderHtml, boot: boot };
})();

if (typeof document !== "undefined" && document.getElementById && document.getElementById("de-bundle")) {
  try { DE.boot(); } catch (e) { if (typeof console !== "undefined") console.error("Plumb: the page script failed", e); }
}
