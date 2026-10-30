/* Plumb site client, part 3: page controllers. Each takes the shared state S (built in app.js) and the
   current route, and updates its page in place. Nothing here starts a timer that repeats: the offline page must
   settle once it has drawn. */

function $(id) { return document.getElementById(id); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function isWide(px) { return window.matchMedia ? window.matchMedia("(min-width: " + px + "px)").matches : window.innerWidth >= px; }
function cssEscape(s) { return window.CSS && CSS.escape ? CSS.escape(s) : str(s).replace(/["\\]/g, "\\$&"); }

// ---------- a pannable, zoomable canvas (events attached once; the drawing inside can change) ----------
function attachCanvas(canvas, S, h) {
  if (canvas._attached) { canvas._h = h; return; }
  canvas._attached = true; canvas._h = h;
  var pointers = new Map(), drag = null, pinch = null;
  var cam = function () { return canvas._cam; };
  canvas.addEventListener("wheel", function (ev) {
    var c = cam(); if (!c) return;
    ev.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
    var dx = ev.deltaMode === 1 ? ev.deltaX * 16 : ev.deltaX;
    if (ev.ctrlKey || ev.metaKey) c.zoomAt(Math.exp(-dy * 0.01), ev.clientX - rect.left, ev.clientY - rect.top);
    else c.panBy(-(ev.shiftKey && !dx ? dy : dx), ev.shiftKey && !dx ? 0 : -dy);
  }, { passive: false });
  canvas.addEventListener("pointerdown", function (ev) {
    if (ev.target.closest && ev.target.closest(".minimap, .chooser")) return;
    if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === "mouse") return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    var c = cam(); if (!c) return;
    if (pointers.size === 1) drag = { x: ev.clientX, y: ev.clientY, tx: c.tx, ty: c.ty, moved: false, target: ev.target };
    else if (pointers.size === 2) {
      var ps = Array.from(pointers.values()), rect = canvas.getBoundingClientRect();
      pinch = { d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1, k: c.k, tx: c.tx, ty: c.ty, mx: (ps[0].x + ps[1].x) / 2 - rect.left, my: (ps[0].y + ps[1].y) / 2 - rect.top };
      if (drag) drag.moved = true;
    }
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  });
  canvas.addEventListener("pointermove", function (ev) {
    var c = cam();
    if (!pointers.has(ev.pointerId)) {
      if (ev.pointerType === "mouse" && canvas._h.hover) { var n = ev.target.closest && ev.target.closest(".node"); canvas._h.hover(n ? n.getAttribute("data-id") : null); }
      return;
    }
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (!c) return;
    if (pinch && pointers.size >= 2) {
      var ps = Array.from(pointers.values()), rect = canvas.getBoundingClientRect();
      var d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1;
      var mx = (ps[0].x + ps[1].x) / 2 - rect.left, my = (ps[0].y + ps[1].y) / 2 - rect.top;
      var nk = Math.max(0.05, Math.min(4, pinch.k * d / pinch.d));
      c.tx = mx - (pinch.mx - pinch.tx) * (nk / pinch.k); c.ty = my - (pinch.my - pinch.ty) * (nk / pinch.k); c.k = nk; c.apply(); return;
    }
    if (!drag) return;
    var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; canvas.classList.add("dragging"); }
    if (drag.moved) { c.tx = drag.tx + dx; c.ty = drag.ty + dy; c.apply(); }
  });
  canvas.addEventListener("pointerleave", function () { if (canvas._h.hover && !pointers.size) canvas._h.hover(null); });
  var end = function (ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      canvas.classList.remove("dragging");
      if (drag && !drag.moved && ev.type === "pointerup") {
        var node = drag.target && drag.target.closest ? drag.target.closest(".node") : null;
        if (node && canvas._h.activate) canvas._h.activate(node.getAttribute("data-id"), node, ev);
        else if (!node && canvas._h.background) canvas._h.background();
      }
      drag = null;
    }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("dblclick", function (ev) {
    var node = ev.target.closest && ev.target.closest(".node");
    if (node && canvas._h.dbl) canvas._h.dbl(node.getAttribute("data-id"), node);
  });
  canvas.addEventListener("focusin", function (ev) { var n = ev.target.closest && ev.target.closest(".node"); if (n && canvas._h.hover) canvas._h.hover(n.getAttribute("data-id"), true); });
  canvas.addEventListener("focusout", function () { if (canvas._h.hover) setTimeout(function () { if (!canvas.contains(document.activeElement)) canvas._h.hover(null); }, 0); });
  canvas.addEventListener("keydown", function (ev) { if (canvas._h.key) canvas._h.key(ev); });
}

/** Dim everything outside a set; the set's edges go darker. ids: Set of node ids, or null to clear. */
function dimTo(svg, ids, extraEdgesOf) {
  if (!svg) return;
  if (!ids || !ids.size) {
    svg.classList.remove("dim");
    $$(".hi", svg).forEach(function (g) { g.classList.remove("hi"); });
    return;
  }
  svg.classList.add("dim");
  $$(".node", svg).forEach(function (g) { g.classList.toggle("hi", ids.has(g.getAttribute("data-id"))); });
  $$(".edge, .elabel", svg).forEach(function (g) {
    var a = g.getAttribute("data-from"), b = g.getAttribute("data-to");
    var on = extraEdgesOf ? (extraEdgesOf === a || extraEdgesOf === b) : (ids.has(a) && ids.has(b));
    g.classList.toggle("hi", on);
  });
}
function oneHop(svg, id) {
  var set = new Set([id]);
  $$(".edge", svg).forEach(function (g) {
    if (g.getAttribute("data-from") === id) set.add(g.getAttribute("data-to"));
    if (g.getAttribute("data-to") === id) set.add(g.getAttribute("data-from"));
  });
  return set;
}

// ---------- Model ----------
function modelPage(S) {
  var M = S.model || (S.model = { mode: "view", view: null, focus: null, sel: null, minimap: "auto", hover: null });
  var ix = S.ix;
  var area = $("diagram-area"), insp = $("inspector");
  var firstView = function () { var g = arr(ix.b.viewGroups)[0]; var v = g ? g.views[0] : null; return v || (arr(ix.b.model.views)[0] || {}).id || null; };

  function railMark() {
    $$("#views-rail a[data-view], #views-sheet a[data-view]").forEach(function (a) {
      var v = a.getAttribute("data-view");
      var on = M.mode === "view" ? v === M.view : M.mode === "zone" ? v === "__zone:" + M.zone : M.mode === "elements" ? v === "__elements" : M.mode === "matrix" ? v === "__matrix" : false;
      if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
  }

  function diagramData() {
    var o = { hiddenElKinds: S.hiddenElKinds, hiddenRelKinds: S.hiddenRelKinds };
    if (M.mode === "focus") return focusDiagram(ix, M.focus, M.depth || 1, { hiddenElKinds: S.hiddenElKinds, hiddenRelKinds: S.hiddenRelKinds, otherZones: M.otherZones !== false, expanded: M.expanded || new Set() });
    if (M.mode === "zone") return zoneDiagram(ix, ix.zoneScene.get(M.zone), o);
    var L = ix.layout.get(M.view);
    return L ? fromLayout(ix, L, o) : null;
  }

  function kindsMenu() {
    var elKinds = new Map(), relKinds = new Map();
    var zs = M.mode === "zone" ? ix.zoneScene.get(M.zone) : null;
    var els = M.mode === "focus" ? null : zs ? arr(zs.layout.nodes).map(function (n) { return n.id; }) : arr((ix.view.get(M.view) || {}).elements);
    (els || Array.from(ix.el.keys())).forEach(function (id) { var e = ix.el.get(id); if (e) elKinds.set(e.kind, (elKinds.get(e.kind) || 0) + 1); });
    var L = zs ? zs.layout : ix.layout.get(M.view);
    if (M.mode !== "focus" && L) arr(L.edges).forEach(function (ed) { var r = ix.rel.get(ed.id); if (r) relKinds.set(r.kind, (relKinds.get(r.kind) || 0) + 1); });
    else ix.rel.forEach(function (r) { relKinds.set(r.kind, (relKinds.get(r.kind) || 0) + 1); });
    var box = function (kind, set, n, group) {
      return '<label class="check"><input type="checkbox" data-kind-group="' + group + '" value="' + esc(kind) + '"' + (set.has(kind) ? "" : " checked") + "> " + esc(kind) + ' <span class="muted xs">' + n + "</span></label>";
    };
    return "<h4>Parts</h4>" + Array.from(elKinds.keys()).sort().map(function (k) { return box(k, S.hiddenElKinds, elKinds.get(k), "el"); }).join("")
      + "<h4>Relationships</h4>" + Array.from(relKinds.keys()).sort().map(function (k) { return box(k, S.hiddenRelKinds, relKinds.get(k), "rel"); }).join("");
  }

  function head() {
    var v = ix.view.get(M.view);
    if (M.mode === "zone") {
      var zs = ix.zoneScene.get(M.zone);
      return '<div class="canvas-head"><nav class="crumbs" aria-label="Breadcrumb"><a href="#overview/system">System</a><span class="sep" aria-hidden="true">&#8250;</span><span>Zones</span></nav><h2 id="canvas-title">' + esc(zs ? zs.name : "No such zone") + ' <span class="muted small">zone</span></h2>'
        + (zs ? '<p class="small fg2">' + esc(zoneScope(ix, zs)) + "</p>" : "") + '<p class="small filter-line" id="canvas-filter" hidden></p></div>';
    }
    if (M.mode === "focus") {
      var e = ix.el.get(M.focus);
      var crumbs = '<nav class="crumbs" aria-label="Breadcrumb"><a href="#model">Views</a><span class="sep" aria-hidden="true">&#8250;</span>'
        + (M.fromView && ix.view.get(M.fromView) ? '<a href="' + R.view(M.fromView) + '">' + esc(ix.view.get(M.fromView).title) + '</a><span class="sep" aria-hidden="true">&#8250;</span>' : "")
        + arr(M.trail).slice(0, -1).map(function (t) { var te = ix.el.get(t); return '<a href="' + R.focus(t, M.depth) + '">' + esc(te ? te.name : t) + '</a><span class="sep" aria-hidden="true">&#8250;</span>'; }).join("")
        + "<span>Focus: " + esc(e ? e.name : M.focus) + "</span></nav>";
      return '<div class="canvas-head">' + crumbs + '<h2 id="canvas-title">Neighbourhood of ' + esc(e ? e.name : M.focus) + '</h2><p class="small fg2" id="canvas-scope"></p><p class="small filter-line" id="canvas-filter" hidden></p></div>';
    }
    return '<div class="canvas-head"><nav class="crumbs" aria-label="Breadcrumb"><a href="#model">Views</a>' + (v && v.group ? '<span class="sep" aria-hidden="true">&#8250;</span><span>' + esc(v.group) + "</span>" : "") + '</nav><h2 id="canvas-title">' + esc(v ? v.title : "No view") + "</h2>"
      + (v && v.description ? '<p class="small fg2">' + esc(v.description) + "</p>" : "") + '<p class="small filter-line" id="canvas-filter" hidden></p></div>';
  }

  function toolbar() {
    var lens = [["zone", "Zone"], ["owner", "Owner team"], ["fidelity", "How real it is"], ["findings", "Problems"], ["plan", "Plan status"]].concat(ix.b.flow ? [["flow", "Wait"]] : []);
    var hidden = S.hiddenElKinds.size + S.hiddenRelKinds.size;
    return '<div class="toolbar" role="toolbar" aria-label="Diagram tools">'
      + '<label class="opt"><span class="sr-only">Colour by</span><select id="lens-select" aria-label="Colour by: what the fill shows">' + lens.map(function (l) { return '<option value="' + l[0] + '"' + (S.lens === l[0] ? " selected" : "") + ">Colour by: " + l[1] + "</option>"; }).join("") + "</select></label>"
      + '<span class="menu-wrap opt"><button type="button" class="btn" id="kinds-btn" aria-expanded="false" aria-controls="kinds-menu">Kinds</button><div class="menu" id="kinds-menu" hidden>' + kindsMenu() + "</div></span>"
      + (hidden ? '<button type="button" class="btn quiet opt" id="kinds-reset">' + hidden + " hidden \u00b7 show all</button>" : "")
      + (M.mode === "focus" ? '<span class="opt" role="group" aria-label="Depth" style="display:inline-flex;gap:2px"><button type="button" class="btn" data-depth="1" aria-pressed="' + (M.depth !== 2) + '">Depth 1</button><button type="button" class="btn" data-depth="2" aria-pressed="' + (M.depth === 2) + '">Depth 2</button></span>'
        + '<label class="check opt"><input type="checkbox" id="other-zones"' + (M.otherZones !== false ? " checked" : "") + "> Include other zones</label>"
        + (M.depth === 2 && M.D && M.D.cross ? '<label class="check opt"><input type="checkbox" id="show-cross"' + (M.showCross ? " checked" : "") + "> Other links (" + M.D.cross + ")</label>" : "") : "")
      + '<span class="grow"></span>'
      + '<button type="button" class="btn icon-only" id="zoom-out" aria-label="Zoom out">&#8722;</button><button type="button" class="btn icon-only" id="zoom-in" aria-label="Zoom in">+</button>'
      + '<button type="button" class="btn" id="fit-all" aria-keyshortcuts="0">Fit to screen</button><button type="button" class="btn" id="mini-btn" aria-pressed="false">Mini map</button></div>';
  }

  function twin(D) {
    if (!D) return "";
    var ids = D.nodes.filter(function (n) { return !n.stub && !n.portal; }).map(function (n) { return n.id; });
    if (D.stream) return streamTwin(D, ids);
    var set = new Set(ids);
    var rels = [];
    D.edges.forEach(function (e) { e.ids.forEach(function (id, i) { var r = e.rels[i] || ix.rel.get(id); if (r && set.has(r.from) && set.has(r.to)) rels.push(r); }); });
    return '<details class="disc twin" id="twin"><summary>Table version of this ' + (M.mode === "focus" ? "neighbourhood" : "view") + ' <span class="muted small">' + plural(ids.length, "part") + ", " + plural(rels.length, "relationship") + "</span></summary><div class=\"body\" style=\"padding-left:0\">"
      + '<div class="table-wrap reflow"><table class="reflow"><caption class="sr-only">Parts</caption><thead><tr><th scope="col">Part</th><th scope="col">Kind</th><th scope="col">Zone</th><th scope="col">Owner team</th><th scope="col">Problems</th></tr></thead><tbody>'
      + ids.map(function (id) { var e = ix.el.get(id) || {}; var z = ix.zone.get(e.zone); var t = ix.team.get(e.owner); var fs = (ix.findingsAt.get("element:" + id) || []).length;
        return '<tr data-twin="' + esc(id) + '"><td class="lead" data-label="Part"><a href="' + R.element(id) + '">' + esc(e.name || id) + '</a></td><td class="inline" data-label="Kind">' + esc(e.kind) + '</td><td class="inline" data-label="Zone">' + esc(z ? z.name : "") + '</td><td class="inline" data-label="Owner team">' + esc(t ? t.name : "") + '</td><td class="inline n" data-label="Problems">' + (fs || "") + "</td></tr>"; }).join("")
      + "</tbody></table></div>"
      + (rels.length ? '<div class="table-wrap reflow" style="margin-top:8px"><table class="reflow"><caption class="sr-only">Relationships</caption><thead><tr><th scope="col">From</th><th scope="col">Kind</th><th scope="col">Label</th><th scope="col">To</th><th scope="col">Carries</th></tr></thead><tbody>'
        + rels.map(function (r) { return '<tr><td class="lead" data-label="From">' + elLink(ix, r.from) + '</td><td class="inline" data-label="">' + esc(r.kind) + '</td><td class="inline" data-label="">' + esc(r.label || "") + '</td><td class="lead" data-label="To">' + elLink(ix, r.to) + '</td><td class="inline" data-label="Carries">' + esc(arr(r.carries).map(function (c) { return plainRef(ix, c); }).join(", ")) + "</td></tr>"; }).join("")
        + "</tbody></table></div>" : "")
      + "</div></details>";
  }

  /** The table version of a stream drawing: the steps in stream order, each with its team and its flow numbers and their sources. */
  function streamTwin(D, ids) {
    var order = D.stream.path.concat(ids.filter(function (id) { return D.stream.path.indexOf(id) < 0; }));
    var t = ix.b.flow.asOf, set = new Set(ids), rels = [];
    D.edges.forEach(function (e) { e.ids.forEach(function (id, i) { var r = e.rels[i] || ix.rel.get(id); if (r && set.has(r.from) && set.has(r.to)) rels.push(r); }); });
    var cell = function (v, unit) { return v ? esc(FLOWUI.val(v, t, unit)) : ""; };
    return '<details class="disc twin" id="twin"><summary>Table version of this view <span class="muted small">' + plural(ids.length, "part") + " in stream order, " + plural(rels.length, "relationship") + "</span></summary><div class=\"body\" style=\"padding-left:0\">"
      + '<div class="table-wrap reflow"><table class="reflow twin-stream"><caption class="sr-only">Parts in stream order</caption><thead><tr><th scope="col">#</th><th scope="col">Part</th><th scope="col">Team</th><th scope="col">Wait before it</th><th scope="col">Work</th><th scope="col">WIP limit</th><th scope="col">Tracker</th><th scope="col">Problems</th></tr></thead><tbody>'
      + order.map(function (id) {
        var e = ix.el.get(id) || {}, s = FLOWUI.step(ix.b, id) || {}, m = s.measured || {}, pos = D.stream.path.indexOf(id), fs = (ix.findingsAt.get("element:" + id) || []).length;
        var now = FLOWUI.wipNowWords(ix.b, id);
        var wip = (s.wip ? cell(s.wip, "limit") : e.kind === "queue" ? '<span class="warn-text">none</span>' : "") + (now ? '<br><span class="small">' + esc(now) + "</span>" : "");
        var tr = [m.wait ? "wait " + FLOWUI.meas(m.wait) : "", m.work ? "work " + FLOWUI.meas(m.work) : ""].filter(Boolean).join("; ");
        return '<tr data-twin="' + esc(id) + '"><td class="inline n" data-label="#">' + (pos >= 0 ? pos + 1 : "off the path") + '</td><td class="lead" data-label="Part"><a href="' + R.element(id) + '">' + esc(e.name || id) + '</a></td><td class="inline" data-label="Team">' + esc(e.owner ? teamName(ix, e.owner) : "No owner team") + '</td><td class="inline" data-label="Wait before it">' + cell(s.wait) + '</td><td class="inline" data-label="Work">' + cell(s.work) + '</td><td class="inline" data-label="WIP limit">' + wip + '</td><td class="inline" data-label="Tracker">' + esc(tr) + '</td><td class="inline n" data-label="Problems">' + (fs || "") + "</td></tr>";
      }).join("") + "</tbody></table></div>"
      + (rels.length ? '<div class="table-wrap reflow" style="margin-top:8px"><table class="reflow"><caption class="sr-only">Relationships</caption><thead><tr><th scope="col">From</th><th scope="col">Kind</th><th scope="col">Label</th><th scope="col">To</th><th scope="col">Teams</th></tr></thead><tbody>'
        + rels.map(function (r) { var fe = ix.el.get(r.from) || {}, te = ix.el.get(r.to) || {}; return '<tr><td class="lead" data-label="From">' + elLink(ix, r.from) + '</td><td class="inline" data-label="">' + esc(r.kind) + '</td><td class="inline" data-label="">' + esc(r.label || "") + '</td><td class="lead" data-label="To">' + elLink(ix, r.to) + '</td><td class="inline" data-label="Teams">' + (r.kind === "handoff" && fe.owner && te.owner ? esc(teamName(ix, fe.owner) + " to " + teamName(ix, te.owner)) : "") + "</td></tr>"; }).join("")
        + "</tbody></table></div>" : "")
      + "</div></details>";
  }

  function canvasLabel(D) {
    var what = M.mode === "focus" ? "Neighbourhood diagram" : M.mode === "zone" ? "Zone diagram" : "View diagram";
    return what + ", " + plural(D.nodes.length, "node") + ". Tab to a part, then arrow keys follow its relationships, Up and Down move within a column, Enter selects, F focuses its neighbourhood, Shift with arrows pans, plus and minus zoom, 0 fits all, Escape leaves.";
  }

  function draw(keepCamera) {
    var D = diagramData();
    M.D = D;
    var prev = M.cam ? { k: M.cam.k, tx: M.cam.tx, ty: M.cam.ty } : null;
    area.innerHTML = head() + toolbar() + (D ? '<div class="canvas" id="canvas" role="group" aria-roledescription="diagram" aria-label="' + esc(canvasLabel(D)) + '"></div><div class="legend" id="legend"></div><p class="canvas-help">Drag or scroll to pan; pinch, Ctrl or Command with scroll, or the buttons to zoom. Press <span class="kbd">?</span> for every shortcut.</p>' + (D.stream && M.mode === "view" ? FLOWUI.panel(ix.b, M.view, function (id) { return elLink(ix, id); }) : "") + twin(D)
      : '<p class="empty">' + (M.mode === "focus" ? "No element with that id." : M.mode === "zone" ? "This model has no zone with that id. Pick a zone in the rail." : "This model has no views.") + "</p>");
    M.D = D;
    if (!D) return;
    if (M.mode === "focus") {
      var sc = $("canvas-scope");
      if (sc) sc.textContent = focusScope(ix, D);
    }
    var out = renderDiagram(ix, D, { prefix: "mdl", lens: S.lens, selected: M.sel });
    var canvas = $("canvas");
    canvas.innerHTML = out.svg + '<div class="minimap" id="minimap" hidden></div>';
    if (M.showCross) { var sv0 = canvas.querySelector("svg"); if (sv0) sv0.classList.add("show-cross"); }
    $("legend").innerHTML = out.legend;
    var maxH = Math.round(window.innerHeight * (isWide(720) ? 0.72 : 0.7));
    if (document.documentElement.classList.contains("presenting")) maxH = Math.max(320, window.innerHeight - 48 - (S.captionH || 160) - 120);
    canvas.style.height = (D.stream ? Math.round(Math.max(320, Math.min(maxH + 120, D.height * Math.max(0.5, Math.min(1.25, ((canvas.clientWidth || 600) / D.width) * 0.98)) + 14))) : canvasHeight(canvas.clientWidth || 600, D.width, D.height, maxH)) + "px";
    var svg = canvas.querySelector("svg");
    M.camReady = false;
    var cam = new Camera(canvas, svg, D.width, D.height, { reduce: S.reduce, onChange: function () { updateMinimap(); camSave(); } });
    canvas._cam = cam; M.cam = cam;
    if (keepCamera && prev) { cam.k = prev.k; cam.tx = prev.tx; cam.ty = prev.ty; cam.apply(); } else if (D.stream) cam.fitWidth();
    else if (M.mode === "zone" || (M.mode === "focus" && M.depth === 2)) {
      // framed on the parts (portals aside), centred on the busiest one, at a legible scale
      var parts = D.nodes.filter(function (n) { return !n.portal && !n.stub; });
      var deg = {}; D.edges.forEach(function (e) { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; });
      var hub = M.mode === "focus" ? parts.filter(function (n) { return n.id === M.focus; })[0] : parts.slice().sort(function (a, b) { return (deg[b.id] || 0) - (deg[a.id] || 0); })[0];
      // the whole drawing, portals and all, when it fits at a legible scale; else the parts, around the busiest
      // (a zone's portals are what its caption counts, so they may take the scale down to 0.6, the least at which
      // names still show; below that the parts win)
      var cnv = cam.size(), fitsAll = Math.min((cnv.w - 48) / D.width, (cnv.h - 48) / D.height) >= (M.mode === "zone" ? 0.6 : 0.7);
      cam.frame(fitsAll ? D.nodes : parts, hub, fitsAll ? 0.6 : 0.7);
    } else cam.readable();
    // roving tab stop: the selected node, else the focus node, else the first
    var nodes = $$(".node", svg);
    var start = nodes.filter(function (g) { return g.getAttribute("data-id") === (M.sel || M.focus); })[0] || nodes[0];
    if (start) start.setAttribute("tabindex", "0");
    attachCanvas(canvas, S, handlers);
    wireToolbar();
    applyHighlight();
    if (M.sel && !keepCamera) centerNode(M.sel, false);
    else if (M.mode === "focus" && !keepCamera && M.cam.w * M.cam.k > (canvas.clientWidth || 0)) {
      var fnode = nodeBox(M.focus);
      if (fnode) {
        M.cam.centerOn(fnode.x + fnode.w / 2, M.cam.h / 2 > (canvas.clientHeight || 0) / M.cam.k / 2 ? fnode.y + fnode.h / 2 : M.cam.h / 2, M.cam.k, false);
        // centred on the focus, but never an empty margin on one side while the drawing runs off the other
        var cw = canvas.clientWidth || 0; M.cam.tx = Math.min(8, Math.max(cw - M.cam.w * M.cam.k - 8, M.cam.tx)); M.cam.apply();
      }
    }
    updateMinimap();
    M.camReady = true;
    focusDrawing(S, svg);
  }

  /** Pan and zoom replace the hash's camera (at=cx,cy,k), debounced; they never push history, so Back is a level or filter change. */
  var camT = null;
  function camSave() {
    if (!M.camReady) return;
    clearTimeout(camT);
    camT = setTimeout(function () {
      if (S.page !== "model" || S.tour.on || !M.cam || !history.replaceState || !/^#model/.test(location.hash)) return;
      var c = M.cam.size(), cx = (c.w / 2 - M.cam.tx) / M.cam.k, cy = (c.h / 2 - M.cam.ty) / M.cam.k;
      var h = location.hash, qi = h.indexOf("?"), base = qi < 0 ? h : h.slice(0, qi);
      var q = (qi < 0 ? [] : h.slice(qi + 1).split("&")).filter(function (kv) { return kv && kv.split("=")[0] !== "at"; });
      q.push("at=" + Math.round(cx) + "," + Math.round(cy) + "," + Math.round(M.cam.k * 100) / 100);
      history.replaceState(null, "", base + "?" + q.join("&"));
    }, 300);
  }
  /** A camera from the hash, when a shared link or Back names one. */
  function camRestore(r) {
    var p = str(r && r.q && r.q.at).split(",").map(Number);
    if (p.length !== 3 || !p.every(isFinite) || !M.cam || p[2] <= 0) return false;
    M.camReady = false; M.cam.centerOn(p[0], p[1], Math.max(0.05, Math.min(4, p[2])), false); M.camReady = true;
    return true;
  }

  /** With a filter on, open a drawing framed on the parts that match (when some do and some do not). */
  function frameMatches() {
    var m = S.st && hasFilters(S.st.f) ? matchFor(S, "element") : null;
    if (!m || !M.D || !M.cam) return;
    var ns = M.D.nodes.filter(function (n) { return !n.stub && !n.portal && m.has(n.id); });
    if (!ns.length || ns.length === M.D.nodes.length) return;
    var x0 = Math.min.apply(null, ns.map(function (n) { return n.x; })) - 30, y0 = Math.min.apply(null, ns.map(function (n) { return n.y; })) - 30;
    var x1 = Math.max.apply(null, ns.map(function (n) { return n.x + n.w; })) + 30, y1 = Math.max.apply(null, ns.map(function (n) { return n.y + n.h; })) + 30;
    var c = M.cam.size(), k = Math.max(0.6, Math.min(1.25, Math.min(c.w / (x1 - x0), c.h / (y1 - y0))));
    M.camReady = false; M.cam.centerOn((x0 + x1) / 2, (y0 + y1) / 2, k, false); M.camReady = true;
  }

  /** Fade what the filter leaves out, and say so over the canvas. */
  function filterLine() {
    var svg = $("canvas") && $("canvas").querySelector("svg");
    var m = fadeDrawing(S, svg), host = $("canvas-filter");
    if (!host) return;
    if (!m || !M.D) { host.hidden = true; host.textContent = ""; return; }
    var ids = M.D.nodes.filter(function (n) { return !n.stub && !n.portal; }).map(function (n) { return n.id; });
    var n = ids.filter(function (id) { return m.has(id); }).length;
    host.hidden = false;
    host.textContent = n ? PROSE.sentence(PROSE.fmt(n) + " of the " + PROSE.count(ids.length, "part") + " drawn match the filters; the rest are faded") : "None of the " + PROSE.count(ids.length, "part") + " drawn match the filters. Remove a chip above, or open another view.";
  }

  /** The route of what the canvas shows now, without a selection. */
  function here() { return M.mode === "focus" ? R.focus(M.focus, M.depth) : M.mode === "zone" ? R.zone(M.zone) : R.view(M.view); }

  function nodeBox(id) { return M.D ? M.D.nodes.filter(function (n) { return n.id === id; })[0] : null; }
  function centerNode(id, animate, k) {
    var n = nodeBox(id); if (!n || !M.cam) return;
    var c = M.cam.size();
    var x = n.x + n.w / 2, y = n.y + n.h / 2;
    var sx = x * M.cam.k + M.cam.tx, sy = y * M.cam.k + M.cam.ty;
    if (!k && sx > 40 && sx < c.w - 40 && sy > 30 && sy < c.h - 30) return;
    M.cam.centerOn(x, y, k || Math.max(M.cam.k, 1), animate);
  }

  function updateMinimap() {
    var mm = $("minimap"), btn = $("mini-btn");
    if (!mm || !M.cam || !M.D) return;
    var on = M.minimap === "on" || (M.minimap === "auto" && M.cam.oversized());
    if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
    mm.hidden = !on;
    if (!on) return;
    if (!mm.firstChild) {
      mm.innerHTML = minimapSvg(ix, M.D);
      var move = function (ev) {
        var r = mm.getBoundingClientRect(), s = M.D.width / r.width;
        M.cam.centerOn((ev.clientX - r.left) * s, (ev.clientY - r.top) * s, M.cam.k, false);
      };
      var down = false;
      mm.addEventListener("pointerdown", function (ev) { down = true; ev.stopPropagation(); try { mm.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } move(ev); });
      mm.addEventListener("pointermove", function (ev) { if (down) move(ev); });
      mm.addEventListener("pointerup", function () { down = false; });
    }
    var vp = mm.querySelector(".vp"), c = M.cam.size();
    if (vp) {
      vp.setAttribute("x", r1(-M.cam.tx / M.cam.k)); vp.setAttribute("y", r1(-M.cam.ty / M.cam.k));
      vp.setAttribute("width", r1(c.w / M.cam.k)); vp.setAttribute("height", r1(c.h / M.cam.k));
    }
  }

  function applyHighlight() {
    var svg = $("canvas") && $("canvas").querySelector("svg");
    if (!svg) return;
    $$(".node", svg).forEach(function (g) { g.classList.toggle("sel", g.getAttribute("data-id") === M.sel); });
    if (M.hover) dimTo(svg, oneHop(svg, M.hover), M.hover);
    else if (S.tourHighlight && S.tourHighlight.size) dimTo(svg, S.tourHighlight);
    else dimTo(svg, null);
  }

  function inspector() {
    if (!insp) return;
    if (M.mode === "elements" || M.mode === "matrix") { insp.innerHTML = '<p class="empty">Select a part to see its owner, relationships, contracts and the units that change it.</p>'; return; }
    insp.innerHTML = M.sel ? elementDetail(ix, M.sel, { close: true }) : M.mode === "focus" ? elementDetail(ix, M.focus) : M.mode === "zone" ? zoneIntro(ix, M.zone) : viewIntro(ix, M.view);
  }

  function select(id, opts) {
    opts = opts || {};
    M.sel = id;
    S.setSelection(id ? { kind: "element", id: id } : null, true);
    applyHighlight();
    inspector();
    if (id && opts.center) centerNode(id, true, opts.k);
    if (id && !isWide(720) && opts.scroll) { var h2 = insp.querySelector("h2"); if (h2 && h2.scrollIntoView) h2.scrollIntoView({ block: "start" }); }
  }

  var handlers = {
    activate: function (id, node) {
      if (node && node.hasAttribute("data-portal")) { S.go(R.zone(node.getAttribute("data-portal"))); return; }
      if (node && node.getAttribute("data-stub")) { (M.expanded || (M.expanded = new Set())).add(node.getAttribute("data-stub")); draw(true); return; }
      if (M.sel === id && M.mode === "focus" && id !== M.focus) { S.go(R.focus(id, M.depth)); return; }
      S.go(R.element(id), { replace: true, quiet: true });
      select(id, { scroll: true, center: true });
    },
    dbl: function (id, node) { if (node && (node.getAttribute("data-stub") || node.hasAttribute("data-portal"))) return; S.go(R.focus(id, M.depth)); },
    background: function () { if (M.sel) { select(null); S.go(here(), { replace: true, quiet: true }); } },
    hover: function (id) { if (M.hover === id) return; M.hover = id; applyHighlight(); },
    key: function (ev) { nodeKeys(ev); }
  };

  function nodeKeys(ev) {
    var canvas = $("canvas"), svg = canvas && canvas.querySelector("svg"), cam = M.cam;
    if (!svg || !cam) return;
    var k = ev.key, node = ev.target.closest && ev.target.closest(".node");
    var chooser = canvas.querySelector(".chooser");
    if (chooser && chooser.contains(ev.target)) {
      if (k === "Escape") { chooser.remove(); if (node) node.focus(); else { var back = svg.querySelector('.node[tabindex="0"]'); if (back) back.focus(); } ev.preventDefault(); }
      else if (k === "ArrowDown" || k === "ArrowUp") { var bs = $$("button", chooser), i = bs.indexOf(document.activeElement); bs[(i + (k === "ArrowDown" ? 1 : -1) + bs.length) % bs.length].focus(); ev.preventDefault(); }
      return;
    }
    var step = 60, done = true;
    if (ev.shiftKey && k.indexOf("Arrow") === 0) {
      if (k === "ArrowLeft") cam.panBy(step, 0); else if (k === "ArrowRight") cam.panBy(-step, 0); else if (k === "ArrowUp") cam.panBy(0, step); else cam.panBy(0, -step);
    } else if (k === "+" || k === "=") zoomKey(1.25);
    else if (k === "-" || k === "_") zoomKey(0.8);
    else if (k === "0") cam.fitAll();
    else if (!node) done = false;
    else {
      var id = node.getAttribute("data-id");
      if (k === "Enter" || k === " ") handlers.activate(id, node);
      else if (k === "f" || k === "F") { if (!node.getAttribute("data-stub") && !node.hasAttribute("data-portal")) S.go(R.focus(id, M.depth)); }
      else if (k === "ArrowRight" || k === "ArrowLeft") {
        var out = k === "ArrowRight", targets = [];
        $$(".edge", svg).forEach(function (g) { if (g.getAttribute(out ? "data-from" : "data-to") === id) targets.push(g.getAttribute(out ? "data-to" : "data-from")); });
        targets = targets.filter(function (t, i) { return targets.indexOf(t) === i && t !== id; });
        if (targets.length === 1) moveFocus(targets[0]);
        else if (targets.length > 1) openChooser(node, targets, out);
        else S.announce("No " + (out ? "outgoing" : "incoming") + " relationship from here");
      } else if (k === "ArrowUp" || k === "ArrowDown") {
        var me = nodeBox(id), best = null, bd = 1e9;
        M.D.nodes.forEach(function (n) {
          if (n.id === id || !me) return;
          var sameCol = Math.abs((n.x + n.w / 2) - (me.x + me.w / 2)) < Math.max(me.w, n.w) / 2;
          var dy = n.y - me.y;
          if ((k === "ArrowDown" ? dy <= 0 : dy >= 0)) return;
          var dist = Math.abs(dy) + (sameCol ? 0 : 10000 + Math.abs(n.x - me.x));
          if (dist < bd) { bd = dist; best = n.id; }
        });
        if (best) moveFocus(best);
      } else if (k === "Home") { var f = svg.querySelector(".node"); if (f) moveFocus(f.getAttribute("data-id")); }
      else if (k === "Escape") {
        if (M.mode === "focus") { S.go(M.fromView ? R.view(M.fromView) : "#model"); }
        else { var tb = $("zoom-out"); if (tb) tb.focus(); }
      } else done = false;
    }
    if (done) ev.preventDefault();
  }
  function zoomKey(f) {
    var cam = M.cam, c = cam.size(), n = nodeBox(M.sel);
    if (n) cam.zoomAt(f, (n.x + n.w / 2) * cam.k + cam.tx, (n.y + n.h / 2) * cam.k + cam.ty); else cam.zoomAt(f, c.w / 2, c.h / 2);
  }
  function moveFocus(id) {
    var svg = $("canvas").querySelector("svg");
    var g = svg.querySelector('.node[data-id="' + cssEscape(id) + '"]');
    if (!g) return;
    $$('.node[tabindex="0"]', svg).forEach(function (x) { x.setAttribute("tabindex", "-1"); });
    g.setAttribute("tabindex", "0");
    g.focus({ preventScroll: true });
    centerNode(id, true);
  }
  function openChooser(node, targets, out) {
    var canvas = $("canvas");
    var old = canvas.querySelector(".chooser"); if (old) old.remove();
    var r = node.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    var div = document.createElement("div");
    div.className = "chooser"; div.setAttribute("role", "menu"); div.setAttribute("aria-label", (out ? "Follow a relationship to" : "Follow a relationship from") + ", " + targets.length + " parts");
    div.innerHTML = targets.map(function (t) { var e = ix.el.get(t); return '<button type="button" role="menuitem" data-go="' + esc(t) + '">' + esc(e ? e.name : t) + "</button>"; }).join("");
    div.style.left = Math.max(4, Math.min(cr.width - 200, r.right - cr.left + 6)) + "px";
    div.style.top = Math.max(4, Math.min(cr.height - 40, r.top - cr.top)) + "px";
    canvas.appendChild(div);
    div.addEventListener("click", function (ev) { var b = ev.target.closest("[data-go]"); if (b) { div.remove(); moveFocus(b.getAttribute("data-go")); } });
    div.querySelector("button").focus();
  }

  function wireToolbar() {
    var ls = $("lens-select");
    if (ls) ls.addEventListener("change", function () { S.lens = ls.value; S.save(); draw(true); });
    var kb = $("kinds-btn"), km = $("kinds-menu");
    if (kb && km) {
      kb.addEventListener("click", function () { var open = km.hidden; km.hidden = !open; kb.setAttribute("aria-expanded", open ? "true" : "false"); if (open) { var f = km.querySelector("input"); if (f) f.focus(); } });
      km.addEventListener("change", function (ev) {
        var t = ev.target; if (!t || !t.getAttribute) return;
        var set = t.getAttribute("data-kind-group") === "el" ? S.hiddenElKinds : S.hiddenRelKinds;
        if (t.checked) set.delete(t.value); else set.add(t.value);
        draw(true);
        var b2 = $("kinds-btn"), m2 = $("kinds-menu"); if (b2 && m2) { m2.hidden = false; b2.setAttribute("aria-expanded", "true"); var again = m2.querySelector('input[value="' + cssEscape(t.value) + '"]'); if (again) again.focus(); }
      });
      km.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { km.hidden = true; kb.setAttribute("aria-expanded", "false"); kb.focus(); ev.stopPropagation(); } });
    }
    var kr = $("kinds-reset"); if (kr) kr.addEventListener("click", function () { S.hiddenElKinds.clear(); S.hiddenRelKinds.clear(); draw(true); });
    $$("[data-depth]", area).forEach(function (b) { b.addEventListener("click", function () { S.go(R.focus(M.focus, Number(b.getAttribute("data-depth")))); }); });
    var oz = $("other-zones"); if (oz) oz.addEventListener("change", function () { M.otherZones = oz.checked; draw(); });
    var xc = $("show-cross"); if (xc) xc.addEventListener("change", function () { M.showCross = xc.checked; var svg = $("canvas") && $("canvas").querySelector("svg"); if (svg) svg.classList.toggle("show-cross", M.showCross); });
    var zi = $("zoom-in"), zo = $("zoom-out"), fa = $("fit-all"), mb = $("mini-btn");
    if (zi) zi.addEventListener("click", function () { zoomKey(1.25); });
    if (zo) zo.addEventListener("click", function () { zoomKey(0.8); });
    if (fa) fa.addEventListener("click", function () { M.cam.fitAll(); });
    if (mb) mb.addEventListener("click", function () { var on = mb.getAttribute("aria-pressed") === "true"; M.minimap = on ? "off" : "on"; updateMinimap(); });
    var tw = $("twin");
    if (tw) tw.addEventListener("click", function (ev) {
      var tr = ev.target.closest && ev.target.closest("tr[data-twin]");
      if (!tr || (ev.target.closest && ev.target.closest("a"))) return;
      S.go(R.element(tr.getAttribute("data-twin")));
    });
  }

  function showMode(mode) {
    M.mode = mode;
    $("diagram-area").hidden = mode === "elements" || mode === "matrix";
    $("model-elements").hidden = mode !== "elements";
    $("model-matrix").hidden = mode !== "matrix";
    $("model-layout").classList.toggle("no-insp", mode === "elements" || mode === "matrix");
    railMark();
  }

  function elementsList() {
    var rows = $$("#element-rows tr"), t = $("el-text"), k = $("el-kind"), z = $("el-zone"), o = $("el-owner");
    var apply = function () {
        var q = (t && t.value || "").toLowerCase().split(/\s+/).filter(Boolean), shown = 0, m = matchFor(S, "element");
        rows.forEach(function (tr) {
          var d = tr.dataset, ok = (!m || m.has(tr.getAttribute("data-element"))) && focusKeeps(S, "element", tr.getAttribute("data-element"));
          if (k && k.value && d.kind !== k.value) ok = false;
          if (ok && z && z.value && d.zone !== z.value) ok = false;
          if (ok && o && o.value && (o.value === "__none" ? d.owner !== "" : d.owner !== o.value)) ok = false;
          if (ok && q.length) ok = q.every(function (w) { return (d.text || "").indexOf(w) >= 0; });
          tr.hidden = !ok; if (ok) shown++;
        });
        var c = $("el-count"); if (c) c.textContent = shown === rows.length ? plural(shown, "part") : shown ? "Showing " + shown + " of " + rows.length : filteredNote(S, "element", 0, rows.length);
        var he = $("h-all-el");
        if (he) he.textContent = cap1(listHeading(S, "element", shown, "All parts", {
          f: { kind: k && k.value ? [k.value] : [], zone: z && z.value ? [z.value] : [], owner: o && o.value ? [o.value === "__none" ? NONE : o.value] : [] },
          more: [q.length ? "matching " + PROSE.quote(q.join(" ")) : ""]
        }));
    };
    if (!M.elWired) {
      M.elWired = true;
      [t, k, z, o].forEach(function (x) { if (x) x.addEventListener(x === t ? "input" : "change", apply); });
      sortable($("el-table"));
      $("el-table").addEventListener("click", function (ev) { var tr = ev.target.closest && ev.target.closest("tr[data-element]"); if (tr && !(ev.target.closest && ev.target.closest("a"))) S.openDrawer("element", tr.getAttribute("data-element"), tr); });
    }
    apply();
    rows.forEach(function (tr) { tr.classList.toggle("sel", tr.getAttribute("data-element") === M.sel); });
  }

  /** The zone (or system) matrix. Counts only relationships whose both ends match the filters; a zone's name opens its scene. */
  function matrix() {
    var host = $("matrix-area"), s = ix.b.summary;
    if (!host || !s) return;
    var m = matchFor(S, "element"), sig = m ? Array.from(m).join("|") : "";
    if (host.firstChild && host._sig === sig) return;
    host._sig = sig;
    var gs = arr(s.groups), cell = new Map(), max = 0;
    arr(s.edges).forEach(function (e) {
      var rels = m ? arr(e.relationships).filter(function (rid) { var r = ix.rel.get(rid); return r && m.has(r.from) && m.has(r.to); }) : arr(e.relationships);
      var x = { from: e.from, to: e.to, count: rels.length, relationships: rels };
      cell.set((e.from || "") + ">" + (e.to || ""), x); max = Math.max(max, x.count);
    });
    var lvl = function (n) { return !n ? 0 : n / max > 0.66 ? 4 : n / max > 0.33 ? 3 : n / max > 0.12 ? 2 : 1; };
    var head = function (g) { var zid = g.id || NONE; return s.by === "zone" && ix.zoneScene.has(zid) ? '<a href="' + R.zone(zid) + '" data-zone-open="' + esc(zid) + '">' + esc(g.name) + "</a>" : esc(g.name); };
    host.innerHTML = (m ? '<p class="small filter-line" style="margin-bottom:8px">' + esc(PROSE.sentence("Counting only relationships whose two ends match the filters")) + "</p>" : "")
      + '<div class="matrix-wrap"><table class="matrix"><caption class="sr-only">Relationship counts between ' + esc(s.by) + "s</caption><thead><tr><td></td>" + gs.map(function (g) { return '<th scope="col">' + head(g) + "</th>"; }).join("") + "</tr></thead><tbody>"
      + gs.map(function (a) { return '<tr><th scope="row">' + head(a) + "</th>" + gs.map(function (b) {
        var e = cell.get((a.id || "") + ">" + (b.id || "")), n = e ? e.count : 0;
        return '<td><button type="button" class="cell" data-l="' + lvl(n) + '" data-cell="' + esc((a.id || "") + ">" + (b.id || "")) + '" aria-pressed="false" aria-label="' + esc(a.name + " to " + b.name + ": " + plural(n, "relationship")) + '"' + (n ? "" : " disabled") + ">" + (n || "&#183;") + "</button></td>"; }).join("") + "</tr>"; }).join("")
      + '</tbody></table></div><div id="matrix-list" class="section" aria-live="polite"></div>';
    host._cell = cell;
    if (host._wired) return;
    host._wired = true;
    host.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-cell]"); if (!b) return;
      $$("[data-cell]", host).forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      var e = host._cell.get(b.getAttribute("data-cell")); if (!e) return;
      var name = function (id) { var g = gs.filter(function (x) { return (x.id || "") === id; })[0]; return g ? g.name : id; };
      $("matrix-list").innerHTML = '<h3 style="font-size:var(--fs-md)">' + esc(name(e.from || "") + " to " + name(e.to || "")) + ' <span class="muted">' + e.count + '</span></h3><ul class="rows">' + arr(e.relationships).map(function (rid) {
        var r = ix.rel.get(rid); return r ? "<li>" + elLink(ix, r.from) + ' <span aria-hidden="true">&#8594;</span><span class="sr-only">to</span> ' + elLink(ix, r.to) + ' <span class="tag">' + esc(r.kind) + "</span>" + (r.label ? ' <span class="muted small">' + esc(r.label) + "</span>" : "") + "</li>" : "";
      }).join("") + "</ul>";
    });
  }

  return {
    show: function (r) {
      var redraw = false, keep = false;
      if (r.sub === "elements") { showMode("elements"); elementsList(); inspector(); return; }
      if (r.sub === "matrix") { showMode("matrix"); matrix(); inspector(); return; }
      if (r.sub === "zone") {
        var zid = ix.zoneScene.has(r.id) ? r.id : r.id === "__none" ? NONE : r.id;
        if (M.mode !== "zone" || M.zone !== zid) { M.zone = zid; M.sel = null; redraw = true; }
        showMode("zone");
      } else if (r.sub === "focus") {
        if (M.mode !== "focus" || M.focus !== r.id || (M.depth || 1) !== (r.depth || 1)) {
          if (M.mode !== "focus") { M.fromView = M.view; M.trail = []; M.expanded = new Set(); }
          if (M.focus !== r.id) { M.trail = (M.trail || []).filter(function (t) { return t !== r.id; }); M.trail.push(r.id); M.expanded = new Set(); }
          M.focus = r.id; M.depth = r.depth || 1; M.sel = null; redraw = true;
        }
        showMode("focus");
      } else if (r.sub === "element") {
        var order = new Map(); arr(ix.b.viewGroups).forEach(function (g) { arr(g.views).forEach(function (v) { order.set(v, order.size); }); });
        var views = (ix.viewsByEl.get(r.id) || []).slice().sort(function (a, b) { return (order.has(a) ? order.get(a) : 1e6) - (order.has(b) ? order.get(b) : 1e6); });
        if (!ix.el.has(r.id)) { showMode("view"); if (!M.view) M.view = firstView(); redraw = true; }
        else if ((M.mode === "focus" || M.mode === "zone") && M.D && M.D.nodes.some(function (n) { return n.id === r.id; })) { /* stay in the neighbourhood or the zone */ }
        else if (views.length) { var target = views.indexOf(M.view) >= 0 ? M.view : views[0]; if (M.mode !== "view" || target !== M.view) { M.view = target; redraw = true; } showMode("view"); }
        else { M.fromView = M.view; M.focus = r.id; M.depth = 1; M.trail = [r.id]; M.expanded = new Set(); showMode("focus"); redraw = true; }
        M.sel = ix.el.has(r.id) ? r.id : null;
      } else {
        var vid = r.sub === "view" && ix.view.has(r.id) ? r.id : (M.mode === "view" && M.view ? M.view : firstView());
        if (M.mode !== "view" || vid !== M.view) { M.view = vid; redraw = true; }
        if (r.sub === "view") M.sel = M.sel && arr((ix.view.get(vid) || {}).elements).indexOf(M.sel) >= 0 ? M.sel : null;
        showMode("view");
      }
      var drew = redraw || !M.D || !$("canvas");
      if (drew) draw(keep); else { applyHighlight(); }
      if (drew && r.q && r.q.at) camRestore(r);
      else if (drew && !M.sel) frameMatches();
      filterLine();
      focusDrawing(S, $("canvas") && $("canvas").querySelector("svg"));
      inspector();
      if (M.sel) { S.setSelection({ kind: "element", id: M.sel }, true); centerNode(M.sel, !redraw); }
    },
    refresh: function (fresh) { if (M.mode === "view" || M.mode === "focus" || M.mode === "zone") { draw(!fresh); if (fresh && M.sel) centerNode(M.sel, false); } },
    resize: function () { if ((M.mode === "view" || M.mode === "focus" || M.mode === "zone") && M.cam) { var c = $("canvas"); if (c && M.D) { if (M.D.stream) M.cam.fitWidth(); else M.cam.readable(); updateMinimap(); } } },
    highlight: applyHighlight,
    state: function () { return M; },
    centerNode: centerNode,
    /** Frame a set of parts (a tour step's highlight): their bounding box, at a scale between 0.4 and 1.25. */
    fitTo: function (ids) {
      if (!M.D || !M.cam) return;
      var ns = M.D.nodes.filter(function (n) { return ids.has(n.id); });
      if (!ns.length) return;
      var x0 = Math.min.apply(null, ns.map(function (n) { return n.x; })) - 30, y0 = Math.min.apply(null, ns.map(function (n) { return n.y; })) - 30;
      var x1 = Math.max.apply(null, ns.map(function (n) { return n.x + n.w; })) + 30, y1 = Math.max.apply(null, ns.map(function (n) { return n.y + n.h; })) + 30;
      var c = M.cam.size(), k = Math.max(0.6, Math.min(1.25, Math.min(c.w / (x1 - x0), c.h / (y1 - y0))));
      M.cam.centerOn((x0 + x1) / 2, (y0 + y1) / 2, k, true);
    }
  };
}

