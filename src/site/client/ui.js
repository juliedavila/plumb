/* Plumb site client, part 3d: the grammar's furniture (Tier 1). The chip bar under the header (filters, the
   selection, the hop trail, Follow, the match count), the value popovers, the hover card, the drawer stack, and the
   rule that every internal link carries the filters and the selection. State lives in the hash (grammar.js); the
   page controllers read S.match(kind). Nothing here repeats a timer: the hover delay and the camera debounce are
   one-shot. */

/** The kind the current page lists (the Overview: its active tile's kind). */
function pageKind(S) {
  var r = S.route || {};
  if (r.page === "overview") return S.overviewKind || "element";
  return PAGE_KIND[r.page] || null;
}

/** Apply a route's state: filters, trail, selection. Called on every route before the page draws. */
function applyState(S, r) {
  var ix = S.ix;
  S.st = stateOf(r);
  S.trailEval = S.st.trail && S.st.trail.length ? evalTrail(ix, S.st.trail, S.st.f) : null;
  S._match = {};
}
/** The records of a kind the page shows: a Set, or null when nothing narrows it. */
function matchFor(S, kind) { return matchForAll(S, kind); }
function matchForAll(S, kind) {
  if (!S.st) return null;
  if (S._match[kind] !== undefined) return S._match[kind];
  var trail = S.trailEval && S.trailEval.kind === kind ? S.trailEval : null;
  var m = matchingSet(S.ix, kind, S.st.f, trail);
  S._match[kind] = m;
  return m;
}

