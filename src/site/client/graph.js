/* Plumb site client, part 2: diagrams.
   One renderer draws every diagram: curated views (laid out by core), the neighbourhood of one part (laid out here,
   with per-zone stubs beyond 40 nodes), the zone summary, and the before and after pair of a patch. Encodings use
   zone tint on the node, three shape cues (people as pills, stores with a double
   bottom rule, external systems dashed), line style by relationship kind, finding badges, and semantic zoom levels. */

var NODE = { charW: 7, padX: 10, lineH: 16, padY: 12, minW: 96, maxW: 200, maxLines: 3 };
var STUB_LIMIT = 40;
var EDGE_STYLE = { data: "data", control: "control", evidence: "evidence", feedback: "feedback", handoff: "handoff" };
var EDGE_WORD = { data: "Data (solid)", control: "Control (long dash)", evidence: "Evidence (dotted)", feedback: "Feedback (dashed)", handoff: "Handoff between two teams (thick, labelled with both)", other: "Other kinds (thin)" };

function nodeSize(name) {
  var L = NODE, n = str(name).length;
  var w = Math.max(L.minW, Math.min(L.maxW, Math.ceil(n * L.charW + 2 * L.padX)));
  var per = Math.max(1, Math.floor((w - 2 * L.padX) / L.charW));
  var lines = Math.max(1, Math.min(L.maxLines, Math.ceil(n / per)));
  return { w: w, h: lines * L.lineH + 2 * L.padY };
}

function wrapLabel(text, maxChars, maxLines) {
  var words = str(text).split(/\s+/).filter(Boolean), lines = [], cur = "";
  maxChars = Math.max(4, maxChars | 0); maxLines = Math.max(1, maxLines | 0);
  for (var i = 0; i < words.length; i++) {
    var w = words[i], next = cur ? cur + " " + w : w;
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

function midpoint(pts) {
  var total = 0, i, segs = [];
  for (i = 1; i < pts.length; i++) { var d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); total += d; }
  var half = total / 2;
  for (i = 1; i < pts.length; i++) {
    if (half <= segs[i - 1] || i === pts.length - 1) {
      var t = segs[i - 1] ? Math.min(1, half / segs[i - 1]) : 0;
      return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t, len: segs[i - 1] };
    }
    half -= segs[i - 1];
  }
  return { x: pts[0][0], y: pts[0][1], len: 0 };
}

/** The middle of the longest segment: where a label has the most room. */
function longestSeg(pts) {
  var best = 0, bi = 1;
  for (var i = 1; i < pts.length; i++) { var d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (d > best) { best = d; bi = i; } }
  return { x: (pts[bi - 1][0] + pts[bi][0]) / 2, y: (pts[bi - 1][1] + pts[bi][1]) / 2, len: best };
}
function edgeClass(kind) { return "ek-" + (EDGE_STYLE[kind] || "other"); }

// ---------- diagram data ----------
/** A diagram from a core layout: nodes, edges (parallel ones merged), bands. */
function fromLayout(ix, L, o) {
  o = o || {};
  var hideEl = o.hideNodes || null, hideRel = o.hideRels || null, relKinds = o.hiddenRelKinds || null, elKinds = o.hiddenElKinds || null;
  var nodes = [], drawn = new Set();
  arr(L && L.nodes).forEach(function (n) {
    if (!n || (hideEl && hideEl.has(n.id))) return;
    var e = ix.el.get(n.id) || (o.extraEls && o.extraEls.get(n.id)) || { id: n.id, name: n.id, kind: "unknown" };
    if (elKinds && elKinds.has(e.kind)) return;
    nodes.push({ id: n.id, x: num(n.x), y: num(n.y), w: Math.max(20, num(n.w, 120)), h: Math.max(16, num(n.h, 40)), el: e });
    drawn.add(n.id);
  });
  var edges = [];
  arr(L && L.edges).forEach(function (ed) {
    if (!ed || (hideRel && hideRel.has(ed.id))) return;
    var r = ix.rel.get(ed.id) || (o.extraRels && o.extraRels.get(ed.id)) || null;
    var from = r ? r.from : ed.from, to = r ? r.to : ed.to;
    if (!drawn.has(from) || !drawn.has(to)) return;
    var kind = r ? r.kind : "link";
    if (relKinds && relKinds.has(kind)) return;
    var pts = arr(ed.points).filter(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]); });
    if (pts.length < 2) return;
    edges.push({ id: ed.id, from: from, to: to, kind: kind, rel: r, points: pts });
  });
  return { width: Math.max(1, num(L && L.width, 400)), height: Math.max(1, num(L && L.height, 300)), nodes: nodes, edges: mergeParallel(edges), bands: arr(L && L.bands), stream: L && L.stream ? L.stream : null };
}

/** Relationships between the same pair, in the same direction, draw as one path with a count. */
function mergeParallel(edges) {
  var by = new Map(), out = [];
  edges.forEach(function (e) {
    var k = e.from + "\u0000" + e.to;
    if (!by.has(k)) { var m = { id: e.id, from: e.from, to: e.to, kind: e.kind, rel: e.rel, points: e.points, path: e.path, ids: [e.id], kinds: [e.kind], rels: [e.rel] }; by.set(k, m); out.push(m); }
    else { var x = by.get(k); x.ids.push(e.id); x.kinds.push(e.kind); x.rels.push(e.rel); }
  });
  return out;
}

/**
 * The neighbourhood of one part, laid out here as a two-sided tree: the focus in the
 * centre; parts that send to it on the left, parts it sends to on the right (the first hop); at depth 2, each
 * second-hop part sits beside the first-hop part that reaches it first (its parent on the shortest path back), so the
 * drawing reads as branches, not a mesh. Only those shortest-path lines are drawn at rest; every other link among the
 * drawn parts is kept as a hidden "cross" edge that a hover on either end, or the cross-links toggle, reveals, and each
 * part carries a "+k links" note for them. A parent shows at most FOCUS_CAP children, ranked by degree of interest
 * (findings, then degree), and a "+N more" stub that shows FOCUS_CAP more per activation (o.expanded holds the stub
 * keys). At depth 1 the links between neighbours are drawn, and beyond STUB_LIMIT neighbours a side collapses into
 * per-zone stubs as before.
 */