/** Sortable table headers (buttons with aria-sort). Sorting moves rows; it never re-renders them. */
function sortable(table) {
  if (!table || table._sortable) return;
  table._sortable = true;
  table.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("button.sort"); if (!b) return;
    var col = Number(b.getAttribute("data-sort-col")), th = b.closest("th");
    var dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
    $$("th", table).forEach(function (x) { if (x.hasAttribute("aria-sort")) x.setAttribute("aria-sort", "none"); });
    th.setAttribute("aria-sort", dir);
    var tb = table.tBodies[0], rows = Array.prototype.slice.call(tb.rows);
    var val = function (tr) { var c = tr.cells[col]; if (!c) return ""; return c.hasAttribute("data-sort") ? Number(c.getAttribute("data-sort")) : (c.textContent || "").trim(); };
    rows.sort(function (a, b2) { var x = val(a), y = val(b2); var r = typeof x === "number" && typeof y === "number" ? x - y : natural(x, y); return dir === "ascending" ? r : -r; });
    rows.forEach(function (tr) { tb.appendChild(tr); });
  });
}

// ---------- Plan ----------
function planPage(S) {
  var P = S.plan || (S.plan = {});
  var ix = S.ix;
  var rows = $$("#unit-rows tr");
  var F = { text: $("f-text"), gate: $("f-gate"), state: $("f-state"), kind: $("f-kind"), owner: $("f-owner"), el: $("f-el"), cap: $("f-cap") };
  function apply() {
    var q = (F.text && F.text.value || "").toLowerCase().split(/\s+/).filter(Boolean), shown = 0;
    var m = matchFor(S, "unit"), fz = focusSet(S, "unit"), ff = focusNow(S);
    rows.forEach(function (tr) {
      var d = tr.dataset, ok = (!m || m.has(tr.getAttribute("data-unit"))) && (!fz || fz.has(tr.getAttribute("data-unit")));
      focusLabel(tr.querySelector('td[data-label="Unit"]'), focusUnitWords(ix, ff, tr.getAttribute("data-unit")));
      if (F.gate && F.gate.value && d.gate !== F.gate.value) ok = false;
      if (ok && F.state && F.state.value && d.state !== F.state.value) ok = false;
      if (ok && F.kind && F.kind.value && d.kind !== F.kind.value) ok = false;
      if (ok && F.owner && F.owner.value && (" " + d.owner + " ").indexOf(" " + F.owner.value + " ") < 0) ok = false;
      if (ok && F.el && F.el.value && (" " + d.els + " ").indexOf(" " + F.el.value + " ") < 0) ok = false;
      if (ok && F.cap && F.cap.value && (" " + d.missing + " ").indexOf(" " + F.cap.value + " ") < 0) ok = false;
      if (ok && q.length) ok = q.every(function (w) { return (d.text || "").indexOf(w) >= 0; });
      tr.hidden = !ok; if (ok) shown++;
    });
    var c = $("unit-count"); if (c) c.textContent = shown === rows.length ? plural(shown, "unit") : "Showing " + shown + " of " + plural(rows.length, "unit");
    var hu = $("h-units");
    if (hu) {
      var elName = F.el && F.el.value ? (ix.el.get(F.el.value) || {}).name || F.el.value : "";
      hu.textContent = cap1(listHeading(S, "unit", shown, "All work", {
        f: { milestone: F.gate && F.gate.value ? [F.gate.value] : [], status: F.state && F.state.value ? [F.state.value] : [], kind: F.kind && F.kind.value ? [F.kind.value] : [], owner: F.owner && F.owner.value ? [F.owner.value] : [] },
        more: [elName ? "changing " + elName : "", F.cap && F.cap.value ? "waiting on " + F.cap.value : "", q.length ? "matching " + PROSE.quote(q.join(" ")) : ""]
      }));
    }
    var none = $("unit-none"); if (none) { none.hidden = shown !== 0; none.textContent = m ? filteredNote(S, "unit", 0, rows.length) : "No units match these filters. Clear the form above to see every unit."; }
    $$("#can-list > li, #can-moving > li").forEach(function (li) { var a2 = li.querySelector("[data-unit]"), uid = a2 && a2.getAttribute("data-unit"); li.hidden = !!a2 && ((!!m && !m.has(uid)) || (!!fz && !fz.has(uid))); if (a2) focusLabel(a2.querySelector(".meta"), focusUnitWords(ix, ff, uid)); });
    var canNone = $("can-none"); if (canNone) canNone.hidden = (!m && !fz) || $$("#can-list > li").some(function (li) { return !li.hidden; });
    $$(".chain [data-unit]").forEach(function (x) { var uid = x.getAttribute("data-unit"); x.classList.toggle("f-out", !!m && !m.has(uid)); x.classList.toggle("fz-out", !!fz && !fz.has(uid)); });
    $$("#plan-shape g.u").forEach(function (x) { var uid = x.getAttribute("data-u"); x.classList.toggle("f-out", (!!m && !m.has(uid)) || (!!fz && !fz.has(uid))); });
  }
  if (!P.wired) {
    P.wired = true;
    Object.keys(F).forEach(function (k) { if (F[k]) F[k].addEventListener(k === "text" ? "input" : "change", apply); });
    var form = $("unit-filters"); if (form) form.addEventListener("reset", function () { setTimeout(apply, 0); });
    sortable($("units-table"));
    $("units-table") && $("units-table").addEventListener("click", function (ev) { var tr = ev.target.closest && ev.target.closest("tr[data-unit]"); if (tr && !(ev.target.closest && ev.target.closest("a"))) S.openDrawer("unit", tr.getAttribute("data-unit"), tr); });
    var box = $("plan-shape-box");
    if (box) { if (isWide(960)) box.open = true; box.addEventListener("toggle", function () { if (box.open) shape(); }); }
  }
  function filterTo(f) {
    Object.keys(F).forEach(function (k) { if (F[k]) F[k].value = ""; });
    if (f.gate && F.gate) F.gate.value = f.gate;
    if (f.el && F.el) F.el.value = f.el;
    apply();
    var h = $("h-units"); if (h && h.scrollIntoView) h.scrollIntoView({ block: "start", behavior: S.reduce ? "auto" : "smooth" });
  }
  function marks() {
    var sel = S.sel && S.sel.kind === "element" ? S.sel.id : null;
    var touching = new Set(sel ? (ix.unitsByEl.get(sel) || []).map(function (x) { return x.unit; }) : []);
    rows.forEach(function (tr) { tr.classList.toggle("marked", touching.has(tr.getAttribute("data-unit"))); tr.classList.toggle("sel", tr.getAttribute("data-unit") === P.unit); });
    $$("#can-list [data-unit], #can-moving [data-unit]").forEach(function (a) { a.classList.toggle("marked", touching.has(a.getAttribute("data-unit"))); a.classList.toggle("sel", a.getAttribute("data-unit") === P.unit); });
    var chip = $("can-chip");
    if (chip) chip.innerHTML = sel && touching.size ? '<p class="small" style="margin-bottom:8px">' + plural(touching.size, "unit") + " change " + esc((ix.el.get(sel) || {}).name || sel) + ' (marked). <button type="button" class="btn quiet" id="filter-sel">Filter to this element</button></p>' : "";
    var fs = $("filter-sel"); if (fs) fs.addEventListener("click", function () { filterTo({ el: sel }); });
  }
  function shape() {
    var host = $("plan-shape"); if (!host || host.getAttribute("data-drawn")) return;
    host.setAttribute("data-drawn", "1");
    host.innerHTML = planShape(ix, !isWide(720));
    var m0 = matchFor(S, "unit"); $$("g.u", host).forEach(function (x) { x.classList.toggle("f-out", !!m0 && !m0.has(x.getAttribute("data-u"))); });
    host.addEventListener("mouseover", function (ev) { var g = ev.target.closest && ev.target.closest("g.u"); if (g) shapeHi(host, g); });
    host.addEventListener("focusin", function (ev) { var g = ev.target.closest && ev.target.closest("g.u"); if (g) shapeHi(host, g); });
    host.addEventListener("mouseleave", function () { shapeHi(host, null); });
    host.addEventListener("click", function (ev) { var g = ev.target.closest && ev.target.closest("g.u"); if (g) S.go(R.unit(g.getAttribute("data-u"))); });
    host.addEventListener("keydown", function (ev) { var g = ev.target.closest && ev.target.closest("g.u"); if (g && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); S.go(R.unit(g.getAttribute("data-u"))); } });
  }
  function shapeHi(host, g) {
    var deps = g ? arr(ix.analysis.deps && ix.analysis.deps[g.getAttribute("data-u")]) : [];
    $$("g.u", host).forEach(function (x) { x.classList.toggle("dep", deps.indexOf(x.getAttribute("data-u")) >= 0); });
  }
  return {
    show: function (r) {
      var aside = $("unit-aside"), layout = $("plan-layout"), main = layout && layout.querySelector(".plan-main");
      P.unit = r.sub === "unit" ? r.id : null;
      $$("[data-gate-panel]").forEach(function (p) { p.hidden = !(r.sub === "milestone" && p.getAttribute("data-gate-panel") === r.id); });
      $$(".road a[data-gate]").forEach(function (a) { if (r.sub === "milestone" && a.getAttribute("data-gate") === r.id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
      if (P.unit) {
        var wide = isWide(1200);
        $("unit-detail").innerHTML = (wide ? "" : '<a class="back-link" href="#plan">&#8592; All of the plan</a>') + unitDetail(ix, P.unit, { close: wide ? "#plan" : null });
        aside.hidden = false; layout.classList.toggle("has-detail", wide);
        if (main) main.hidden = !wide;
        S.setSelection({ kind: "unit", id: P.unit }, true);
      } else { aside.hidden = true; layout.classList.remove("has-detail"); if (main) main.hidden = false; }
      if (r.sub === "milestone") { var gp = document.querySelector('[data-gate-panel="' + cssEscape(r.id) + '"]'); if (gp && gp.scrollIntoView) gp.scrollIntoView({ block: "nearest" }); }
      var box = $("plan-shape-box"); if (box && box.open) shape();
      apply();
      marks();
    },
    marks: marks,
    filterTo: filterTo
  };
}

/** The plan's shape: one dot per unit in its pull layer, shaded by milestone, with the critical path drawn through it. */
function planShape(ix, vertical) {
  var a = ix.analysis || {}, layers = arr(a.layers);
  var done = Array.from(ix.unit.values()).filter(function (u) { return u.status === "done"; }).map(function (u) { return u.id; });
  var cols = (done.length ? [{ head: "Done", ids: done }] : []).concat(layers.map(function (l, i) { return { head: String(i + 1), ids: arr(l) }; }));
  if (!cols.length) return '<p class="empty">No units.</p>';
  var maxN = Math.max.apply(null, cols.map(function (c) { return c.ids.length; }));
  var avail = Math.max(280, (document.documentElement.clientWidth || 360) - 64);
  var sp = vertical ? Math.max(9, Math.min(14, Math.floor((avail - 40) / Math.max(1, maxN)))) : 14, dot = Math.min(10, sp - 3), cw = vertical ? 20 : 26;
  var pos = new Map(), out = [], labels = [];
  cols.forEach(function (c, ci) {
    labels.push(vertical
      ? '<text x="0" y="' + (28 + ci * cw + 4) + '">' + esc(c.head) + '</text><text x="' + (40 + c.ids.length * sp + 4) + '" y="' + (28 + ci * cw + 4) + '">' + c.ids.length + "</text>"
      : '<text x="' + (40 + ci * cw) + '" y="14" text-anchor="middle">' + esc(c.head) + '</text><text x="' + (40 + ci * cw) + '" y="28" text-anchor="middle">' + c.ids.length + "</text>");
    c.ids.forEach(function (id, j) {
      var u = ix.unit.get(id); if (!u) return;
      var x = vertical ? 40 + j * sp + sp / 2 : 40 + ci * cw, y = vertical ? 28 + ci * cw : 44 + j * sp;
      pos.set(id, [x, y]);
      var s = unitState(ix, u), gi = Math.min(5, Math.max(1, milestoneIndex(ix, u.phase) + 1));
      var fill = s === "done" || s === "doing" ? "var(--gate)" : s === "ready" ? "var(--bg-surface)" : "var(--bg-surface)";
      var inner = s === "ready" ? '<circle cx="' + x + '" cy="' + y + '" r="' + (dot / 4) + '" fill="var(--gate)"></circle>' : "";
      out.push('<g class="u g' + gi + '" data-u="' + esc(id) + '" tabindex="0" role="link" aria-label="' + esc(id + ", " + u.title + ", " + UNIT_WORD[s] + ", " + milestoneLabel(ix, u.phase)) + '"><circle class="dot" cx="' + x + '" cy="' + y + '" r="' + (dot / 2) + '" fill="' + fill + '" stroke="var(--gate)"' + (s === "blocked" || s === "noprov" ? ' stroke-dasharray="2 1.5"' : "") + "></circle>" + inner + "<title>" + esc(id + " " + u.title + " (" + UNIT_WORD[s] + ")") + "</title></g>");
    });
  });
  var cp = arr(a.critical_path).map(function (id) { return pos.get(id); }).filter(Boolean);
  var line = cp.length > 1 ? '<polyline class="cp" points="' + cp.map(function (p) { return p[0] + "," + p[1]; }).join(" ") + '"></polyline>' : "";
  var W = vertical ? 40 + maxN * sp + 40 : 40 + cols.length * cw + 20, H = vertical ? 28 + cols.length * cw + 10 : 44 + maxN * sp + 10;
  return '<p class="small fg2" style="margin-bottom:8px">' + (vertical ? "Each row" : "Each column") + " can start once the " + (vertical ? "row" : "column") + " before it is done. Filled: done or in progress; ringed: ready; dashed: blocked. The dark line is the critical path.</p>"
    + '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Plan shape: ' + esc(plural(layers.length, vertical ? "row" : "column")) + ", largest with " + maxN + ' units. The units table below lists every unit.">' + labels.join("") + line + out.join("") + "</svg>"
    + '<div class="legend">' + ix.phaseOrder.map(function (p, i) { return '<span class="g' + Math.min(5, i + 1) + '"><i class="swatch" style="background:var(--gate);border-color:var(--gate)"></i>' + esc(milestoneLabel(ix, p.id)) + "</span>"; }).join("") + "</div>";
}

// ---------- Checks ----------
function checksPage(S) {
  var C = S.checks || (S.checks = { f: { sev: new Set(), pack: new Set(), kind: new Set() } });
  var ix = S.ix, page = $("checks");
  if (!C.wired) {
    C.wired = true;
    var bar = $("check-filters"); if (bar) bar.hidden = false;
    $$("[data-f]", bar).forEach(function (b) {
      b.addEventListener("click", function () {
        var set = C.f[b.getAttribute("data-f")], v = b.getAttribute("data-v");
        if (set.has(v)) set.delete(v); else set.add(v);
        b.setAttribute("aria-pressed", set.has(v) ? "true" : "false");
        apply();
      });
    });
    var sp = $("show-passing");
    page.classList.add("hide-passing");
    if (sp) sp.addEventListener("change", function () { page.classList.toggle("hide-passing", !sp.checked); });
  }
  function apply() {
    var f = C.f, shownRules = 0, m = matchFor(S, "finding");
    $$(".rule", page).forEach(function (r) {
      var sev = r.getAttribute("data-sev"), rk = r.getAttribute("data-rule"), pack = rk.split("/")[0], kinds = (r.getAttribute("data-kinds") || "").split(" ");
      var ok = (!f.sev.size || f.sev.has(sev)) && (!f.pack.size || f.pack.has(pack)) && (!f.kind.size || kinds.some(function (k) { return f.kind.has(k); }));
      var any = 0;
      $$(".subjects li", r).forEach(function (li) {
        var at = li.getAttribute("data-at") || "", id = rk + "@" + at.slice(at.indexOf(":") + 1);
        li.hidden = (f.kind.size ? !f.kind.has(li.getAttribute("data-kind")) : false) || (!!m && !m.has(id)) || !focusKeeps(S, "finding", id);
        if (!li.hidden) any++;
      });
      if ((m || focusNow(S)) && !any) ok = false;
      r.style.display = ok ? "" : "none";
      if (ok && sev !== "pass") shownRules++;
    });
    var fn = $("checks-filtered"); if (fn) { fn.hidden = !m; if (m) fn.textContent = m.size ? PROSE.sentence(cap1(listHeading(S, "finding", m.size, "")) + ", of " + PROSE.count(arr(ix.b.findings).length, "finding") + " in all") : filteredNote(S, "finding", 0, arr(ix.b.findings).length); }
    $$(".pack", page).forEach(function (p) { p.hidden = !$$(".rule", p).some(function (r) { return r.style.display !== "none" && (r.getAttribute("data-sev") !== "pass" || !page.classList.contains("hide-passing")); }); });
  }
  function pinned() {
    var host = $("checks-pinned"); if (!host) return;
    var sel = S.sel;
    var fs = sel ? (ix.findingsAt.get(sel.kind + ":" + sel.id) || []) : [];
    $$(".subjects li", page).forEach(function (li) { li.classList.toggle("pinned", !!sel && li.getAttribute("data-at") === sel.kind + ":" + sel.id); });
    if (!sel || !fs.length) { host.innerHTML = ""; return; }
    var name = sel.kind === "element" ? (ix.el.get(sel.id) || {}).name : sel.kind === "unit" ? sel.id : sel.id;
    host.innerHTML = '<div class="callout info" style="margin-bottom:var(--sp-4)">' + icon("info") + "<div><b>" + esc(name || sel.id) + "</b> (selected) has " + plural(fs.length, "finding") + ":" + findingsList(ix, sel.kind, sel.id) + "</div></div>";
  }
  return {
    show: function (r) {
      apply(); pinned();
      if (matchFor(S, "finding")) page.classList.add("hide-passing");
      var target = null;
      if (r.sub === "rule") target = document.getElementById("rule-" + (r.pack + "-" + r.id).replace(/\s/g, "_"));
      else if (r.sub === "legacy-rule") target = document.getElementById("rule-" + r.id.replace(/\s/g, "_"));
      else if (r.sub === "pack") target = document.getElementById("pack-" + r.id.replace(/\s/g, "_"));
      if (target) {
        if (target.tagName === "DETAILS") { target.open = true; target.style.display = ""; if (target.classList.contains("passing")) { page.classList.remove("hide-passing"); var sp = $("show-passing"); if (sp) sp.checked = true; } }
        if (target.scrollIntoView) target.scrollIntoView({ block: "start" });
        S.tourTarget(target);
      }
    },
    pinned: pinned
  };
}

// ---------- Changes ----------
function changesPage(S) {
  var C = S.changes || (S.changes = { filter: null });
  var ix = S.ix;
  var rows = $$("[data-patch-row]"), details = $$(".patch[data-patch]");
  var proposed = rows.filter(function (r) { return r.getAttribute("data-status") === "proposed"; }).length;
  if (C.filter == null) C.filter = proposed ? "proposed" : "all";
  function applyFilter() {
    var shown = 0;
    var m = matchFor(S, "patch");
    // a status chip (from the Overview's bars) decides the status; the page's own buttons then show every status
    if (m && appliedFilters(ix, "patch", S.st.f).applied.status) C.filter = "all";
    rows.forEach(function (r) { var ok = (C.filter === "all" || r.getAttribute("data-status") === C.filter) && (!m || m.has(r.getAttribute("data-patch-row"))) && focusKeeps(S, "patch", r.getAttribute("data-patch-row")); r.hidden = !ok; if (ok) shown++; });
    $$("[data-pf]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-pf") === C.filter ? "true" : "false"); });
    var none = $("patch-none"); if (none) { none.hidden = shown > 0; if (m && !shown) none.textContent = filteredNote(S, "patch", 0, rows.length); }
    var pfl = $("patch-filtered"); if (pfl) { pfl.hidden = !m; if (m) pfl.textContent = cap1(listHeading(S, "patch", shown, "", { f: { status: C.filter === "all" ? [] : [C.filter] } })); }
  }
  if (!C.wired) {
    C.wired = true;
    var pf = $("patch-filter"); if (pf) pf.hidden = false;
    $$("[data-pf]").forEach(function (b) { b.addEventListener("click", function () { C.filter = b.getAttribute("data-pf"); applyFilter(); }); });
    details.forEach(function (d) { review(d); });
  }
  function review(d) {
    var box = d.querySelector("[data-review]"); if (!box) return;
    var id = d.getAttribute("data-patch"), hash = d.getAttribute("data-hash"), key = "de-reviewed:" + location.pathname + ":" + id;
    var cb = box.querySelector("[data-review-box]"), note = box.querySelector("[data-review-note]");
    var saved = null; try { saved = localStorage.getItem(key); } catch (e) { saved = null; }
    box.hidden = false;
    cb.checked = saved === hash;
    if (saved && saved !== hash) note.textContent = "Changed since you reviewed it";
    cb.addEventListener("change", function () {
      try { if (cb.checked) localStorage.setItem(key, hash); else localStorage.removeItem(key); } catch (e) { /* storage unavailable: the toggle still works for this visit */ }
      note.textContent = cb.checked ? "Reviewed on this device" : "";
    });
  }
  function drawBA(d) {
    var host = d.querySelector("[data-ba]"); if (!host || host.getAttribute("data-drawn")) return;
    host.setAttribute("data-drawn", "1");
    var p = ix.patch.get(d.getAttribute("data-patch")), dr = p && p.impact && p.impact.drawing;
    if (!dr) return;
    var extraEls = new Map(), extraRels = new Map();
    Object.keys((p.impact.records) || {}).forEach(function (k) {
      var s = p.impact.records[k];
      if (s.kind === "element" && !ix.el.has(s.id)) extraEls.set(s.id, { id: s.id, name: s.name, kind: "part" });
      if (s.kind === "relationship" && !ix.rel.has(s.id)) extraRels.set(s.id, { id: s.id, from: s.from, to: s.to, kind: s.relKind, label: s.label });
    });
    if (dr.change) { drawChange(d, host, p, dr, extraEls, extraRels); return; }
    var make = function (side, other) {
      var keepN = new Set(dr[side].elements), keepR = new Set(dr[side].relationships);
      var hideN = new Set(arr(dr.layout.nodes).map(function (n) { return n.id; }).filter(function (id) { return !keepN.has(id); }));
      var hideR = new Set(arr(dr.layout.edges).map(function (e) { return e.id; }).filter(function (id) { return !keepR.has(id); }));
      var D = fromLayout(ix, dr.layout, { hideNodes: hideN, hideRels: hideR, extraEls: extraEls, extraRels: extraRels });
      var nm = new Map(), em = new Map(), otherR = new Set(dr[other].relationships);
      if (side === "before") dr.removed.forEach(function (id) { nm.set(id, "removed"); });
      else { dr.added.forEach(function (id) { nm.set(id, "added"); }); dr.changed.forEach(function (id) { nm.set(id, "changed"); }); }
      keepR.forEach(function (id) { if (!otherR.has(id)) em.set(id, side === "before" ? "removed" : "added"); });
      return renderDiagram(ix, D, { prefix: "ba-" + slug(p.id) + "-" + side, fixed: true, scale: 0.9, marks: { nodes: nm, edges: em }, crop: crop });
    };
    // Both drawings show one window: the changed parts and their neighbours, so a large view still shows the change at a readable size.
    var changedIds = new Set([].concat(dr.added, dr.removed, dr.changed));
    arr(dr.layout.edges).forEach(function (e) { if (dr.before.relationships.indexOf(e.id) < 0 || dr.after.relationships.indexOf(e.id) < 0) { changedIds.add(e.from); changedIds.add(e.to); } });
    var near = new Set(changedIds);
    arr(dr.layout.edges).forEach(function (e) { if (changedIds.has(e.from)) near.add(e.to); if (changedIds.has(e.to)) near.add(e.from); });
    // the window: the parts the patch adds, removes or changes (else the ends of the relationships it changes), padded
    var core = new Set([].concat(dr.added, dr.removed, dr.changed));
    if (!core.size) core = changedIds;
    var crop = null, boxes = arr(dr.layout.nodes).filter(function (n) { return core.has(n.id); });
    if (boxes.length && (dr.layout.width > 900 || dr.layout.height > 520)) {
      var pad = 170;
      var x0 = Math.max(0, Math.min.apply(null, boxes.map(function (n) { return n.x; })) - pad), y0 = Math.max(0, Math.min.apply(null, boxes.map(function (n) { return n.y; })) - pad * 0.7);
      var x1 = Math.min(dr.layout.width, Math.max.apply(null, boxes.map(function (n) { return n.x + n.w; })) + pad), y1 = Math.min(dr.layout.height, Math.max.apply(null, boxes.map(function (n) { return n.y + n.h; })) + pad * 0.7);
      crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      var inside = arr(dr.layout.nodes).filter(function (n) { return n.x + n.w > x0 && n.x < x1 && n.y + n.h > y0 && n.y < y1; });
      // widen the window to whole boxes, so no name is cut at its edge
      inside.forEach(function (n) { x0 = Math.min(x0, n.x - 12); x1 = Math.max(x1, n.x + n.w + 12); y0 = Math.min(y0, n.y - 12); y1 = Math.max(y1, n.y + n.h + 12); });
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(dr.layout.width, x1); y1 = Math.min(dr.layout.height, y1);
      crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      near = new Set(inside.map(function (n) { return n.id; }));
    }
    var b = make("before", "after"), a = make("after", "before");
    host.innerHTML = '<figure><figcaption>Before ' + esc(p.id) + '</figcaption><div class="frame">' + b.svg + '</div></figure><figure><figcaption>After ' + esc(p.id) + '</figcaption><div class="frame">' + a.svg + "</div></figure>"
      + '<div class="legend" style="grid-column:1/-1">' + (crop ? '<span class="muted">Showing the area around the change: ' + near.size + " of " + plural(arr(dr.layout.nodes).length, "part") + " in the view</span>" : "") + a.legend + "</div>";
  }
  /**
   * One merged drawing of the change: the changed parts and their direct neighbours on
   * one layout of both states. Change shows removed parts struck and dashed red, added ones green; Before and After
   * hide what the other state lacks, on the same coordinates, so nothing moves between them.
   */
  function drawChange(d, host, p, dr, extraEls, extraRels) {
    var ch = dr.change, L = ch.layout;
    if (ch.narrow && (host.clientWidth || 600) < ch.layout.width * 0.8) L = ch.narrow;
    var remN = new Set(arr(dr.removed).concat(arr(p.impact.removed).filter(function (t) { return t.kind === "element"; }).map(function (t) { return t.id; })));
    var addN = new Set(arr(dr.added).concat(arr(p.impact.added).filter(function (t) { return t.kind === "element"; }).map(function (t) { return t.id; })));
    var chgN = new Set(arr(dr.changed).concat(arr(p.impact.modified).filter(function (t) { return t.kind === "element"; }).map(function (t) { return t.id; })));
    var remR = new Set(arr(ch.removedRelationships)), addR = new Set(arr(ch.addedRelationships));
    var render = function (mode) {
      var hideN = new Set(mode === "before" ? Array.from(addN) : mode === "after" ? Array.from(remN) : []);
      var hideR = new Set(mode === "before" ? Array.from(addR) : mode === "after" ? Array.from(remR) : []);
      var D = fromLayout(ix, L, { hideNodes: hideN, hideRels: hideR, extraEls: extraEls, extraRels: extraRels });
      var nm = new Map(), em = new Map();
      if (mode !== "after") remN.forEach(function (id) { nm.set(id, "removed"); });
      if (mode !== "before") { addN.forEach(function (id) { nm.set(id, "added"); }); chgN.forEach(function (id) { if (!addN.has(id) && !remN.has(id)) nm.set(id, "changed"); }); }
      D.edges.forEach(function (e) { var k = e.ids.some(function (id) { return remR.has(id); }) ? "removed" : e.ids.some(function (id) { return addR.has(id); }) ? "added" : ""; if (k && !(mode === "after" && k === "removed") && !(mode === "before" && k === "added")) em.set(e.id, k); });
      var frameW = host.clientWidth || 600;
      var scale = Math.max(0.8, Math.min(1.1, (frameW - 2) / Math.max(1, L.width)));
      // Before draws the before side's flow values and findings; Change and After draw the patch's after side
      var sides = ch.sides, side = sides ? (mode === "before" ? sides.before : sides.after) : null;
      var out = renderDiagram(ix, D, { prefix: "ba-" + slug(p.id) + "-" + mode, fixed: true, scale: scale, level: "mid", marks: { nodes: nm, edges: em }, side: side });
      host.innerHTML = '<figure><figcaption class="sr-only">' + esc(mode === "before" ? "Before " + p.id : mode === "after" ? "After " + p.id : "The change " + p.id + " makes") + '</figcaption><div class="frame">' + out.svg + "</div></figure>"
        + '<div class="legend">' + out.legend + "</div>";
    };
    render("change");
    var seg = d.querySelector("[data-ba-mode]");
    if (seg) {
      seg.hidden = false;
      seg.addEventListener("click", function (ev) {
        var btn = ev.target.closest && ev.target.closest("[data-mode]"); if (!btn) return;
        $$("[data-mode]", seg).forEach(function (x) { x.setAttribute("aria-pressed", x === btn ? "true" : "false"); });
        render(btn.getAttribute("data-mode"));
      });
    }
  }
  return {
    show: function (r) {
      applyFilter();
      var id = r.sub === "patch" ? r.id : null;
      var wide = isWide(960);
      if (!id && wide) { var first = rows.filter(function (x) { return !x.hidden; })[0] || rows[0]; id = first ? first.getAttribute("data-patch-row") : null; }
      details.forEach(function (d) { d.hidden = d.getAttribute("data-patch") !== id; });
      rows.forEach(function (x) { if (x.getAttribute("data-patch-row") === id) x.setAttribute("aria-current", "true"); else x.removeAttribute("aria-current"); });
      var list = document.querySelector(".changes-list"); if (list) list.hidden = !wide && !!(r.sub === "patch");
      if (r.sub === "patch" && !wide) { var cur = details.filter(function (d) { return !d.hidden; })[0]; if (cur && !cur.querySelector(".back-link")) cur.insertAdjacentHTML("afterbegin", '<a class="back-link" href="#changes">&#8592; All patches</a>'); }
      var d = details.filter(function (x) { return !x.hidden; })[0];
      if (d) drawBA(d);
      marks();
    },
    marks: marks
  };
  function marks() {
    var sel = S.sel;
    rows.forEach(function (r) {
      var ps = sel ? (ix.patchesAt.get(sel.kind + ":" + sel.id) || []) : [];
      r.classList.toggle("marked", ps.indexOf(r.getAttribute("data-patch-row")) >= 0);
    });
  }
}