/** A hash with the current filters and selection carried in (the trail only within its own page). */
function carryState(S, hash) {
  if (!S.st || /^#(tour|learn|present)/.test(hash) || hashHasState(hash)) return hash;
  var r = parseRoute(hash), same = S.route && r.page === S.route.page;
  return withState(hash, { f: S.st.f, sel: S.st.sel, trail: same ? S.st.trail : null });
}
/** The current hash with a new state (filters, trail), keeping the route and its own keys. */
function hashWith(S, st) {
  var h = location.hash || "#overview";
  return withState(h, { f: st.f || {}, trail: st.trail || null, sel: st.sel !== undefined ? st.sel : S.st && S.st.sel });
}

// ---------- the chip bar ----------
function chipBar(S) {
  var ix = S.ix, st = S.st || { f: {} }, bar = $("chipbar");
  if (!bar) return;
  var kind = pageKind(S);
  var ap = kind ? appliedFilters(ix, kind, st.f) : { applied: {}, ignored: [] };
  var html = [];
  var tr = S.trailEval;
  if (tr && tr.crumbs.length) {
    html.push('<nav class="trail" aria-label="Follow trail">' + tr.crumbs.map(function (c, i) {
      var last = i === tr.crumbs.length - 1, label = esc(cap1(c.label)) + ' <span class="count">' + PROSE.fmt(c.count) + "</span>";
      return (i ? '<span class="sep" aria-hidden="true">&#8250;</span>' : "") + (last ? '<span class="crumb cur" aria-current="step">' + label + "</span>" : '<a class="crumb" href="' + esc(crumbHash(st.trail, i)) + '" data-raw>' + label + "</a>");
    }).join("") + '<a class="crumb-x" href="' + esc(hashWith(S, { f: st.f, trail: null })) + '" data-raw aria-label="Leave the trail">' + icon("close", "icon icon-sm") + "</a></nav>");
  }
  var fzc = focusChipHtml(S); if (fzc) html.push(fzc);
  var partial = notAppliedHere(S.route && S.route.page, st.f);
  FACETS.forEach(function (fc) {
    var vals = arr(st.f[fc.key]); if (!vals.length) return;
    var ign = ap.ignored.indexOf(fc.key) >= 0;
    var part = partial.filter(function (x) { return x.key === fc.key; })[0];
    var nf = {}; Object.keys(st.f).forEach(function (k) { if (k !== fc.key) nf[k] = st.f[k]; });
    html.push('<span class="fchip-x' + (ign || part ? " ignored" : "") + '"' + (ign ? ' title="' + esc("Does not apply to " + (KIND_NOUN[kind] || ["", "these records"])[1] + " on this page") + '"' : part ? ' title="' + esc(part.note) + '"' : "") + '><button type="button" class="fc" data-chip="' + fc.key + '" aria-haspopup="true">' + esc(chipText(ix, fc.key, vals)) + (ign ? ' <span class="xs">(not here)</span>' : part ? ' <span class="xs">(not applied here)</span>' : "") + '</button><a class="fx" href="' + esc(hashWith(S, { f: nf, trail: st.trail })) + '" data-raw aria-label="' + esc("Remove " + chipText(ix, fc.key, vals)) + '">' + icon("close", "icon icon-sm") + "</a></span>");
  });
  partial.forEach(function (x) { html.push('<span class="not-applied xs fg2" role="note">' + esc(x.note) + "</span>"); });
  html.push('<span class="menu-wrap"><button type="button" class="btn quiet sm add-filter" id="add-filter" aria-haspopup="true">' + icon("filter", "icon icon-sm") + "Filter</button></span>");
  if (hasFilters(st.f)) html.push('<a class="btn quiet sm" id="clear-filters" href="' + esc(hashWith(S, { f: {}, trail: st.trail })) + '" data-raw>Clear filters</a>');
  html.push('<span class="grow"></span>');
  if (kind) {
    var m = matchFor(S, kind), total = recordsOf(ix, kind).length;
    if (m) html.push('<span class="match-count" role="status">' + esc("Showing " + PROSE.fmt(m.size) + " of " + PROSE.count(total, (KIND_NOUN[kind] || [kind])[0], (KIND_NOUN[kind] || [kind, kind + "s"])[1])) + "</span>");
    // Follow names the set it starts from; with a record open, that record's own Follow is the one to use
    var recOpen = !!(S.route && S.route.id && S.route.page !== "tracker");
    var nn = KIND_NOUN[kind] || [kind, kind + "s"], sz = m ? m.size : total;
    if (LINKS[kind] && LINKS[kind].some(followable) && !recOpen && sz) html.push('<span class="menu-wrap"><button type="button" class="btn sm follow-btn" id="follow-btn" aria-haspopup="true">' + icon("follow", "icon icon-sm") + esc((m ? "Follow these " : "Follow all ") + PROSE.fmt(sz) + " " + (sz === 1 ? nn[0] : nn[1])) + "</button></span>");
  }
  var selName = S.sel ? recordTitle(ix, S.sel.kind, S.sel.id) : "";
  html.push('<span class="sel-chip" id="sel-chip"' + (S.sel ? "" : " hidden") + '><span id="sel-chip-name" title="' + esc(selName) + '">' + esc(S.sel ? "Selected: " + selName : "") + '</span>'
    + (S.sel ? '<button type="button" class="sel-follow" id="sel-follow" aria-haspopup="true" aria-label="Follow from the selection">' + icon("follow", "icon icon-sm") + "</button>" : "")
    + '<button type="button" id="sel-clear" aria-label="Clear selection">' + icon("close", "icon icon-sm") + "</button></span>");
  bar.querySelector(".inner").innerHTML = html.join("");
  bar.classList.toggle("active", !!(tr || hasFilters(st.f) || S.sel || fzc));
}

// ---------- popovers (one at a time) ----------
var gpop = null;
function closeGpop() { if (gpop) { var t = gpop._trigger; gpop.remove(); gpop = null; if (t && t.isConnected && t.focus) t.focus({ preventScroll: true }); } }
function openGpop(trigger, html, label) {
  closeGpop();
  var p = document.createElement("div");
  p.className = "gpop"; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", label || "Choices");
  p.innerHTML = html; p._trigger = trigger;
  document.body.appendChild(p);
  var r = trigger.getBoundingClientRect(), w = p.offsetWidth;
  var left = Math.max(8, Math.min(r.left, document.documentElement.clientWidth - w - 8));
  p.style.left = (window.scrollX + left) + "px";
  p.style.top = (window.scrollY + r.bottom + 6) + "px";
  if (p.getBoundingClientRect().bottom > window.innerHeight - 8) p.style.top = (window.scrollY + Math.max(8, r.top - p.offsetHeight - 6)) + "px";
  gpop = p;
  var f = p.querySelector("button, a, input"); if (f) f.focus({ preventScroll: true });
  return p;
}

/** The values of one facet with their counts on this page; choosing toggles the value and pushes the new state. */
function facetMenuHtml(S, key) {
  var ix = S.ix, kind = pageKind(S), st = S.st, cur = arr(st.f[key]);
  var trail = S.trailEval && S.trailEval.kind === kind ? S.trailEval : null;
  var vals = kind ? facetCounts(ix, kind, key, st.f, trail) : [];
  cur.forEach(function (v) { if (!vals.some(function (x) { return x.value === v; })) vals.unshift({ value: v, label: facetLabel(ix, key, v), count: 0 }); });
  var facet = FACETS.filter(function (f) { return f.key === key; })[0];
  return '<p class="gpop-h">' + esc(facet ? facet.label : key) + ' <span class="muted xs">' + esc(kind ? "· how many " + (KIND_NOUN[kind] || ["", "records"])[1] + " each would show" : "") + "</span></p>"
    + (vals.length ? '<ul class="gpop-list" role="menu">' + vals.map(function (x) {
      var on = cur.indexOf(x.value) >= 0;
      var next = on ? cur.filter(function (v) { return v !== x.value; }) : cur.concat([x.value]);
      var nf = {}; Object.keys(st.f).forEach(function (k) { nf[k] = st.f[k]; }); if (next.length) nf[key] = next; else delete nf[key];
      return '<li><a role="menuitemcheckbox" aria-checked="' + on + '" href="' + esc(hashWith(S, { f: nf, trail: st.trail })) + '" data-raw class="' + (x.count ? "" : "zero") + '"><span class="tick" aria-hidden="true"></span><span class="v">' + esc(x.label) + '</span><span class="n">' + PROSE.fmt(x.count) + "</span></a>"
        + (key === "zone" ? '<a class="open-zone" href="' + esc(carryState(S, R.zone(x.value))) + '" data-raw aria-label="' + esc("Open the " + x.label + " zone") + '">Open</a>' : "") + "</li>";
    }).join("") + "</ul>" : '<p class="small muted">No values on this page.</p>');
}
function addFilterHtml(S) {
  var ix = S.ix, kind = pageKind(S);
  var fs = FACETS.filter(function (f) { return kind && facetUniverse(ix, kind, f.key).size > 0; });
  return '<p class="gpop-h">Filter ' + esc(kind ? (KIND_NOUN[kind] || ["", "records"])[1] : "") + ' by</p><ul class="gpop-list" role="menu">' + fs.map(function (f) {
    var n = facetUniverse(ix, kind, f.key).size;
    return '<li><button type="button" role="menuitem" data-facet-pick="' + f.key + '"><span class="v">' + esc(f.label) + '</span><span class="n">' + esc(PROSE.count(n, "value")) + "</span></button></li>";
  }).join("") + "</ul>";
}
/** The Follow menu: each link type with its count, before you choose. */
function followMenuHtml(S, start, ids) {
  var ix = S.ix, kind = start.kind;
  var ls = linkCounts(ix, kind, ids, { followOnly: true });
  var from = start.id != null ? recordTitle(ix, kind, start.id) : PROSE.count(ids.length, (KIND_NOUN[kind] || [kind])[0], (KIND_NOUN[kind] || [kind, kind + "s"])[1]);
  return '<p class="gpop-h">Follow from ' + esc(from) + "</p>" + (ls.length ? '<ul class="gpop-list" role="menu">' + ls.map(function (l) {
    return '<li><a role="menuitem" href="' + esc(followHash(start, l.key)) + '" data-raw data-follow="' + esc(l.key) + '"><span class="v">' + esc(l.label) + '</span><span class="n">' + PROSE.fmt(l.count) + "</span></a></li>";
  }).join("") + "</ul>" : '<p class="small muted">Nothing links out of ' + (ids.length === 1 ? "this record" : "these records") + ".</p>");
}

// ---------- the hover card and the drawer ----------
var REF_SEL = "[data-ref], a[data-unit], a[data-element], a[data-claim], [data-patch-row], tr[data-unit], tr[data-element], .node[data-id], a[data-gate]";
/** The record an element on the page refers to, or null. */
function refOf(S, el) {
  if (!el || !el.closest) return null;
  var t = el.closest(REF_SEL);
  if (!t || t.closest(".hovercard")) return null;
  var ix = S.ix, k = null, id = null;
  if (t.hasAttribute("data-ref")) { var s = splitKey(t.getAttribute("data-ref")); k = s.kind; id = s.id; }
  else if (t.hasAttribute("data-unit")) { k = "unit"; id = t.getAttribute("data-unit"); }
  else if (t.hasAttribute("data-element")) { k = "element"; id = t.getAttribute("data-element"); }
  else if (t.hasAttribute("data-claim")) { k = "claim"; id = t.getAttribute("data-claim"); }
  else if (t.hasAttribute("data-patch-row")) { k = "patch"; id = t.getAttribute("data-patch-row"); }
  else if (t.hasAttribute("data-gate")) { k = "phase"; id = t.getAttribute("data-gate"); }
  else if (t.classList.contains("node")) {
    if (t.hasAttribute("data-stub") || t.hasAttribute("data-portal")) return null;
    if (t.hasAttribute("data-group")) { k = "zone"; id = t.getAttribute("data-id"); if (S.ix.b.summary && S.ix.b.summary.by !== "zone") return null; }
    else { k = "element"; id = t.getAttribute("data-id"); }
  }
  if (!k || !recordOf(ix, k, id)) return null;
  return { el: t, kind: k, id: id };
}
/** Whether a click on this element opens a drawer (references do; a page's own master list and drawings do not). */
function opensDrawer(t) {
  var el = t.el;
  if (el.closest(".deck, .app-nav, #chipbar, #tour-caption, .road, [data-full-page], .gpop")) return false;
  if (el.classList.contains("node")) return false; // drawings select on click; hover shows the card
  if (el.closest("#claim-list .list-row, .patch-list")) return false;
  if (el.tagName === "TR") return false;           // rows: their own handlers decide
  return true;
}

function wireGrammar(S) {
  var ix = S.ix;
  // a team, anywhere: the Teams page with its owner filter set and its card on top (client/teams.js); Cmd or Ctrl click still follows the link
  document.addEventListener("click", function (ev) {
    if (ev.defaultPrevented || (ev.button != null && ev.button !== 0) || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var t = ev.target.closest && ev.target.closest("[data-team-open]");
    if (!t || t.closest(".drawer, .hovercard, .deck")) return;
    ev.preventDefault(); ev.stopPropagation();
    openTeam(S, t.getAttribute("data-team-open"), t);
  }, true);
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    var t = ev.target.closest && ev.target.closest("[data-team-open]");
    if (!t || t.tagName === "A") return;
    ev.preventDefault(); openTeam(S, t.getAttribute("data-team-open"), t);
  });
  // ---------- the hover card ----------
  var card = document.createElement("div");
  card.className = "hovercard"; card.id = "hovercard"; card.setAttribute("role", "tooltip"); card.hidden = true;
  document.body.appendChild(card);
  var showT = null, hideT = null, cur = null;
  function place(el) {
    var r = el.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var x = Math.max(8, Math.min(r.left, vw - cw - 8)), y = r.bottom + 8;
    if (y + ch > vh - 8) y = Math.max(8, r.top - ch - 8);
    card.style.left = Math.round(x) + "px"; card.style.top = Math.round(y) + "px";
  }
  function show(t) {
    cur = t.el;
    card.innerHTML = cardHtml(ix, t.kind, t.id, "hover");
    card.hidden = false; place(t.el);
  }
  function hide() { card.hidden = true; cur = null; }
  S.hideCard = hide;
  S.showCardAt = function (el) { var t = refOf(S, el); if (t) show(t); return !!t; }; // the Learn tour shows a card without a pointer
  document.addEventListener("mouseover", function (ev) {
    var t = refOf(S, ev.target);
    if (!t) return;
    clearTimeout(hideT);
    if (t.el === cur) return;
    clearTimeout(showT);
    showT = setTimeout(function () { if (t.el.isConnected) show(t); }, 450);
  });
  document.addEventListener("mouseout", function (ev) {
    var t = refOf(S, ev.target);
    if (!t) return;
    if (ev.relatedTarget && t.el.contains(ev.relatedTarget)) return;
    clearTimeout(showT);
    hideT = setTimeout(hide, 100);
  });
  document.addEventListener("scroll", function () { if (!card.hidden) hide(); }, { passive: true, capture: true });

  // ---------- the drawer stack ----------
  var layer = document.createElement("div");
  layer.className = "drawer-layer"; layer.id = "drawer-layer"; layer.hidden = true;
  layer.innerHTML = '<div class="scrim" data-scrim></div>';
  document.body.appendChild(layer);
  S.drawers = [];
  function renderStack() {
    layer.hidden = !S.drawers.length;
    document.documentElement.classList.toggle("drawer-open", S.drawers.length > 0);
    S.drawers.forEach(function (d, i) {
      var depth = S.drawers.length - 1 - i;
      d.el.style.transform = depth ? "translateX(" + (-28 * depth) + "px)" : "";
      d.el.classList.toggle("under", depth > 0);
      d.el.setAttribute("aria-hidden", depth ? "true" : "false");
      if (depth) d.el.setAttribute("inert", ""); else d.el.removeAttribute("inert");
    });
  }
  function drawerHtml(kind, id, depth) {
    return '<div class="drawer-bar">' + (depth ? '<button type="button" class="btn quiet sm" data-drawer-back>' + icon("back", "icon icon-sm") + "Back</button>" : "")
      + '<span class="grow"></span>' + (LINKS[kind] && linkCounts(ix, kind, [id], { followOnly: true }).length ? '<span class="menu-wrap"><button type="button" class="btn sm" data-drawer-follow aria-haspopup="true">' + icon("follow", "icon icon-sm") + "Follow</button></span>" : "")
      + '<a class="btn quiet sm" href="' + esc(recordHref(ix, kind, id)) + '" data-full-page>Full page</a>'
      + '<button type="button" class="btn quiet icon-only" data-drawer-close aria-label="Close every drawer">' + icon("close") + "</button></div>"
      + '<div class="drawer-body">' + cardHtml(ix, kind, id, "drawer") + "</div>";
  }
  S.openDrawer = function (kind, id, trigger) {
    if (!recordOf(ix, kind, id)) return;
    hide();
    closeGpop();
    var top = S.drawers[S.drawers.length - 1];
    if (top && top.kind === kind && top.id === id) return;
    var el = document.createElement("aside");
    el.className = "drawer"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", (KIND_WORD[kind] || kind) + " " + recordTitle(ix, kind, id));
    el.innerHTML = drawerHtml(kind, id, S.drawers.length);
    layer.appendChild(el);
    S.drawers.push({ kind: kind, id: id, el: el, trigger: trigger || document.activeElement });
    renderStack();
    if (fillTimes) fillTimes(el);
    var h = el.querySelector(".card-t"); if (h) h.focus({ preventScroll: true });
    S.announce((KIND_WORD[kind] || kind) + " " + recordTitle(ix, kind, id) + " opened in a drawer");
  };
  S.closeDrawer = function () {
    var d = S.drawers.pop(); if (!d) return;
    d.el.remove(); renderStack();
    var t = d.trigger; if (t && t.isConnected && t.focus) t.focus({ preventScroll: true });
  };
  S.closeDrawers = function () { while (S.drawers.length) { var d = S.drawers.pop(); d.el.remove(); } renderStack(); };
  layer.addEventListener("click", function (ev) {
    if (ev.target.closest("[data-scrim]")) { S.closeDrawer(); return; }
    if (ev.target.closest("[data-drawer-back]")) { S.closeDrawer(); return; }
    if (ev.target.closest("[data-drawer-close]")) { var first = S.drawers[0] && S.drawers[0].trigger; S.closeDrawers(); if (first && first.isConnected && first.focus) first.focus({ preventScroll: true }); return; }
    var fb = ev.target.closest("[data-drawer-follow]");
    if (fb) { var top = S.drawers[S.drawers.length - 1]; openGpop(fb, followMenuHtml(S, { kind: top.kind, id: top.id }, [top.id]), "Follow"); return; }
  });

  // ---------- clicks: references open drawers, internal links carry the state ----------
  document.addEventListener("click", function (ev) {
    if (ev.defaultPrevented || (ev.button != null && ev.button !== 0) || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var t = refOf(S, ev.target);
    if (t && opensDrawer(t)) { ev.preventDefault(); ev.stopPropagation(); S.openDrawer(t.kind, t.id, t.el); return; }
    var a = ev.target.closest && ev.target.closest("a[href^='#']");
    if (!a) return;
    if (a.closest(".gpop")) closeGpop();
    if (a.hasAttribute("data-full-page")) S.closeDrawers();
    if (a.hasAttribute("data-raw")) return;
    var h = a.getAttribute("href"), nh = carryState(S, h);
    if (nh !== h) a.setAttribute("href", nh);
  }, true);

  // ---------- the chip bar's buttons ----------
  document.addEventListener("click", function (ev) {
    var c = ev.target.closest && ev.target.closest("[data-chip]");
    if (c) { openGpop(c, facetMenuHtml(S, c.getAttribute("data-chip")), "Values"); return; }
    if (ev.target.closest && ev.target.closest("#add-filter")) { openGpop($("add-filter"), addFilterHtml(S), "Add a filter"); return; }
    var pick = ev.target.closest && ev.target.closest("[data-facet-pick]");
    if (pick && gpop) { var trig = gpop._trigger; var key = pick.getAttribute("data-facet-pick"); openGpop(trig, facetMenuHtml(S, key), "Values"); return; }
    if (ev.target.closest && ev.target.closest("#follow-btn")) {
      var kind = pageKind(S), m = matchFor(S, kind), ids = m ? Array.from(m) : recordsOf(ix, kind);
      var tr = S.trailEval && S.trailEval.kind === kind ? S.st.trail : null;
      openGpop($("follow-btn"), followMenuHtml(S, { kind: kind, f: S.st.f, trail: tr }, ids), "Follow");
      return;
    }
    var fr = ev.target.closest && ev.target.closest("[data-follow-rec]");
    if (fr) { var rk = splitKey(fr.getAttribute("data-follow-rec")); openGpop(fr, followMenuHtml(S, { kind: rk.kind, id: rk.id }, [rk.id]), "Follow"); return; }
    if (ev.target.closest && ev.target.closest("#sel-follow") && S.sel) { openGpop($("sel-follow"), followMenuHtml(S, { kind: S.sel.kind, id: S.sel.id }, [S.sel.id]), "Follow"); return; }
    if (gpop && !(ev.target.closest && ev.target.closest(".gpop"))) closeGpop();
  });

  // ---------- keys: Escape closes the popover, then the top drawer ----------
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    if (gpop) { closeGpop(); ev.preventDefault(); ev.stopImmediatePropagation(); return; }
    if (!card.hidden) hide();
    if (S.drawers.length && !document.querySelector("dialog[open]")) { S.closeDrawer(); ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, true);
}

/** Fade or hide what the filter leaves out, for references on pages without a list of their own (Teams, Tracker). */
function fadeRefs(S, root, page) {
  if (!root) return;
  // a chip the page says it does not apply fades nothing here either
  var skip = notAppliedHere(page || (root.id || ""), S.st && S.st.f).map(function (x) { return x.key; });
  var F = {};
  Object.keys((S.st && S.st.f) || {}).forEach(function (k) { if (skip.indexOf(k) < 0) F[k] = S.st.f[k]; });
  var on = S.st && hasFilters(F);
  var cache = {};
  var matchFor = function (S, k) { if (!skip.length) return matchForAll(S, k); if (cache[k] === undefined) cache[k] = matchingSet(S.ix, k, F, S.trailEval && S.trailEval.kind === k ? S.trailEval : null); return cache[k]; };
  $$("[data-unit], [data-element], [data-claim]", root).forEach(function (el) {
    if (el.closest("#chipbar, .drawer, .hovercard, .wait-list, .waits-list")) return;
    var k = el.hasAttribute("data-unit") ? "unit" : el.hasAttribute("data-element") ? "element" : "claim";
    var m = on ? matchFor(S, k) : null;
    el.classList.toggle("f-out", !!m && !m.has(el.getAttribute(k === "unit" ? "data-unit" : k === "element" ? "data-element" : "data-claim")));
  });
}

/** One sentence over a list that the filter narrows: what shows, and what to click when nothing does. */
function filteredNote(S, kind, shown, total) {
  var n = (KIND_NOUN[kind] || [kind, kind + "s"]);
  if (!shown) return PROSE.sentence("No " + n[1] + " match " + (S.trailEval ? "this trail and these filters" : "these filters")) + " Remove a chip above, or use Clear filters.";
  return PROSE.sentence("Showing " + PROSE.fmt(shown) + " of " + PROSE.count(total, n[0], n[1]));
}

/**
 * A list's heading: what it shows under the filters that apply to its kind ("6 blocked units", "1 open unit in “See
 * the stream”"), or allText when nothing narrows it. local: the page's own narrowing, as facets (merged over the chips)
 * and as trailing phrases ("changing Ingest").
 */
function listHeading(S, kind, shown, allText, local) {
  local = local || {};
  var F = {}, A = appliedFilters(S.ix, kind, (S.st && S.st.f) || {}).applied;
  Object.keys(A).forEach(function (k) { F[k] = A[k]; });
  Object.keys(local.f || {}).forEach(function (k) { if (arr(local.f[k]).length) F[k] = local.f[k]; });
  var more = arr(local.more).filter(Boolean);
  var trail = S.trailEval && S.trailEval.kind === kind;
  if (!Object.keys(F).length && !more.length && !trail) return allText;
  return describeSet(S.ix, kind, F, shown) + (more.length ? " " + more.join(" ") : "");
}

api.applyState = applyState; api.carryState = carryState; api.filteredNote = filteredNote; api.listHeading = listHeading;

/** Fade what the filter leaves out of a drawing: parts that do not match, and every line that touches one. */
function fadeDrawing(S, svg) {
  if (!svg) return;
  var m = S.st && (hasFilters(S.st.f) || (S.trailEval && S.trailEval.kind === "element")) ? matchFor(S, "element") : null;
  var out = new Set();
  $$(".node[data-id]", svg).forEach(function (g) {
    if (g.hasAttribute("data-stub") || g.hasAttribute("data-portal")) return;
    var id = g.getAttribute("data-id"), off = false;
    if (m && g.hasAttribute("data-group")) {
      var grp = arr(S.ix.b.summary && S.ix.b.summary.groups).filter(function (x) { return (x.id || NONE) === id || (id === "__none" && !x.id); })[0];
      off = !!grp && !arr(grp.elements).some(function (e) { return m.has(e); });
    } else if (m) off = !m.has(id);
    g.classList.toggle("f-out", off);
    if (off) out.add(id);
  });
  $$(".edge, .elabel, .pcount", svg).forEach(function (e) { e.classList.toggle("f-out", out.has(e.getAttribute("data-from")) || out.has(e.getAttribute("data-to"))); });
  svg.classList.toggle("filtered", !!m);
  return m;
}

/** Ids in prose (a patch's why, a tour caption, deck notes) become record chips: hover for the card, click for the drawer. */
function linkifyAll(S, root) {
  $$("[data-linkify]", root).forEach(function (el) {
    if (el.getAttribute("data-linkified")) return;
    el.setAttribute("data-linkified", "1");
    el.innerHTML = linkifyText(S.ix, el.textContent);
  });
}
api.fadeDrawing = fadeDrawing;