var FOCUS_CAP = 5;
function focusDiagram(ix, focusId, depth, o) {
  o = o || {};
  var focus = ix.el.get(focusId);
  if (!focus) return null;
  depth = depth === 2 ? 2 : 1;
  var relKinds = o.hiddenRelKinds || new Set(), elKinds = o.hiddenElKinds || new Set(), expanded = o.expanded || new Set();
  var okNode = function (e) { return e && !elKinds.has(e.kind) && (o.otherZones !== false || (e.zone || "") === (focus.zone || "")); };
  var hop = new Map([[focusId, 0]]), side = new Map([[focusId, 0]]), parent = new Map(), order = [];
  var visit = function (cur, d) {
    var take = function (r, other, s) {
      if (relKinds.has(r.kind) || other === cur || hop.has(other) || !okNode(ix.el.get(other))) return;
      hop.set(other, d + 1); side.set(other, d === 0 ? s : side.get(cur)); parent.set(other, cur); order.push(other);
    };
    (ix.inn.get(cur) || []).forEach(function (r) { take(r, r.from, -1); });
    (ix.out.get(cur) || []).forEach(function (r) { take(r, r.to, 1); });
  };
  visit(focusId, 0);
  if (depth === 2) order.filter(function (id) { return hop.get(id) === 1; }).sort(function (a, b) { return natural(ix.el.get(a).name, ix.el.get(b).name); }).forEach(function (p) { visit(p, 1); });
  var members = [focusId].concat(order);
  var inSet = new Set(members);
  var zoneOrder = function (id) { var i = ix.zoneIdx.get((ix.el.get(id) || {}).zone); return i == null ? 1e6 : i; };
  var byZoneName = function (a, b) { return zoneOrder(a) - zoneOrder(b) || natural(ix.el.get(a).name, ix.el.get(b).name); };
  var degree = function (id) { return (ix.out.get(id) || []).length + (ix.inn.get(id) || []).length; };
  var interest = function (id) { return (ix.findingsAt.get("element:" + id) || []).length * 100 + degree(id); };
  var zname = function (z) { var zz = ix.zone.get(z); return zz ? zz.name : "no zone"; };
  var stubOf = new Map(), stubs = [], hidden = new Set();
  // depth 1 at a hub: per-zone stubs on each side beyond STUB_LIMIT
  var hop1 = { "-1": [], "1": [] };
  order.forEach(function (id) { if (hop.get(id) === 1) hop1[side.get(id)].push(id); });
  [-1, 1].forEach(function (s) {
    var list = hop1[s];
    if (list.length <= STUB_LIMIT / 2) return;
    var zones = new Map(); list.forEach(function (id) { push(zones, (ix.el.get(id).zone || ""), id); });
    zones.forEach(function (ids, z) {
      var key = "z|" + s + "|" + z;
      if (ids.length < 2 || expanded.has(key)) return;
      ids.forEach(function (id) { hidden.add(id); });
      var st = { id: "stub:" + key, key: key, ids: ids, side: s, hop: 1, zone: z, label: "+" + ids.length + " in " + zname(z) };
      stubs.push(st); hop1[s].push(st.id); stubOf.set(st.id, st);
    });
    hop1[s] = hop1[s].filter(function (id) { return !hidden.has(id); });
  });
  // children per first-hop parent, capped by interest
  var kids = new Map();
  order.forEach(function (id) { if (hop.get(id) === 2) push(kids, parent.get(id), id); });
  kids.forEach(function (ids, p) {
    var pages = 0; expanded.forEach(function (k) { if (k.indexOf("p|" + p + "|") === 0) pages++; });
    var cap = FOCUS_CAP * (1 + pages);
    var ranked = ids.slice().sort(function (a, b) { return interest(b) - interest(a) || natural(ix.el.get(a).name, ix.el.get(b).name); });
    var shown = ranked.slice(0, cap), rest = ranked.slice(cap);
    if (rest.length === 1) { shown.push(rest[0]); rest = []; } // a stub for one part hides nothing worth hiding
    rest.forEach(function (id) { hidden.add(id); });
    var list = shown.sort(byZoneName);
    if (rest.length) {
      var zc = new Map(); rest.forEach(function (id) { var z = ix.el.get(id).zone || ""; zc.set(z, (zc.get(z) || 0) + 1); });
      var st = { id: "stub:p|" + p + "|" + cap, key: "p|" + p + "|" + cap, ids: rest, side: side.get(p), hop: 2, parent: p, label: "+" + rest.length + " more",
        zones: PROSE.list(Array.from(zc.keys()).sort(function (a, b) { return zc.get(b) - zc.get(a); }).map(function (z) { return zc.get(z) + " " + zname(z); }), { max: 2 }) };
      stubs.push(st); stubOf.set(st.id, st); list.push(st.id);
    }
    kids.set(p, list);
  });
  // sizes, by hop: the focus up to three lines, the first hop up to two, the second hop up to two in a narrower box
  var size = function (id) {
    var st = stubOf.get(id);
    if (st) return { w: st.hop === 2 ? 112 : 150, h: 34 };
    var e = ix.el.get(id), h = hop.get(id);
    var s = nodeSize(e.name);
    if (h === 0) return { w: Math.min(240, s.w + 24), h: s.h + 8 };
    var w = Math.min(h === 1 ? 200 : 168, s.w), lines = Math.min(2, Math.ceil(str(e.name).length / Math.max(1, Math.floor((w - 2 * NODE.padX) / NODE.charW))));
    return { w: w, h: Math.max(1, lines) * NODE.lineH + 2 * NODE.padY };
  };
  // links among the drawn parts: tree (child and its parent, hop 1 and the focus), peer (depth 1, between neighbours), cross (the rest)
  var drawnId = function (id) { return inSet.has(id) && !hidden.has(id) ? id : null; };
  var isTree = function (a, b) { return parent.get(a) === b || parent.get(b) === a; };
  var crossCount = new Map();
  var rels = [];
  members.forEach(function (id) {
    (ix.out.get(id) || []).forEach(function (r) {
      if (relKinds.has(r.kind) || !inSet.has(r.to) || r.from === r.to) return;
      var a = drawnId(r.from), b = drawnId(r.to);
      var tree = isTree(r.from, r.to);
      var cls = tree ? "tree" : depth === 1 ? "peer" : "cross";
      if (cls === "cross") { crossCount.set(r.from, (crossCount.get(r.from) || 0) + 1); crossCount.set(r.to, (crossCount.get(r.to) || 0) + 1); }
      if (!a || !b) return;
      rels.push({ r: r, a: a, b: b, cls: cls });
    });
  });
  // tree edges into a hidden child go to its stub, so the stub hangs off its parent
  stubs.forEach(function (st) {
    if (st.hop !== 2) return;
    rels.push({ r: null, a: st.parent, b: st.id, cls: "tree", stub: true });
  });
  stubs.forEach(function (st) {
    if (st.hop !== 1) return;
    rels.push({ r: null, a: st.side < 0 ? st.id : focusId, b: st.side < 0 ? focusId : st.id, cls: "tree", stub: true });
  });
  // layout: per side, a block per first-hop part holding its children, stacked; the focus centred
  var gapX = 72, gapY = 12, blockGap = 22, top = 24;
  var colW = { "-2": 0, "-1": 0, "0": 0, "1": 0, "2": 0 }, sizes = new Map();
  var colOf = function (id) { var st = stubOf.get(id); if (st) return st.side * st.hop; return (side.get(id) || 0) * (hop.get(id) || 0); };
  members.concat(stubs.map(function (s) { return s.id; })).forEach(function (id) {
    if (hidden.has(id)) return;
    var s = size(id); sizes.set(id, s); var c = colOf(id); colW[c] = Math.max(colW[c], s.w);
  });
  var note = function (id) { var k = crossCount.get(id) || 0; return depth === 2 && k && hop.get(id) === 2 ? 16 : 0; };
  var pos = new Map(), heights = {};
  [-1, 1].forEach(function (s) {
    var ps = hop1[String(s)].slice().sort(function (a, b) { return (stubOf.has(a) ? 1 : 0) - (stubOf.has(b) ? 1 : 0) || (stubOf.has(a) || stubOf.has(b) ? 0 : byZoneName(a, b)); });
    var y = top;
    ps.forEach(function (p) {
      var ch = kids.get(p) || [];
      var chH = ch.reduce(function (t, c) { return t + sizes.get(c).h + note(c); }, 0) + Math.max(0, ch.length - 1) * gapY;
      var ph = sizes.get(p).h + note(p), bh = Math.max(ph, chH);
      pos.set(p, { y: y + (bh - ph) / 2 });
      var cy = y + (bh - chH) / 2;
      ch.forEach(function (c) { pos.set(c, { y: cy }); cy += sizes.get(c).h + note(c) + gapY; });
      y += bh + blockGap;
    });
    heights[s] = ps.length ? y - blockGap : top;
  });
  var H = Math.max(heights["-1"], heights["1"], top + sizes.get(focusId).h);
  pos.set(focusId, { y: top + (H - top - sizes.get(focusId).h) / 2 });
  // columns left to right; a side with no second hop drops its outer column
  var x = 24, colX = {};
  [-2, -1, 0, 1, 2].forEach(function (c) { if (!colW[c]) return; colX[c] = x; x += colW[c] + gapX; });
  var nodes = [], box = new Map();
  pos.forEach(function (p, id) {
    var s = sizes.get(id), c = colOf(id), st = stubOf.get(id);
    if (!s || colX[c] == null) return;
    var nx = colX[c] + (c < 0 ? colW[c] - s.w : c > 0 ? 0 : (colW[c] - s.w) / 2); // hug the column edge nearest the focus
    var n = { id: id, x: Math.round(nx), y: Math.round(p.y), w: s.w, h: s.h, col: c, focus: id === focusId };
    if (st) { n.stub = { key: st.key, ids: st.ids, zone: st.zone }; n.label = st.label; n.el = { id: id, name: st.label, kind: "stub", zone: st.zone }; n.title = PROSE.sentence(st.label + (st.parent ? " linked to " + ix.el.get(st.parent).name : "") + (st.zones ? " (" + st.zones + ")" : "") + ": " + PROSE.list(st.ids.map(function (i) { return ix.el.get(i).name; }), { max: 12 })) + " Select to show them."; }
    else { n.el = ix.el.get(id); var k = crossCount.get(id) || 0; if (note(id)) n.note = "+" + PROSE.count(k, "link"); n.hop = hop.get(id); }
    nodes.push(n); box.set(id, n);
  });
  // edges: one path per pair and direction (parallel relationships merged with a count)
  var seen = new Map(), edges = [];
  rels.forEach(function (x) {
    var A = box.get(x.a), B = box.get(x.b);
    if (!A || !B) return;
    var k = x.a + "\u0000" + x.b;
    if (x.r && seen.has(k)) { var e0 = seen.get(k); e0.ids.push(x.r.id); e0.kinds.push(x.r.kind); e0.rels.push(x.r); return; }
    var rev = seen.has(x.b + "\u0000" + x.a) ? 5 : 0;
    var path, pts;
    if (A.col !== B.col) {
      var right = B.col > A.col;
      var sx = right ? A.x + A.w : A.x, sy = A.y + A.h / 2 + rev, tx = right ? B.x : B.x + B.w, ty = B.y + B.h / 2 + rev;
      var dx = Math.max(24, Math.abs(tx - sx) / 2) * (right ? 1 : -1);
      path = "M" + r1(sx) + " " + r1(sy) + " C" + r1(sx + dx) + " " + r1(sy) + " " + r1(tx - dx) + " " + r1(ty) + " " + r1(tx) + " " + r1(ty);
      pts = [[sx, sy], [tx, ty]];
    } else {
      var out = A.col <= 0 ? -1 : 1; // loop on the side away from the focus
      var ex = out < 0 ? A.x : A.x + A.w, ey = A.y + A.h / 2, fx = out < 0 ? B.x : B.x + B.w, fy = B.y + B.h / 2, bulge = 36 * out;
      path = "M" + r1(ex) + " " + r1(ey) + " C" + r1(ex + bulge) + " " + r1(ey) + " " + r1(fx + bulge) + " " + r1(fy) + " " + r1(fx) + " " + r1(fy);
      pts = [[ex, ey], [fx, fy]];
    }
    var e = { id: x.r ? x.r.id : "stub-edge:" + x.b, from: x.a, to: x.b, kind: x.r ? x.r.kind : "stub", rel: x.r, path: path, points: pts, ids: x.r ? [x.r.id] : [], kinds: x.r ? [x.r.kind] : [], rels: x.r ? [x.r] : [], cls: x.cls, label: x.r ? undefined : "" };
    if (x.r) seen.set(k, e);
    edges.push(e);
  });
  var cross = edges.filter(function (e) { return e.cls === "cross"; }).length;
  var hop2 = order.filter(function (id) { return hop.get(id) === 2; }).length;
  return { width: x - gapX + 24, height: H + 40, nodes: nodes, edges: edges, bands: [], focus: focusId, total: members.length,
    hop1: order.length - hop2, hop2: hop2, hiddenCount: hidden.size, cross: cross, depth: depth, collapsedCount: hidden.size };
}