// ---------- Tracker ----------
function trackerPageCtl(S) {
  var T = S.tracker || (S.tracker = {});
  if (!T.wired) {
    T.wired = true;
    var low = document.querySelector("[data-low-conf]");
    if (low) low.addEventListener("change", function () { $$("[data-low]").forEach(function (m) { m.hidden = !low.checked; }); });
  }
  return {
    show: function (r) {
      var step = r.sub || (r.sub === undefined && r.id ? "match" : "match");
      if (r.sub === "anchor") step = ["status", "proposed", "no-issue", "no-unit", "phase", "deps", "linked", "problems"].indexOf(r.id) >= 0 ? "match" : "match";
      $$("[data-tr-step]").forEach(function (p) { p.hidden = p.getAttribute("data-tr-step") !== step; });
      $$(".stepper a").forEach(function (a) { if (a.getAttribute("data-step") === step) a.setAttribute("aria-current", "step"); else a.removeAttribute("aria-current"); });
      if (r.sub === "anchor") { var t = document.getElementById("tracker-" + r.id); if (t) { var d = t.querySelector("details"); if (d) d.open = true; if (t.scrollIntoView) t.scrollIntoView({ block: "start" }); } }
      // a group named in the route (#tracker/match/status, from the Overview): opened, and the router scrolls to it
      if (r.sub === "match" && r.id) { var g = document.getElementById("tracker-" + r.id); var gd = g && g.querySelector("details"); if (gd) gd.open = true; }
    }
  };
}