/**
 * A zone's scene (core: bundle.zoneScenes): its parts and the relationships among them, plus one portal node per other
 * zone that relationships cross to or from, with a short dashed line from each part that crosses to its portal.
 */
function zoneDiagram(ix, scene, o) {
  if (!scene) return null;
  o = o || {};
  var D = fromLayout(ix, scene.layout, o);
  var drawn = new Set(D.nodes.map(function (n) { return n.id; }));
  arr(scene.portals).forEach(function (p) {
    var pid = "portal:" + p.dir + ":" + (p.zone == null ? NONE : p.zone);
    D.nodes.push({ id: pid, x: p.x, y: p.y, w: p.w, h: p.h, portal: p, el: { id: pid, name: p.name, kind: "portal", zone: p.zone } });
    arr(p.lines).forEach(function (ln) {
      if (!drawn.has(ln.part)) return;
      var out = p.dir === "out";
      var rels = arr(p.relationships).filter(function (rid) { var r = ix.rel.get(rid); return r && (out ? r.from : r.to) === ln.part; });
      D.edges.push({ id: "pl:" + pid + ":" + ln.part, from: out ? ln.part : pid, to: out ? pid : ln.part, kind: "portal", points: ln.points, ids: [], kinds: ["portal"], rels: [], label: "",
        title: PROSE.count(rels.length, "relationship") + (out ? " from " + ((ix.el.get(ln.part) || {}).name || ln.part) + " to " + p.name : " from " + p.name + " to " + ((ix.el.get(ln.part) || {}).name || ln.part)) });
    });
  });
  D.zone = scene.zone == null ? NONE : scene.zone;
  D.manyPortalLines = D.edges.filter(function (e) { return e.kind === "portal"; }).length > 16; // then they show on hover only
  return D;
}

/** The zone scene's scope sentence: what is drawn, and what the portals stand for. */
function zoneScope(ix, scene) {
  var n = arr(scene.layout && scene.layout.nodes).length;
  var outs = arr(scene.portals).filter(function (p) { return p.dir === "out"; }), ins = arr(scene.portals).filter(function (p) { return p.dir === "in"; });
  var sum = function (xs) { return xs.reduce(function (t, p) { return t + p.count; }, 0); };
  var parts = ["It holds " + PROSE.count(n, "part") + " and the " + PROSE.count(scene.relationships || 0, "relationship") + " among them"];
  if (outs.length || ins.length) parts.push("Doorways on the edges count what crosses its border: " + PROSE.list([outs.length ? PROSE.count(sum(outs), "relationship") + " " + PROSE.verb(sum(outs), "leaves", "leave") + " for " + PROSE.count(outs.length, "other zone") : "", ins.length ? PROSE.fmt(sum(ins)) + " " + PROSE.verb(sum(ins), "arrives", "arrive") + " from " + PROSE.count(ins.length, "zone") : ""]));
  else parts.push("No relationship crosses its border");
  if (outs.length || ins.length) parts.push("Select a doorway to open that zone");
  return PROSE.para(parts);
}

/** The neighbourhood's scope sentence. */
function focusScope(ix, D) {
  var e = ix.el.get(D.focus), name = e ? e.name : D.focus;
  var first = D.hop1 ? PROSE.count(D.hop1, "direct neighbour") : "no neighbours";
  var parts = [D.depth === 2 && D.hop2 ? name + " has " + first + " and " + PROSE.count(D.hop2, "more part") + " two steps away" + (D.hiddenCount ? ", " + PROSE.fmt(D.hiddenCount) + " of them behind “more” boxes" : "") : name + " has " + first];
  if (D.depth === 2 && D.hop2) parts.push("Each line is the shortest way back to it" + (D.cross ? "; hover a part for its other links" : ""));
  else if (D.hiddenCount) parts.push("Another " + PROSE.count(D.hiddenCount, "part") + " " + PROSE.verb(D.hiddenCount, "sits", "sit") + " in the zone boxes; select one to open it");
  parts.push("Double-click a part to centre on it");
  return PROSE.para(parts);
}