// ---------- Overview landscape ----------
function landscape(S) {
  var host = $("landscape");
  if (!host || host.getAttribute("data-drawn")) return;
  var D = summaryDiagram(S.ix);
  if (!D) { host.hidden = true; return; }
  host.setAttribute("data-drawn", "1");
  var out = renderDiagram(S.ix, D, { prefix: "land", lens: "zone" });
  host.innerHTML = out.svg;
  host.setAttribute("role", "group"); host.setAttribute("aria-roledescription", "diagram");
  host.setAttribute("aria-label", "System at a glance: " + plural(D.nodes.length, "box") + ". Tab to a box and press Enter to open its view.");
  host.insertAdjacentHTML("afterend", '<div class="legend">' + out.legend + "</div>");
  var lk = Math.max(0.85, Math.min(1.25, ((host.clientWidth || 600) / D.width) * 0.96));
  host.style.height = Math.round(Math.max(200, Math.min(460, D.height * lk + 48))) + "px";
  var svg = host.querySelector("svg");
  var cam = new Camera(host, svg, D.width, D.height, { reduce: S.reduce });
  host._cam = cam; cam.readable();
  focusDrawing(S, svg);
  $$(".node", svg).forEach(function (g, i) { if (i === 0) g.setAttribute("tabindex", "0"); });
  var open = function (id) {
    var g = arr(S.ix.b.summary.groups).filter(function (x) { return (x.id || "__none") === id; })[0];
    if (S.ix.b.summary.by === "zone" && S.ix.zoneScene.has(id === "__none" ? NONE : id)) S.go(R.zone(id === "__none" ? NONE : id));
    else if (g && g.view) S.go(R.view(g.view)); else S.go("#model/elements");
  };
  attachCanvas(host, S, {
    activate: function (id) { open(id); },
    hover: function (id) { dimTo(svg, id ? oneHop(svg, id) : null, id); },
    key: function (ev) {
      var node = ev.target.closest && ev.target.closest(".node");
      var nodes = $$(".node", svg), i = nodes.indexOf(node);
      if (node && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); open(node.getAttribute("data-id")); }
      else if (node && (ev.key === "ArrowRight" || ev.key === "ArrowDown" || ev.key === "ArrowLeft" || ev.key === "ArrowUp")) {
        ev.preventDefault();
        var n = nodes[(i + (ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : -1) + nodes.length) % nodes.length];
        nodes.forEach(function (x) { x.setAttribute("tabindex", "-1"); }); n.setAttribute("tabindex", "0"); n.focus({ preventScroll: true });
      } else if (ev.key === "0") cam.fitAll();
    }
  });
}

api.planShape = planShape;