/** One box per zone (or system) from bundle.summary; edges carry counts by kind. */
function summaryDiagram(ix) {
  var s = ix.b.summary;
  if (!s || !s.layout) return null;
  var g = new Map(arr(s.groups).map(function (x) { return [x.id || "__none", x]; }));
  var nodes = arr(s.layout.nodes).map(function (n) {
    var grp = g.get(n.id) || { name: n.id, elements: [] };
    return { id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, group: grp, el: { id: n.id, name: grp.name, kind: s.by, zone: s.by === "zone" ? (n.id === "__none" ? null : n.id) : null }, sub: plural(arr(grp.elements).length, "part") };
  });
  // a ring edge "a~b" joins both directions; fold the directed counts together
  var edgeInfo = new Map();
  arr(s.edges).forEach(function (e) {
    if ((e.from || "") === (e.to || "")) return;
    var ab = [e.from || "__none", e.to || "__none"].sort(natural), k = ab[0] + "~" + ab[1];
    var x = edgeInfo.get(k) || { count: 0, kinds: {} };
    x.count += e.count; Object.keys(e.kinds || {}).forEach(function (kk) { x.kinds[kk] = (x.kinds[kk] || 0) + e.kinds[kk]; });
    edgeInfo.set(k, x);
  });
  var maxC = 1; edgeInfo.forEach(function (x) { maxC = Math.max(maxC, x.count); });
  var edges = arr(s.layout.edges).map(function (e) {
    var info = edgeInfo.get(e.id) || edgeInfo.get((e.from || "__none") + ">" + (e.to || "__none")) || { count: 0, kinds: {} };
    var ks = Object.keys(info.kinds || {}).sort(function (a, b) { return info.kinds[b] - info.kinds[a]; });
    var label = String(info.count);
    return { id: e.id, from: e.from, to: e.to, kind: "summary", points: e.points, label: label, title: plural(info.count, "relationship") + ": " + ks.map(function (k) { return k + " " + info.kinds[k]; }).join(", "), ids: [e.id], kinds: ["summary"], rels: [], count: info.count, weight: 1 + 3 * info.count / maxC };
  });
  return { width: s.layout.width, height: s.layout.height, nodes: nodes, edges: edges, bands: [], summary: true };
}

// ---------- rendering ----------
function lensClass(ix, e, lens, teamRank) {
  if (!e || e.kind === "stub") return "";
  if (lens === "owner") { var r = e.owner != null ? teamRank.get(e.owner) : undefined; return "l-o" + (r == null ? 0 : r); }
  if (lens === "fidelity") { var f = fidelityOf(ix, e.id); return f < 0 ? "l-o0" : "l-f" + Math.min(3, f); }
  if (lens === "findings") { var fs = ix.findingsAt.get("element:" + e.id) || []; return fs.some(function (x) { return x.severity === "error"; }) ? "l-err" : fs.length ? "l-warn" : "l-ok"; }
  if (lens === "plan") { var p = planStateOf(ix, e.id); return p ? "l-" + p : "l-ok"; }
  if (lens === "flow") { var fs0 = FLOWUI.step(ix.b, e.id), w = fs0 && fs0.wait ? fs0.wait.value : null; return w == null ? "l-w0" : w < 1 ? "l-w1" : w < 3 ? "l-w2" : w < 5 ? "l-w3" : "l-w4"; }
  var t = zoneTint(ix, e.zone); return t.cls + (t.hatch ? " hatch" : "");
}

/** Top five teams by part count in this drawing get a colour each; the rest share "Other". */
function teamRanks(ix, nodes) {
  var c = new Map();
  nodes.forEach(function (n) { if (n.el && n.el.owner) c.set(n.el.owner, (c.get(n.el.owner) || 0) + 1); });
  var top = Array.from(c.keys()).sort(function (a, b) { return c.get(b) - c.get(a) || natural(a, b); }).slice(0, 5);
  var m = new Map(); top.forEach(function (t, i) { m.set(t, i + 1); });
  return m;
}

/** Where an outside part lives (0.4): a design's title, or the shared layer. */
function homeOf(ix, e) { return (ix.b.instance.homes || {})[e.home] || e.home; }
/** Inside a portfolio, an outside part's home as a link to the part on that design's page; "" when its home has no page here. */
function homePage(ix, e) {
  var p = ix.b.portfolio, d = p && arr(p.designs).filter(function (x) { return x.namespace === e.home; })[0];
  if (!d) return "";
  var id = str(e.id).indexOf(e.home + ":") === 0 ? str(e.id).slice(e.home.length + 1) : str(e.id);
  return '<a href="' + esc(d.href + "#model/element/" + encodeURIComponent(id)) + '" data-raw>' + esc(d.title) + "</a>";
}
function nodeName(ix, n) {
  var e = n.el || {}, zz = e.zone ? ix.zone.get(e.zone) : null;
  var rels = (ix.out.get(e.id) || []).length + (ix.inn.get(e.id) || []).length;
  var fs = ix.findingsAt.get("element:" + e.id) || [];
  if (n.stub) return n.label + ". Activate to expand.";
  if (n.portal) return (n.portal.dir === "out" ? "Doorway to " : "Doorway from ") + n.portal.name + ", " + plural(n.portal.count, "relationship") + ". Activate to open that zone.";
  if (n.group) return e.name + ", " + n.sub + ". Activate to open its view.";
  var fb = FLOWUI.badges(ix.b, e.id).map(function (x) { return x.title.replace(/\.$/, ""); });
  var cur = currentOf(ix, e.id); // current state (0.4): today only, and discovered or confirmed
  return (e.name || e.id) + ", " + (e.kind || "part") + (e.home ? ", outside this design, in " + homeOf(ix, e) : "") + (e.todayOnly ? ", exists only today" : "") + (e.owner && ix.team.has(e.owner) ? ", owned by " + teamName(ix, e.owner) : "") + (zz ? ", zone " + zz.name : "") + ", " + plural(rels, "relationship") + (fs.length ? ", " + plural(fs.length, "finding") : "") + (cur ? ", current state " + (cur.state === "confirmed" ? "confirmed" : "discovered, not confirmed") : "") + (fb.length ? ". " + fb.join(". ") : "");
}

/**
 * Draw a diagram as SVG. o: prefix (unique per diagram, for marker ids), lens, marks {nodes: Map, edges: Map},
 * selected, highlight (Set of ids: dim the rest), fixed (true: a static picture with a viewBox and natural size).
 */
var DASH = ' style="stroke-dasharray:6 3"'; // an outside part's outline
var DOTS = ' style="stroke-dasharray:2 3"'; // a part that exists only today (0.4 current state)
function renderDiagram(ix, D, o) {
  o = o || {};
  var P = o.prefix || "dg", lens = o.lens || "zone";
  var marks = o.marks || {}, nm = marks.nodes || new Map(), em = marks.edges || new Map();
  var teamRank = lens === "owner" ? teamRanks(ix, D.nodes) : null;
  var parts = { bands: [], edges: [], labels: [], nodes: [] };
  var used = { edge: new Set(), shape: new Set(), lens: new Map(), badge: false, marks: new Set() };
  var sideB = o.side && o.side.flow && ix.b.flow ? { flow: Object.assign({}, ix.b.flow, { elements: o.side.flow }), model: ix.b.model } : null;
  // bands
  arr(D.bands).forEach(function (bd) {
    var t = zoneTint(ix, bd.zone), zz = bd.zone ? ix.zone.get(bd.zone) : null;
    parts.bands.push('<g class="band-g ' + t.cls + '" role="presentation"><rect class="band" x="0" y="' + r1(bd.y) + '" width="' + r1(D.width) + '" height="' + r1(bd.h) + '"></rect>'
      + '<line class="band-line" x1="0" x2="' + r1(D.width) + '" y1="' + r1(bd.y) + '" y2="' + r1(bd.y) + '"></line>'
      + '<text class="band-label" x="8" y="' + r1(bd.y + 16) + '">' + esc(zz ? zz.name : "No zone") + "</text></g>");
  });
  // edge labels never sit on one another or on a box, and never past the drawing's edge: each is nudged up or down
  // a line at a time, and one with nowhere to go is left to its line's tooltip
  var placed = D.nodes.filter(function (n) { return !n.group; }).map(function (n) { return { x0: n.x, y0: n.y, x1: n.x + n.w, y1: n.y + n.h }; });
  var hit = function (b) { return placed.some(function (p) { return b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0; }); };
  var place = function (x, y, w, h) {
    x = Math.max(w / 2 + 2, Math.min((D.width || x + w) - w / 2 - 2, x));
    var tries = [0, -12, 12, -24, 24, -36];
    for (var i = 0; i < tries.length; i++) { var b = { x0: x - w / 2, y0: y + tries[i] - h + 3, x1: x + w / 2, y1: y + tries[i] + 3 }; if (!hit(b)) { placed.push(b); return { x: x, y: y + tries[i] }; } }
    return null;
  };
  // edges
  D.edges.forEach(function (ed) {
    var cls = (D.summary ? "ek-data" : ed.kind === "stub" ? "ek-stub" : ed.kind === "portal" ? "ek-portal" : edgeClass(ed.kind)) + (ed.cls ? " " + ed.cls : "");
    if (!D.summary && ed.kind !== "stub" && ed.kind !== "portal" && ed.cls !== "cross") used.edge.add(EDGE_STYLE[ed.kind] || "other");
    if (ed.kind === "portal") used.portal = true;
    var mk = em.get(ed.id) || "";
    if (mk) used.marks.add(mk);
    var d = ed.path || ("M" + ed.points.map(function (p) { return r1(p[0]) + " " + r1(p[1]); }).join(" L"));
    var tip = ed.title || ed.ids.map(function (id, i) {
      var r = ed.rels[i];
      var fe = ix.el.get(ed.from), te = ix.el.get(ed.to);
      return (fe ? fe.name : ed.from) + " to " + (te ? te.name : ed.to) + " · " + (ed.kinds[i] || "") + (r && r.label ? ": " + r.label : "") + (r && arr(r.carries).length ? " · carries " + r.carries.map(function (c) { return plainRef(ix, c); }).join(", ") : "");
    }).join("\n");
    parts.edges.push('<g class="edge ' + cls + (mk ? " mark-" + mk : "") + '" data-edge="' + esc(ed.id) + '" data-from="' + esc(ed.from) + '" data-to="' + esc(ed.to) + '" aria-hidden="true">'
      + '<path class="line" d="' + d + '"' + (D.summary ? ' style="stroke-width:' + r1(ed.weight || 1) + 'px"' : ' marker-end="url(#' + P + '-ah)"') + '></path><path class="hit" d="' + d + '"></path><title>' + esc(tip) + "</title></g>");
    var mp = longestSeg(ed.points.length > 1 ? ed.points : [[0, 0], [0, 0]]);
    if (ed.path && ed.points.length === 2) mp = { x: (ed.points[0][0] + ed.points[1][0]) / 2, y: (ed.points[0][1] + ed.points[1][1]) / 2, len: 100 };
    var text = ed.label != null ? ed.label : (ed.rel ? (ed.rel.label || arr(ed.rel.carries).map(function (c) { return plainRef(ix, c); }).join(", ")) : "");
    var hopRel = ed.rels && ed.rels.filter(function (r) { return r && r.kind === "handoff"; })[0];
    var fe0 = hopRel && ix.el.get(hopRel.from), te0 = hopRel && ix.el.get(hopRel.to);
    if (hopRel && fe0 && te0 && fe0.owner && te0.owner && fe0.owner !== te0.owner && !D.summary) {
      // a handoff is labelled with its two teams, on two lines so it fits the gap between two boxes
      var t1 = teamName(ix, fe0.owner) + " \u2192", t2 = teamName(ix, te0.owner);
      var hp0 = ed.points.length === 2 && Math.abs(ed.points[0][1] - ed.points[1][1]) < 1 ? { x: (ed.points[0][0] + ed.points[1][0]) / 2, y: ed.points[0][1] - 22 } : { x: mp.x, y: mp.y - 17 };
      var hpw = Math.max(t1.length, t2.length) * 5.6 + 6, hp = place(hp0.x, hp0.y + 11, hpw, 22);
      hp = hp ? { x: hp.x, y: hp.y - 11 } : hp0; // a handoff's teams always show; the line's own label gives way
      if (hp) parts.labels.push('<text class="elabel hop" data-edge="' + esc(ed.id) + '" data-from="' + esc(ed.from) + '" data-to="' + esc(ed.to) + '" text-anchor="middle" aria-hidden="true"><tspan x="' + r1(hp.x) + '" y="' + r1(hp.y) + '">' + esc(t1) + '</tspan><tspan x="' + r1(hp.x) + '" y="' + r1(hp.y + 11) + '">' + esc(t2) + "</tspan></text>");
      used.hop = true;
      text = "";
    }
    if (text) {
      if (text.length > 28) text = text.slice(0, 27) + "…";
      var lp = place(mp.x, mp.y - 5, text.length * 5.6 + 6, 12);
      if (lp) parts.labels.push('<text class="elabel' + (ed.cls === "cross" ? " cross" : "") + '" data-edge="' + esc(ed.id) + '" data-from="' + esc(ed.from) + '" data-to="' + esc(ed.to) + '" x="' + r1(lp.x) + '" y="' + r1(lp.y) + '" text-anchor="middle" aria-hidden="true">' + esc(text) + "</text>");
    }
    if (ed.ids.length > 1) parts.labels.push('<text class="pcount' + (ed.cls === "cross" ? " cross" : "") + '" x="' + r1(mp.x) + '" y="' + r1(mp.y + 12) + '" text-anchor="middle" aria-hidden="true">×' + ed.ids.length + "</text>");
  });
  // nodes
  D.nodes.forEach(function (n) {
    if (n.portal) {
      var p = n.portal, pcx = r1(n.x + n.w / 2);
      parts.nodes.push('<g class="node portal dir-' + p.dir + '" data-id="' + esc(n.id) + '" data-portal="' + esc(p.zone == null ? NONE : p.zone) + '"' + (o.fixed ? "" : ' tabindex="-1" role="button"') + ' aria-label="' + esc(nodeName(ix, n)) + '">'
        + '<rect class="halo" x="' + r1(n.x - 3) + '" y="' + r1(n.y - 3) + '" width="' + r1(n.w + 6) + '" height="' + r1(n.h + 6) + '" rx="' + r1(n.h / 2 + 3) + '"></rect>'
        + '<rect class="box" x="' + r1(n.x) + '" y="' + r1(n.y) + '" width="' + r1(n.w) + '" height="' + r1(n.h) + '" rx="' + r1(n.h / 2) + '"></rect>'
        + '<text class="nl" text-anchor="middle"><tspan x="' + pcx + '" y="' + r1(n.y + 17) + '">' + esc((p.dir === "out" ? "\u2192 " : "\u2190 ") + clip(p.name, Math.max(8, Math.floor((n.w - 30) / 6.7)))) + '</tspan></text>'
        + '<text class="nk pk" text-anchor="middle" x="' + pcx + '" y="' + r1(n.y + 31) + '">' + esc(PROSE.count(p.count, "relationship") + (p.dir === "out" ? " out" : " in")) + "</text>"
        + "<title>" + esc(nodeName(ix, n)) + "</title></g>");
      return;
    }
    var e = n.el || { id: n.id, name: n.id, kind: "unknown" };
    var ks = slug(e.kind), x = n.x, y = n.y, w = n.w, h = n.h;
    var lc = n.stub ? "stub" : lensClass(ix, e, D.summary && lens !== "zone" ? "zone" : lens, teamRank);
    if (!n.stub) used.lens.set(lc.split(" ")[0], e);
    var person = ks === "person" || ks === "people";
    var store = ks === "store" || ks === "registry" || ks === "ledger" || ks === "database";
    var external = ks === "external-system" || ks === "external";
    if (person) used.shape.add("person"); if (store) used.shape.add("store"); if (external) used.shape.add("external");
    var rx = person ? Math.min(h / 2, 20) : 4;
    var mk = nm.get(n.id) || "";
    if (mk) used.marks.add(mk);
    var showKind = !n.stub && !n.group && h >= 40 && o.level !== "mid";
    var team = !n.stub && !n.group && e.owner && ix.team.has(e.owner) ? teamName(ix, e.owner) : "";
    if (e.home) { used.outside = true; team = homeOf(ix, e).replace(/^the /, ""); team = team[0].toUpperCase() + team.slice(1); }
    if (e.todayOnly && !n.stub && !n.group) { used.today = true; team = "Today only"; } // its kind line says so; the fill keeps the lens
    // a patch drawing passes one side's values (o.side): its badges and finding dots, not today's model
    var fb = !n.stub && !n.group && !n.portal ? FLOWUI.badges(sideB || ix.b, e.id) : [];
    var inBox = D.stream && fb.length; // a stream drawing leaves room in the box for its badges
    var bh = inBox ? fb.length * 18 : 0;
    var maxLines = Math.max(1, Math.floor((h - 14 - bh - (showKind || (D.stream && team) ? 12 : 0)) / 15));
    var lines = wrapLabel(e.name || e.id, Math.floor((w - 16) / 6.7), Math.min(3, maxLines));
    var extra = n.sub ? 1 : 0;
    var teamLine = D.stream && team;
    var block = lines.length * 15 + (showKind || extra || teamLine ? 12 : 0);
    var ty = y + (h - bh) / 2 - block / 2 + 11;
    var cx = r1(x + w / 2);
    var deco = store ? '<path class="deco" d="M' + r1(x + 5) + " " + r1(y + h - 5) + " H" + r1(x + w - 5) + " M" + r1(x + 5) + " " + r1(y + h - 8) + " H" + r1(x + w - 5) + '"></path>' : "";
    var text = '<text class="nl" text-anchor="middle">' + lines.map(function (ln, i) { return '<tspan x="' + cx + '" y="' + r1(ty + i * 15) + '">' + esc(ln) + "</tspan>"; }).join("") + "</text>"
      + (teamLine ? '<text class="nt" text-anchor="middle" x="' + cx + '" y="' + r1(ty + lines.length * 15 - 2) + '">' + esc(team) + "</text>"
        : showKind ? '<text class="nk' + (team ? " nt" : "") + '" text-anchor="middle" x="' + cx + '" y="' + r1(ty + lines.length * 15 - 2) + '">' + esc(team || e.kind) + "</text>" : "")
      + (n.sub ? '<text class="nk" style="display:inline" text-anchor="middle" x="' + cx + '" y="' + r1(ty + lines.length * 15 - 2) + '">' + esc(n.sub) + "</text>" : "");
    if (n.note) text += '<text class="nnote" text-anchor="' + (n.col < 0 ? "end" : "start") + '" x="' + r1(n.col < 0 ? x + w : x) + '" y="' + r1(y + h + 12) + '">' + esc(n.note) + "</text>";
    if (fb.length) {
      used.flow = true;
      // inside the box's foot on a stream drawing; elsewhere one pill across the box's bottom edge
      var shown = inBox ? fb : fb.slice(0, 1);
      text += shown.map(function (bd, i) {
        // 11px text sized for a screen share; a badge that would not fit the box says its short form (the colour keeps the source, the title the sentence)
        var CW = 7.1, txt = bd.text.length * CW + 12 <= w - 8 ? bd.text : (bd.short || bd.text);
        var by = inBox ? y + h - bh - 4 + i * 18 : y + h - 8, bw = Math.min(w - 8, Math.max(40, txt.length * CW + 12));
        return '<g class="' + esc(bd.cls) + '" aria-hidden="true"><rect x="' + r1(x + w / 2 - bw / 2) + '" y="' + r1(by) + '" width="' + r1(bw) + '" height="16" rx="8"></rect><text x="' + cx + '" y="' + r1(by + 12) + '" text-anchor="middle">' + esc(txt) + "</text><title>" + esc(bd.title) + "</title></g>";
      }).join("");
    }
    var sf = o.side && o.side.findings ? o.side.findings[e.id] : null;
    var fs = n.group || n.stub ? [] : o.side ? (sf ? new Array(sf.n).fill({ severity: sf.error ? "error" : "warning" }) : []) : (ix.findingsAt.get("element:" + e.id) || []);
    var badge = "";
    if (fs.length) {
      used.badge = true;
      var sev = fs.some(function (f) { return f.severity === "error"; }) ? "error" : "warning";
      badge = '<g class="fb ' + sev + '" aria-hidden="true"><circle cx="' + r1(x + w - 2) + '" cy="' + r1(y + 2) + '" r="7"></circle><text x="' + r1(x + w - 2) + '" y="' + r1(y + 5.4) + '" text-anchor="middle">' + fs.length + "</text></g>";
    }
    var cls = "node k-" + ks + " " + lc + (mk ? " mark-" + mk : "") + (n.focus ? " focus-node" : "") + (n.stub ? " stub" : "") + (o.selected === n.id ? " sel" : "");
    parts.nodes.push('<g class="' + cls + '" data-id="' + esc(n.id) + '"' + (n.stub ? ' data-stub="' + esc(n.stub.key) + '"' : "") + (n.group ? ' data-group="' + esc(n.id) + '"' : "") + (o.fixed ? "" : ' tabindex="-1" role="button"') + ' aria-label="' + esc(nodeName(ix, n) + (mk ? " (" + mk + ")" : "")) + '">'
      + '<rect class="halo" x="' + r1(x - 3) + '" y="' + r1(y - 3) + '" width="' + r1(w + 6) + '" height="' + r1(h + 6) + '" rx="' + r1(rx + 3) + '"></rect>'
      + '<rect class="box" x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" rx="' + r1(rx) + '"' + (e.home ? DASH : e.todayOnly ? DOTS : "") + "></rect>" + deco + text + badge
      + "<title>" + esc(n.title || nodeName(ix, n)) + "</title></g>");
  });
  var defs = "<defs><marker id=\"" + P + "-ah\" viewBox=\"0 0 10 10\" refX=\"9.5\" refY=\"5\" markerWidth=\"8\" markerHeight=\"8\" markerUnits=\"userSpaceOnUse\" orient=\"auto-start-reverse\"><path class=\"ahp\" d=\"M0,1 L10,5 L0,9 z\"></path></marker>"
    + '<pattern id="de-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--z0-fill)"></rect><line class="hatch-line" x1="0" y1="0" x2="0" y2="6"></line></pattern></defs>';
  var vb = o.crop || { x: 0, y: 0, w: D.width, h: D.height };
  var size = o.fixed ? ' viewBox="' + r1(vb.x) + " " + r1(vb.y) + " " + r1(vb.w) + " " + r1(vb.h) + '" width="' + r1(vb.w * (o.scale || 1)) + '" height="' + r1(vb.h * (o.scale || 1)) + '"' : "";
  var svg = '<svg class="dg' + (D.summary ? " summary" : "") + (D.manyPortalLines ? " many-portal-lines" : "") + (lens !== "zone" ? " lens" : "") + (o.level ? " z-" + o.level : o.fixed ? " z-near" : " z-mid") + '" id="' + P + '-svg"' + size + ' role="presentation" focusable="false">' + defs
    + '<g class="viewport"><g class="bands">' + parts.bands.join("") + '</g><g class="edges">' + parts.edges.join("") + '</g><g class="labels">' + parts.labels.join("") + '</g><g class="nodes">' + parts.nodes.join("") + "</g></g></svg>";
  return { svg: svg, legend: legendHtml(ix, D, lens, used, teamRank), width: D.width, height: D.height };
}

/** The legend lists only the encodings this drawing uses. */
function legendHtml(ix, D, lens, used, teamRank) {
  var out = [];
  var sw = function (cls, label) { return '<span><i class="swatch ' + cls + '" aria-hidden="true"></i>' + esc(label) + "</span>"; };
  if (D.summary) out.push('<span class="muted">Box: one ' + esc(ix.b.summary.by) + ", with its part count · line: relationships between two of them, both directions, thicker for more; hover a line for its kinds</span>");
  else if (lens === "zone") {
    var zs = [];
    used.lens.forEach(function (e, cls) { zs.push({ cls: cls, z: e.zone }); });
    zs.sort(function (a, b) { return (ix.zoneIdx.get(a.z) == null ? 99 : ix.zoneIdx.get(a.z)) - (ix.zoneIdx.get(b.z) == null ? 99 : ix.zoneIdx.get(b.z)); });
    var seen = new Set();
    zs.forEach(function (x) { var key = x.z || ""; if (seen.has(key)) return; seen.add(key); var zz = ix.zone.get(x.z); out.push(sw(zoneTint(ix, x.z).cls, zz ? zz.name : "No zone")); });
  } else if (lens === "owner") {
    var names = []; teamRank.forEach(function (r, t) { names[r] = t; });
    names.forEach(function (t, r) { if (t) out.push(sw("l-o" + r, (ix.team.get(t) || {}).name || t)); });
    if (used.lens.has("l-o0")) out.push(sw("l-o0", "Other or no owner team"));
  } else if (lens === "fidelity") {
    ix.ladder.forEach(function (lv, i) { if (used.lens.has("l-f" + Math.min(3, i))) out.push(sw("l-f" + Math.min(3, i), lv)); });
    if (used.lens.has("l-o0")) out.push(sw("l-o0", "No unit changes it"));
  } else if (lens === "findings") {
    [["l-err", "Error"], ["l-warn", "Warning"], ["l-ok", "No problems"]].forEach(function (p) { if (used.lens.has(p[0])) out.push(sw(p[0], p[1])); });
  } else if (lens === "flow") {
    [["l-w1", "Wait under 1 day"], ["l-w2", "1 to 3 days"], ["l-w3", "3 to 5 days"], ["l-w4", "5 days or more"], ["l-w0", "No wait declared (not a step, or missing)"]].forEach(function (p) { if (used.lens.has(p[0])) out.push(sw(p[0], p[1])); });
    out.push('<span class="muted">Fill: the wait the model declares before each step; the badges say its source and what the tracker measured</span>');
  } else if (lens === "plan") {
    [["l-done", "Done"], ["l-doing", "In progress"], ["l-ready", "Ready"], ["l-blocked", "Blocked"], ["l-ok", "No unit"]].forEach(function (p) { if (used.lens.has(p[0])) out.push(sw(p[0], p[1])); });
  }
  ["handoff", "data", "control", "evidence", "feedback", "other"].forEach(function (k) {
    if (!used.edge.has(k)) return;
    out.push('<span><svg width="34" height="10" aria-hidden="true" class="dg z-near"><g class="edge ek-' + k + '"><path class="line" d="M1 5 H33"></path></g></svg>' + esc(EDGE_WORD[k]) + "</span>");
  });
  if (used.shape.has("person")) out.push('<span><svg width="22" height="12" aria-hidden="true" class="dg z-near"><g class="node"><rect class="box" x="1" y="1" width="20" height="10" rx="5"></rect></g></svg>Person</span>');
  if (used.shape.has("store")) out.push('<span><svg width="22" height="12" aria-hidden="true" class="dg z-near"><g class="node"><rect class="box" x="1" y="1" width="20" height="10" rx="2"></rect><path class="deco" d="M3 9 H19 M3 7 H19"></path></g></svg>Store</span>');
  if (used.shape.has("external")) out.push('<span><svg width="22" height="12" aria-hidden="true" class="dg z-near"><g class="node k-external"><rect class="box" x="1" y="1" width="20" height="10" rx="2"></rect></g></svg>External system</span>');
  if (used.flow) out.push('<span><svg width="40" height="14" aria-hidden="true" class="dg z-near"><g class="fbadge s-estimated"><rect x="1" y="1" width="38" height="12" rx="6"></rect></g></svg>Flow badge: wait in days or WIP limit, with its source (measured, estimated, declared, or the tracker\u2019s measure)</span>');
  if (used.badge) out.push('<span><svg width="14" height="14" aria-hidden="true" class="dg z-near"><g class="fb warning"><circle cx="7" cy="7" r="6"></circle></g></svg>Problems found on the part</span>');
  if (used.marks.has("added")) out.push('<span class="st done sm"><span class="w">Green: added</span></span>');
  if (used.marks.has("removed")) out.push('<span class="st noprov sm"><span class="w">Red and dashed, struck through: removed</span></span>');
  if (used.marks.has("changed")) out.push('<span class="st blocked sm"><span class="w">Outlined amber: changed</span></span>');
  if (arr(D.bands).length) out.push('<span class="muted">Bands are zones</span>');
  if (used.outside) out.push('<span><svg width="22" height="12" aria-hidden="true" class="dg z-near"><g class="node"><rect class="box" x="1" y="1" width="20" height="10" rx="2"' + DASH + "></rect></g></svg>Outside this design: shown as the shared layer declares it</span>");
  if (used.today) out.push('<span><svg width="22" height="12" aria-hidden="true" class="dg z-near"><g class="node"><rect class="box" x="1" y="1" width="20" height="10" rx="2"' + DOTS + "></rect></g></svg>Today only: a part that exists now and is not in the target design</span>");
  if (used.portal) out.push('<span><svg width="34" height="12" aria-hidden="true" class="dg z-near"><g class="node portal"><rect class="box" x="1" y="1" width="32" height="10" rx="5"></rect></g></svg>Doorway: relationships to or from another zone, with their count' + (D.manyPortalLines ? "; hover a portal or a part for its lines" : "") + "</span>");
  return out.join("");
}

// ---------- camera ----------
/**
 * Pan and zoom for one canvas. The initial camera is the readable fit (scale clamped to 0.85..1.25, anchored on the
 * leftmost layer when the drawing is wider); Fit to screen fits everything. Semantic zoom switches far / mid / near by the
 * effective name size (12 px x scale), with 10% hysteresis.
 */
function Camera(canvas, svg, w, h, opts) {
  opts = opts || {};
  this.canvas = canvas; this.svg = svg; this.w = Math.max(1, w); this.h = Math.max(1, h);
  this.k = 1; this.tx = 0; this.ty = 0; this.level = "mid"; this.onChange = opts.onChange || null; this.anim = 0;
  this.reduce = !!opts.reduce;
}
Camera.prototype.apply = function () {
  var vp = this.svg && this.svg.querySelector(".viewport");
  if (vp) vp.setAttribute("transform", "translate(" + r1(this.tx) + " " + r1(this.ty) + ") scale(" + Math.round(this.k * 1000) / 1000 + ")");
  var px = 12 * this.k, lv = this.level;
  if (lv === "near" ? px < 10.5 * 0.9 : lv === "mid" ? (px < 7 * 0.9 ? true : px >= 10.5 * 1.1) : px >= 7 * 1.1) lv = px < 7 ? "far" : px < 10.5 ? "mid" : "near";
  if (lv !== this.level || !this.svg.classList.contains("z-" + lv)) {
    this.level = lv;
    this.svg.classList.remove("z-far", "z-mid", "z-near"); this.svg.classList.add("z-" + lv);
  }
  if (this.onChange) this.onChange(this);
};
Camera.prototype.size = function () { return { w: this.canvas.clientWidth || 1, h: this.canvas.clientHeight || 1 }; };
Camera.prototype.readable = function () {
  var c = this.size(), fitW = (c.w / this.w) * 0.96, fit = Math.min(fitW, (c.h / this.h) * 0.96);
  this.k = Math.max(0.85, Math.min(1.25, fit));
  this.tx = this.w * this.k <= c.w ? (c.w - this.w * this.k) / 2 : 8; // wider than the canvas: anchored on the leftmost layer
  this.ty = (c.h - this.h * this.k) / 2;                               // vertically centred
  this.level = 12 * this.k < 7 ? "far" : 12 * this.k < 10.5 ? "mid" : "near";
  this.apply();
};
/**
 * A drawing too large for the readable fit (a zone scene, a depth-2 neighbourhood) opens framed on its parts: fitted
 * when they fit at no less than minK, else at minK, centred on the hub (the part with the most lines) and kept inside
 * the parts' extent, so the first view is legible and busy rather than an empty corner.
 */
Camera.prototype.frame = function (nodes, hub, minK) {
  var c = this.size(), ns = (nodes || []).filter(Boolean);
  if (!ns.length) { this.readable(); return; }
  var x0 = Math.min.apply(null, ns.map(function (n) { return n.x; })), y0 = Math.min.apply(null, ns.map(function (n) { return n.y; }));
  var x1 = Math.max.apply(null, ns.map(function (n) { return n.x + n.w; })), y1 = Math.max.apply(null, ns.map(function (n) { return n.y + n.h; }));
  var bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0), m = 24;
  this.k = Math.max(minK || 0.7, Math.min(1.25, Math.min((c.w - 2 * m) / bw, (c.h - 2 * m) / bh)));
  var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (bw * this.k > c.w - 2 * m && hub) cx = hub.x + hub.w / 2;
  if (bh * this.k > c.h - 2 * m && hub) cy = hub.y + hub.h / 2;
  var tx = c.w / 2 - cx * this.k, ty = c.h / 2 - cy * this.k;
  // keep the parts' extent on screen: no empty margin wider than m on a side the parts overflow
  if (bw * this.k > c.w - 2 * m) tx = Math.min(m - x0 * this.k, Math.max(c.w - m - x1 * this.k, tx));
  if (bh * this.k > c.h - 2 * m) ty = Math.min(m - y0 * this.k, Math.max(c.h - m - y1 * this.k, ty));
  this.tx = tx; this.ty = ty;
  this.level = 12 * this.k < 7 ? "far" : 12 * this.k < 10.5 ? "mid" : "near";
  this.apply();
};
/** A stream drawing opens fitted to the width of the canvas, its first row at the top, so the whole stream reads across. */
Camera.prototype.fitWidth = function () {
  var c = this.size();
  this.k = Math.max(0.5, Math.min(1.25, (c.w / this.w) * 0.98));
  this.tx = (c.w - this.w * this.k) / 2; this.ty = 6;
  this.level = 12 * this.k < 7 ? "far" : 12 * this.k < 10.5 ? "mid" : "near";
  this.apply();
};
/** The canvas height for a drawing: its height at the readable scale plus 48 px, kept between 320 px and maxH. */
function canvasHeight(cw, w, h, maxH) {
  var k = Math.max(0.85, Math.min(1.25, (cw / Math.max(1, w)) * 0.96));
  return Math.round(Math.max(320, Math.min(maxH, h * k + 48)));
}
Camera.prototype.fitAll = function () {
  var c = this.size(), k = Math.min(c.w / this.w, c.h / this.h) * 0.96;
  this.animateTo(Math.max(0.05, Math.min(1.5, k)), (c.w - this.w * Math.max(0.05, Math.min(1.5, k))) / 2, (c.h - this.h * Math.max(0.05, Math.min(1.5, k))) / 2);
};
Camera.prototype.zoomAt = function (f, px, py) {
  var nk = Math.max(0.05, Math.min(4, this.k * f));
  this.tx = px - (px - this.tx) * (nk / this.k); this.ty = py - (py - this.ty) * (nk / this.k); this.k = nk;
  this.apply();
};
Camera.prototype.panBy = function (dx, dy) { this.tx += dx; this.ty += dy; this.apply(); };
Camera.prototype.centerOn = function (x, y, k, animate) {
  var c = this.size(); k = k || this.k;
  var tx = c.w / 2 - x * k, ty = c.h / 2 - y * k;
  if (animate) this.animateTo(k, tx, ty); else { this.k = k; this.tx = tx; this.ty = ty; this.apply(); }
};
/** Camera moves animate 240 ms; with reduced motion they cut. One requestAnimationFrame run per move, then it stops. */
Camera.prototype.animateTo = function (k, tx, ty) {
  var self = this;
  if (this.reduce || typeof requestAnimationFrame === "undefined") { this.k = k; this.tx = tx; this.ty = ty; this.apply(); return; }
  var k0 = this.k, x0 = this.tx, y0 = this.ty, t0 = 0, id = ++this.anim;
  var ease = function (t) { var u = 1 - t; return 1 - u * u * u; };
  var step = function (ts) {
    if (id !== self.anim) return;
    if (!t0) t0 = ts;
    var t = Math.min(1, (ts - t0) / 240), e = ease(t);
    self.k = k0 + (k - k0) * e; self.tx = x0 + (tx - x0) * e; self.ty = y0 + (ty - y0) * e; self.apply();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};
/** Whether the drawing at the current scale exceeds the canvas by 2x in either direction (the minimap's auto rule). */
Camera.prototype.oversized = function () { var c = this.size(); return this.w * this.k > 2 * c.w || this.h * this.k > 2 * c.h; };

function minimapSvg(ix, D) {
  var s = 160 / Math.max(1, D.width), h = Math.max(40, Math.round(D.height * s));
  return '<svg viewBox="0 0 ' + r1(D.width) + " " + r1(D.height) + '" width="160" height="' + h + '" aria-hidden="true" class="dg z-near">' + D.nodes.map(function (n) {
    return '<g class="node ' + (n.el ? zoneTint(ix, n.el.zone).cls : "") + '"><rect class="box mn" x="' + r1(n.x) + '" y="' + r1(n.y) + '" width="' + r1(n.w) + '" height="' + r1(n.h) + '"></rect></g>';
  }).join("") + '<rect class="vp" x="0" y="0" width="10" height="10"></rect></svg>';
}

api.wrapLabel = wrapLabel; api.fromLayout = fromLayout; api.focusDiagram = focusDiagram; api.focusScope = focusScope; api.FOCUS_CAP = FOCUS_CAP; api.summaryDiagram = summaryDiagram;
api.zoneDiagram = zoneDiagram; api.zoneScope = zoneScope; api.Camera = Camera;
api.renderDiagram = renderDiagram; api.nodeSize = nodeSize; api.STUB_LIMIT = STUB_LIMIT; api.homePage = homePage;
