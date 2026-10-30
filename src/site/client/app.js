/* Plumb site client, part 4: boot. Routes, one selection across the page, the command palette, the tour,
   theme, help, copy buttons and the hooks the dev server's live-reload snippet calls. The page sets no repeating
   timer and opens no connection: the offline file settles as soon as it has drawn. */

var PAGE_TITLE = { overview: "Overview", model: "Model", plan: "Plan", strategy: "Strategy", teams: "Teams", checks: "Checks", changes: "Changes", tracker: "Tracker", notes: "Notes" };

/** Where a tour step goes, as a route hash. */
function tourHash(t) {
  if (typeof t === "string") return "#" + t;
  if (t && t.claim != null) return R.claim(t.claim);
  if (t && t.note != null) return R.note(t.note);
  if (t && t.present != null) return R.present(Number(t.present) || 1);
  if (t && t.zone != null) return R.zone(t.zone);
  if (!t || typeof t !== "object") return "#overview";
  if (t.view != null) return R.view(t.view);
  if (t.element != null) return R.element(t.element);
  if (t.focus != null) return R.focus(t.focus, t.depth);
  if (t.unit != null) return R.unit(t.unit);
  if (t.rule != null) { var p = str(t.rule).split("/"); return R.rule(p[0], p.slice(1).join("/")); }
  if (t.finding != null) { var f = str(t.finding), at = f.indexOf("@"), pr = (at < 0 ? f : f.slice(0, at)).split("/"); return R.rule(pr[0], pr.slice(1).join("/")); }
  if (t.patch != null) return R.patch(t.patch);
  if (t.milestone != null) return R.milestone(t.milestone);
  if (t.gate != null) return R.milestone(t.gate); // older tours
  if (t.tracker != null) return R.tracker(t.tracker);
  return "#overview";
}

/** The element a tour step scrolls to after its page draws: a rule's block on Checks (a finding's rule, its row marked), else none. */
function tourAnchor(t) {
  if (!t || typeof t !== "object") return null;
  var k = t.rule != null ? str(t.rule) : t.finding != null ? str(t.finding).split("@")[0] : null;
  if (k == null) return null;
  var p = k.split("/");
  return ("rule-" + p[0] + "-" + p.slice(1).join("/")).replace(/\s/g, "_");
}

/** Palette entries: elements, units, views, milestones, contracts, capabilities, rules, findings, patches, tracker issues. */
function searchIndex(ix) {
  var out = [];
  var add = function (group, label, sub, href, key, extra) { out.push({ group: group, label: str(label), sub: str(sub), href: href, key: str(key).toLowerCase(), text: (str(label) + " " + str(sub) + " " + str(key)).toLowerCase(), extra: extra }); };
  ix.el.forEach(function (e) { add("Parts", e.name, e.kind + " · " + e.id, R.element(e.id), e.id, { focus: R.focus(e.id) }); });
  ix.unit.forEach(function (u) { add("Units", u.id + " " + u.title, milestoneLabel(ix, u.phase) + " · " + UNIT_WORD[unitState(ix, u)], R.unit(u.id), u.id); });
  ix.view.forEach(function (v) { add("Views", v.title, plural(arr(v.elements).length, "part") + (v.group ? " · " + v.group : ""), R.view(v.id), v.id); });
  ix.phaseOrder.forEach(function (p) { add("Milestones", p.name, p.delivers || p.exit_test, R.milestone(p.id), p.id); });
  ix.contract.forEach(function (c, name) { var by = arr(c.produced_by)[0] || arr(c.consumed_by)[0]; add("Contracts", name, by ? "produced by " + ((ix.el.get(by) || {}).name || by) : "", by ? R.element(by) : "#model/elements", name); });
  var caps = new Set(); ix.providers.forEach(function (v, k) { caps.add(k); }); ix.requirers.forEach(function (v, k) { caps.add(k); });
  caps.forEach(function (c) { var p = (ix.providers.get(c) || [])[0], q = (ix.requirers.get(c) || [])[0]; add("Capabilities", c, p ? "provided by " + p : "no unit provides it", R.unit(p || q), c); });
  ix.rules.forEach(function (r, k) { var p = k.split("/"); add("Rules", r.title, k, R.rule(p[0], p.slice(1).join("/")), k); });
  arr(ix.b.findings).forEach(function (f) { var r = ix.rules.get(f.pack + "/" + f.rule); add("Problems", (r ? r.title : f.rule) + ": " + f.at, f.message, R.rule(f.pack, f.rule), f.at); });
  ix.patch.forEach(function (p) { add("Changes", p.id + " " + p.title, cap1(p.status), R.patch(p.id), p.id); });
  ix.claim.forEach(function (c) { add("Claims", c.id + " " + c.statement, cap1(c.kind) + " · " + ((GRADES[c.grade] || [0, c.grade])[1]), R.claim(c.id), c.id); });
  ix.notes.forEach(function (n) { add("Notes", n.id + " " + n.text, (n.kind === "question" ? "Question" : "Note") + " · " + n.status + " · on " + n.target.kind + " " + n.target.id, R.note(n.id), n.id); });
  var t = ix.b.tracker && ix.b.tracker.reconcile, info = (ix.b.tracker && ix.b.tracker.issueInfo) || {};
  if (t) {
    var seen = new Set();
    ix.issueOf.forEach(function (issue, unit) { seen.add(issue); add("Tracker issues", issue + " " + ((info[issue] || {}).summary || ""), "matched to " + unit, R.unit(unit), issue); });
    Object.keys(info).forEach(function (k) { if (!seen.has(k)) add("Tracker issues", k + " " + info[k].summary, info[k].status, R.tracker("match"), k); });
  }
  return out;
}

function searchRank(entries, q) {
  q = str(q).trim().toLowerCase();
  if (!q) return [];
  var words = q.split(/\s+/);
  var scored = [];
  entries.forEach(function (e) {
    var s = 0;
    if (e.key === q) s = 100; else if (e.key.indexOf(q) === 0) s = 60; else if (e.label.toLowerCase().indexOf(q) === 0) s = 50;
    else if (words.every(function (w) { return e.text.indexOf(w) >= 0; })) s = 20 + (e.label.toLowerCase().indexOf(words[0]) >= 0 ? 10 : 0);
    if (s) scored.push({ e: e, s: s });
  });
  scored.sort(function (a, b) { return b.s - a.s || a.e.label.length - b.e.label.length || natural(a.e.label, b.e.label); });
  var groups = new Map(), order = [];
  scored.forEach(function (x) { if (!groups.has(x.e.group)) { groups.set(x.e.group, []); order.push(x.e.group); } if (groups.get(x.e.group).length < 8) groups.get(x.e.group).push(x.e); });
  // the group holding the best match leads
  return order.map(function (g) { return { group: g, items: groups.get(g) }; });
}

function boot() {
  var dataEl = $("de-bundle"), bundle;
  try { bundle = JSON.parse(dataEl.textContent || "{}"); } catch (e) { bundle = {}; console.error("Plumb: bundle JSON did not parse", e); }
  var ix = buildIndex(bundle);
  // Notes can be written only when the dev server served this page (it injects window.DE_DEV with this run's token).
  var dev = typeof window !== "undefined" && window.DE_DEV && window.DE_DEV.token && /^https?:$/.test(location.protocol) ? window.DE_DEV : null;
  ix.edit = !!dev;
  var title = (bundle.instance && bundle.instance.title) || document.title;
  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var safe = function (name, fn) { try { return fn(); } catch (e) { console.error("Plumb: " + name + " failed", e); } };
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* unavailable */ } } };
  var sess = { get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* unavailable */ } } };
  var S = {
    ix: ix, bundle: bundle, reduce: reduce, lens: "zone", hiddenElKinds: new Set(), hiddenRelKinds: new Set(), sel: null, page: null, route: null,
    tour: { on: false, n: 1, last: 1, which: "story", lastBy: {} }, tourHighlight: null, dev: dev
  };
  var lensSaved = store.get("de-lens"); if (["zone", "owner", "fidelity", "findings", "plan"].indexOf(lensSaved) >= 0) S.lens = lensSaved;
  S.save = function () { store.set("de-lens", S.lens); };
  document.documentElement.classList.add("js");

  // ---------- live region and toast ----------
  var lastMsg = "", repeat = 0, liveTimer = null, pending = null;
  S.announce = function (msg) {
    pending = msg;
    if (liveTimer) return;
    var flush = function () {
      liveTimer = null; if (pending == null) return;
      var m = pending; pending = null;
      repeat = m === lastMsg ? repeat + 1 : 0; lastMsg = m;
      var el = $("live"); if (el) el.textContent = repeat ? m + " (" + (repeat + 1) + ")" : m;
      liveTimer = setTimeout(function () { liveTimer = null; if (pending != null) flush(); }, 1000);
    };
    flush();
  };
  var toastTimer = null;
  /** A toast; link: { href, label } to the record it is about (a changed note), shown beside the message. */
  S.toast = function (msg, link) {
    var t = $("toast"), tx = $("toast-text"), ln = $("toast-link"); if (!t || !tx) return;
    tx.textContent = msg; t.hidden = false;
    if (ln) { ln.hidden = !link; if (link) { ln.href = link.href; ln.textContent = link.label; } }
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 5000);
    S.announce(msg);
  };
  safe("toast", function () { $("toast-close").addEventListener("click", function () { $("toast").hidden = true; }); });

  // ---------- theme ----------
  safe("theme", function () {
    var btn = $("theme-btn"), menu = $("theme-menu"), cur = store.get("de-theme") || "auto";
    if (["auto", "light", "dark"].indexOf(cur) < 0) cur = "auto";
    var apply = function () {
      if (cur === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", cur);
      $$("[data-theme-set]", menu).forEach(function (b) { b.setAttribute("aria-checked", b.getAttribute("data-theme-set") === cur ? "true" : "false"); });
      btn.setAttribute("aria-label", "Colour theme: " + cap1(cur));
    };
    btn.hidden = false; apply();
    var close = function (focusBtn) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); if (focusBtn) btn.focus(); };
    btn.addEventListener("click", function () { var open = menu.hidden; menu.hidden = !open; btn.setAttribute("aria-expanded", open ? "true" : "false"); if (open) (menu.querySelector('[aria-checked="true"]') || menu.firstElementChild).focus(); });
    menu.addEventListener("click", function (ev) { var b = ev.target.closest("[data-theme-set]"); if (!b) return; cur = b.getAttribute("data-theme-set"); store.set("de-theme", cur); apply(); close(true); });
    menu.addEventListener("keydown", function (ev) {
      var items = $$("[data-theme-set]", menu), i = items.indexOf(document.activeElement);
      if (ev.key === "Escape") { close(true); ev.stopPropagation(); }
      else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); items[(i + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
    });
    document.addEventListener("click", function (ev) { if (!menu.hidden && !ev.target.closest(".menu-wrap")) close(false); });
  });

  // ---------- selection ----------
  var selSaved = sess.get("de-sel:" + location.pathname);
  try { var ss = JSON.parse(selSaved || "null"); if (ss && ((ss.kind === "element" && ix.el.has(ss.id)) || (ss.kind === "unit" && ix.unit.has(ss.id)))) S.sel = ss; } catch (e) { /* ignore */ }
  S.setSelection = function (sel, fromPage) {
    var same = (S.sel && sel && S.sel.kind === sel.kind && S.sel.id === sel.id) || (!S.sel && !sel);
    S.sel = sel;
    sess.set("de-sel:" + location.pathname, JSON.stringify(sel));
    // the selection is a chip in the bar and a key in the hash (replaced, never pushed: selecting is not navigating)
    if (S.st) {
      S.st.sel = sel ? sel.kind + ":" + sel.id : null;
      if (!same && history.replaceState && !/^#(tour|learn|present)/.test(location.hash)) history.replaceState(null, "", withState(location.hash || "#overview", S.st));
    }
    safe("chips", function () { chipBar(S); });
    if (!same && !fromPage) refreshMarks();
    if (!same && fromPage) refreshMarks(true);
  };
  function refreshMarks(skipCurrent) {
    if (S.planCtl && !(skipCurrent && S.page === "plan")) S.planCtl.marks();
    if (S.checksCtl) S.checksCtl.pinned();
    if (S.changesCtl) S.changesCtl.marks();
  }
  safe("sel", function () {
    document.addEventListener("click", function (ev) {
      if (!(ev.target.closest && ev.target.closest("#sel-clear"))) return;
      S.setSelection(null);
      if (S.page === "model" && S.modelCtl) { var M = S.modelCtl.state(); M.sel = null; S.go(M.mode === "focus" ? R.focus(M.focus, M.depth) : M.mode === "zone" ? R.zone(M.zone) : M.view ? R.view(M.view) : "#model", { replace: true }); }
      else if (S.page === "plan") S.go("#plan", { replace: true });
      refreshMarks();
    });
  });

  // ---------- navigation ----------
  var quietNext = false;
  S.go = function (hash, o) {
    o = o || {};
    hash = carryState(S, hash);
    if (location.hash === hash) { route(); return; }
    if (o.replace && history.replaceState) { history.replaceState(null, "", hash); if (!o.quiet) route(); }
    else { quietNext = !!o.quiet; location.hash = hash; }
  };
  S.tourTarget = function () { /* placeholder: the tour scrolls its own targets */ };

  function showPage(name) {
    if (!PAGE_TITLE[name] || !$(name)) name = "overview";
    $$("main > .page").forEach(function (p) { p.hidden = p.getAttribute("data-page") !== name; });
    $$("[data-nav]").forEach(function (a) { if (a.getAttribute("data-nav") === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    var nc = $("nav-current"); if (nc) nc.textContent = PAGE_TITLE[name];
    var changed = S.page !== name;
    S.page = name;
    document.title = (name === "overview" ? "Overview" : PAGE_TITLE[name]) + " · " + title;
    return { name: name, changed: changed };
  }

  // Back lands where the reader left: the hashes visited, and how far down each page was when it was left
  var visited = [], scrolledAt = {};
  function route() {
    var r = parseRoute(location.hash), quiet = quietNext; quietNext = false;
    var hNow = location.hash || "#overview";
    if (visited.length) scrolledAt[visited[visited.length - 1]] = window.scrollY;
    S.back = visited.length >= 2 && visited[visited.length - 2] === hNow;
    if (S.back) visited.pop(); else if (visited[visited.length - 1] !== hNow) visited.push(hNow);
    S.backY = S.back ? scrolledAt[hNow] : undefined;
    if (S.closeDrawers) S.closeDrawers();
    if (S.hideCard) S.hideCard();
    if (S.hideGloss) S.hideGloss();
    closeGpop();
    if (r.page === "tour" || r.page === "learn") { tourShow(r.n, r.page === "learn" ? "learn" : "story"); return; }
    if (S.tour.on) tourExit(true);
    showRoute(r, quiet);
    // a team opened from anywhere: its card on top of the Teams page, once the page has drawn
    if (S.pendingTeam && r.page === "teams") { var pt = S.pendingTeam; S.pendingTeam = null; safe("team card", function () { S.openDrawer("team", pt.id, pt.trigger); }); }
  }

  function showRoute(r, quiet) {
    // present mode: the deck covers the page; any other route puts it away
    if (r.page === "present") {
      if (S.presentCtl === undefined) S.presentCtl = safe("present", function () { return presentCtl(S); }) || null;
      if (S.presentCtl) { S.presentCtl.show(r.n); S.page = "present"; S.route = r; return; }
      r = { page: "overview", q: {} };
    }
    if (S.presentCtl && S.page === "present") S.presentCtl.hide();
    if (!/^#(tour|learn|present)/.test(location.hash)) S.beforePresent = location.hash || "#overview";
    // legacy rule anchors: #rule-<pack>-<rule> → find the pack by prefix
    if (r.sub === "legacy-rule") {
      ix.rules.forEach(function (v, k) { var p = k.split("/"); if (r.id === p[0] + "-" + p.slice(1).join("/")) { r = { page: "checks", sub: "rule", pack: p[0], id: p.slice(1).join("/"), q: r.q }; } });
    }
    var pg = showPage(r.page);
    var prevRoute = S.route, prevF = S.st ? stateQuery({ f: S.st.f, trail: S.st.trail }) : "";
    S.route = r;
    safe("state", function () {
      applyState(S, r);
      var sk = S.st.sel ? splitKey(S.st.sel) : null;
      if (sk && recordOf(ix, sk.kind, sk.id) && !(S.sel && S.sel.kind === sk.kind && S.sel.id === sk.id)) { S.sel = sk; sess.set("de-sel:" + location.pathname, JSON.stringify(sk)); }
      else if (!sk && S.sel) S.st.sel = S.sel.kind + ":" + S.sel.id;
    });
    safe(pg.name, function () {
      if (pg.name === "model") { S.modelCtl = S.modelCtl || modelPage(S); S.modelCtl.show(r); }
      else if (pg.name === "plan") { S.planCtl = S.planCtl || planPage(S); S.planCtl.show(r); }
      else if (pg.name === "checks") { S.checksCtl = S.checksCtl || checksPage(S); S.checksCtl.show(r); }
      else if (pg.name === "changes") { S.changesCtl = S.changesCtl || changesPage(S); S.changesCtl.show(r); }
      else if (pg.name === "tracker") { S.trackerCtl = S.trackerCtl || trackerPageCtl(S); S.trackerCtl.show(r); }
      else if (pg.name === "strategy") { S.strategyCtl = S.strategyCtl || strategyPageCtl(S); S.strategyCtl.show(r); }
      else if (pg.name === "notes") { S.notesCtl = S.notesCtl || notesPageCtl(S); S.notesCtl.show(r); }
      else if (pg.name === "overview") { S.overviewCtl = S.overviewCtl || overviewCtl(S); S.overviewCtl.show(r); }
    });
    if (pg.name === "teams") safe("teams", function () { S.teamsCtl = S.teamsCtl || teamsPageCtl(S); if (S.teamsCtl) S.teamsCtl.show(r); });
    if (pg.name === "teams" || pg.name === "tracker") safe("fade", function () { fadeRefs(S, $(pg.name), pg.name); });
    if (pg.name === "plan") safe("focus", function () { focusMilestones(S); });
    if (pg.name === "tracker") safe("focus", function () { focusTracker(S); });
    // the glossary: a definition on hover or focus at each term's first use in this page's section headings
    if (S.glossifyPage) safe("glossary", function () { S.glossifyPage(document.querySelector('main > .page[data-page="' + pg.name + '"]')); });
    safe("chips", function () { chipBar(S); });
    var nowF = S.st ? stateQuery({ f: S.st.f, trail: S.st.trail }) : "";
    var landing = !quiet && (pg.changed || !prevRoute || prevRoute.sub !== r.sub || prevRoute.id !== r.id) ? listAnchor(r) : null;
    if (pg.changed && !quiet) {
      if (S.back && S.backY != null) window.scrollTo(0, S.backY);
      else if (landing) { window.scrollTo(0, 0); landing.el.scrollIntoView({ block: landing.block }); }
      else if (!(r.sub === "rule" || r.sub === "pack")) window.scrollTo(0, 0);
      var h1 = document.querySelector('[data-page="' + pg.name + '"] h1');
      if (h1 && !S.tour.on && !S.booting) h1.focus({ preventScroll: true });
    } else if (landing) landing.el.scrollIntoView({ block: landing.block, behavior: S.reduce ? "auto" : "smooth" });
    else if (!pg.changed && !quiet && !S.back && nowF !== prevF) {
      // a page's own list narrowed in place: bring the list, and its heading saying what it shows, into view
      var own = ownList(pg.name);
      if (own && own.getBoundingClientRect) { var rb = own.getBoundingClientRect(); if (rb.top < 0 || rb.top > window.innerHeight - 120) own.scrollIntoView({ block: "start", behavior: S.reduce ? "auto" : "smooth" }); }
    }
    if (!pg.changed && !quiet && (r.sub === "unit" || r.sub === "patch" || r.sub === "claim")) {
      var target = r.sub === "claim" ? $("claim-detail") : r.sub === "unit" ? $("unit-detail") : document.querySelector('.patch[data-patch="' + cssEscape(r.id) + '"] h2');
      var h2 = target && (target.tagName === "H2" ? target : target.querySelector("h2"));
      if (h2) { h2.focus({ preventScroll: true }); if (!isWide(1200) && h2.scrollIntoView) h2.scrollIntoView({ block: "start" }); }
    }
  }
  /** Where a route that names a list lands: the list's heading (the Plan's units, the Model's elements, a Tracker group, a milestone). */
  function listAnchor(r) {
    var el = null, block = "start";
    if (r.page === "plan" && r.sub === "units") el = $("h-units");
    else if (r.page === "plan" && r.sub === "milestone") { el = document.querySelector('[data-gate-panel="' + cssEscape(r.id) + '"]'); block = "nearest"; }
    else if (r.page === "model" && r.sub === "elements") el = $("h-all-el");
    else if (r.page === "tracker" && r.sub === "match" && r.id) el = $("tracker-" + r.id);
    return el && el.scrollIntoView ? { el: el, block: block } : null;
  }
  /** The list a page narrows in place when its filters change. */
  function ownList(page) {
    if (page === "plan") return $("h-units");
    if (page === "model") return S.modelCtl && S.modelCtl.state().mode === "elements" ? $("h-all-el") : null;
    if (page === "strategy") return $("h-claims");
    if (page === "teams") { var tw = $("team-work"); return tw && !tw.hidden ? tw : null; }
    if (page === "checks") return $("checks-filtered");
    if (page === "notes") return $("note-count");
    if (page === "changes") return document.querySelector(".changes-list");
    return null;
  }
  window.addEventListener("hashchange", route);

  // ---------- pages sheet (narrow) and views sheet ----------
  function sheet(id, titleText, bodyHtml, trigger) {
    var d = $(id);
    if (!d) {
      d = document.createElement("dialog"); d.id = id; d.className = "sheet"; d.setAttribute("aria-labelledby", id + "-h");
      d.innerHTML = '<div class="sh-head"><h2 id="' + id + '-h" style="font-size:var(--fs-lg)">' + esc(titleText) + '</h2><button type="button" class="btn quiet icon-only" data-close aria-label="Close">' + icon("close") + '</button></div><div class="sh-body"></div>';
      document.body.appendChild(d);
      d.addEventListener("click", function (ev) { if (ev.target === d || ev.target.closest("[data-close]") || ev.target.closest("a[href^='#']")) d.close(); });
      d.addEventListener("close", function () { if (d._trigger && d._trigger.focus) d._trigger.focus(); });
    }
    d.querySelector(".sh-body").innerHTML = bodyHtml;
    d._trigger = trigger;
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    return d;
  }
  safe("pages", function () {
    var pb = $("pages-btn"); pb.hidden = false;
    pb.addEventListener("click", function () {
      sheet("pages-sheet", "Pages", '<nav class="nav-sheet" aria-label="Pages">' + $$(".nav-links a").map(function (a) { return '<a href="' + a.getAttribute("href") + '"' + (a.getAttribute("aria-current") ? ' aria-current="page"' : "") + ">" + a.innerHTML + "</a>"; }).join("") + "</nav>", pb);
    });
    var vb = $("views-btn");
    if (vb) {
      vb.hidden = false;
      vb.addEventListener("click", function () {
        var d = sheet("views-sheet", "Views", '<div class="rail" style="display:block">' + $("views-rail").innerHTML + "</div>", vb);
        var f = d.querySelector(".view-filter"); if (f) { wireViewFilter(d); f.focus(); }
      });
    }
    wireViewFilter($("views-rail"));
  });
  function wireViewFilter(root) {
    var f = root.querySelector(".view-filter"); if (!f || f._wired) return; f._wired = true;
    f.addEventListener("input", function () {
      var q = f.value.toLowerCase().split(/\s+/).filter(Boolean);
      $$("a[data-text]", root).forEach(function (a) { a.parentNode.hidden = !q.every(function (w) { return a.getAttribute("data-text").indexOf(w) >= 0; }); });
      $$(".rail-group", root).forEach(function (g) { g.hidden = !$$("li:not([hidden]) a[data-text]", g).length; });
    });
  }

  // ---------- popovers: capabilities, "show in views" ----------
  var pop = null;
  function closePop() { if (pop) { var t = pop._trigger; pop.remove(); pop = null; if (t && t.focus) t.focus(); } }
  document.addEventListener("click", function (ev) {
    var cap = ev.target.closest && ev.target.closest("[data-cap]");
    if (cap) {
      ev.preventDefault();
      closePop();
      pop = document.createElement("div");
      pop.className = "popover"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Capability " + cap.getAttribute("data-cap"));
      pop.innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px"><b class="small">Capability</b><button type="button" class="btn quiet icon-only" data-pop-close aria-label="Close">' + icon("close") + "</button></div>" + capDetail(ix, cap.getAttribute("data-cap"));
      pop._trigger = cap;
      document.body.appendChild(pop);
      var r = cap.getBoundingClientRect();
      pop.style.top = (window.scrollY + r.bottom + 6) + "px";
      pop.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8)) + "px";
      pop.querySelector("[data-pop-close]").focus();
      return;
    }
    if (pop && !(ev.target.closest && ev.target.closest(".popover"))) closePop();
    else if (ev.target.closest && ev.target.closest("[data-pop-close]")) closePop();
    var vm = ev.target.closest && ev.target.closest("[data-views-menu]");
    if (vm) { var m = vm.nextElementSibling; var open = m.hidden; m.hidden = !open; vm.setAttribute("aria-expanded", open ? "true" : "false"); return; }
    $$("[data-views-menu]").forEach(function (b) { if (!(ev.target.closest && ev.target.closest(".menu-wrap") === b.parentNode)) { if (b.nextElementSibling) b.nextElementSibling.hidden = true; b.setAttribute("aria-expanded", "false"); } });
    var close = ev.target.closest && ev.target.closest("[data-insp-close]");
    if (close) { $("sel-clear").click(); }
    var km = $("kinds-menu"), kb = $("kinds-btn");
    if (km && !km.hidden && !(ev.target.closest && (ev.target.closest("#kinds-menu") || ev.target.closest("#kinds-btn")))) { km.hidden = true; if (kb) kb.setAttribute("aria-expanded", "false"); }
  });

  // ---------- copy ----------
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-copy]"); if (!b) return;
    var text = b.getAttribute("data-copy");
    var ok = function () { S.toast("Copied"); };
    var fallback = function () {
      var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) { S.toast("Copy is not available here"); }
      ta.remove(); b.focus();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
  });
  $$("[data-copy][hidden]").forEach(function (b) { b.hidden = false; });

  // ---------- times ----------
  $$("time[data-human]").forEach(function (t) { t.textContent = humanTime(t.getAttribute("datetime")); });
  $$("time[data-age]").forEach(function (t) {
    var d = new Date(t.getAttribute("datetime")), now = Date.now();
    if (isNaN(d.getTime())) return;
    var days = Math.floor((now - d.getTime()) / 864e5);
    t.textContent = days <= 0 ? "today" : days === 1 ? "1 day ago" : days < 60 ? days + " days ago" : humanTime(t.getAttribute("datetime"));
    t.title = humanTime(t.getAttribute("datetime"));
  });

  // ---------- command palette ----------
  var entries = null, pal = null, active = -1, flat = [];
  function openPalette(trigger) {
    entries = entries || searchIndex(ix);
    if (!pal) {
      pal = document.createElement("dialog");
      pal.className = "palette"; pal.setAttribute("aria-label", "Search and jump");
      pal.innerHTML = '<div class="pin">' + icon("search") + '<input type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" aria-label="Search parts, units, views, rules, findings, patches" placeholder="Search parts, units, rules, patches, issue keys" autocomplete="off" spellcheck="false"><span class="kbd">Esc</span></div>'
        + '<div class="res" id="pal-list" role="listbox" aria-label="Results"></div><div class="hint"><span>Up and Down move</span><span>Enter goes</span><span>Shift Enter focuses a part’s neighbourhood</span></div>';
      document.body.appendChild(pal);
      var input = pal.querySelector("input");
      input.addEventListener("input", renderResults);
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); if (!flat.length) return; active = (active + (ev.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length; mark(); }
        else if (ev.key === "Enter") { ev.preventDefault(); var e = flat[active] || flat[0]; if (e) choose(e, ev.shiftKey); }
      });
      pal.querySelector(".res").addEventListener("click", function (ev) { var o = ev.target.closest("[data-i]"); if (o) choose(flat[Number(o.getAttribute("data-i"))], ev.shiftKey); });
      pal.addEventListener("click", function (ev) { if (ev.target === pal) pal.close(); });
      pal.addEventListener("close", function () { if (pal._trigger && pal._trigger.focus) pal._trigger.focus(); });
    }
    pal._trigger = trigger || document.activeElement;
    var inp = pal.querySelector("input"); inp.value = ""; renderResults();
    if (pal.showModal) pal.showModal(); else pal.setAttribute("open", "");
    inp.focus();
  }
  function renderResults() {
    var q = pal.querySelector("input").value, groups = searchRank(entries, q), html = [];
    flat = []; active = 0;
    groups.forEach(function (g) {
      html.push('<div class="grp" role="presentation">' + esc(g.group) + "</div>");
      g.items.forEach(function (e) { html.push('<div role="option" id="pal-o' + flat.length + '" data-i="' + flat.length + '" aria-selected="false"><span>' + esc(e.label) + '</span><span class="sub">' + esc(e.sub) + "</span></div>"); flat.push(e); });
    });
    pal.querySelector(".res").innerHTML = q.trim() ? (html.join("") || '<p class="empty" style="padding:8px">Nothing matches.</p>') : '<p class="empty" style="padding:8px">Type a name, an id such as U-05, a rule, or an issue key.</p>';
    mark();
  }
  function mark() {
    $$("[role=option]", pal).forEach(function (o, i) { o.setAttribute("aria-selected", i === active ? "true" : "false"); if (i === active && o.scrollIntoView) o.scrollIntoView({ block: "nearest" }); });
    var inp = pal.querySelector("input"); if (flat[active]) inp.setAttribute("aria-activedescendant", "pal-o" + active); else inp.removeAttribute("aria-activedescendant");
  }
  function choose(e, alt) { pal.close(); S.go(alt && e.extra && e.extra.focus ? e.extra.focus : e.href); }
  safe("palette", function () { var sb = $("search-btn"); sb.hidden = false; sb.addEventListener("click", function () { openPalette(sb); }); });

  // ---------- help: one screen of keys and moves ----------
  var help = null;
  function openHelp() {
    if (!help) {
      help = document.createElement("dialog"); help.className = "help cheat"; help.setAttribute("aria-labelledby", "help-h");
      var row = function (k, d) { return "<dt>" + k.split(" ").map(function (x) { return '<span class="kbd">' + esc(x) + "</span>"; }).join(" ") + "</dt><dd>" + esc(d) + "</dd>"; };
      var move = function (m, d) { return "<dt>" + esc(m) + "</dt><dd>" + esc(d) + "</dd>"; };
      help.innerHTML = '<div class="sh-head"><h2 id="help-h">Keys and moves</h2><span class="grow"></span>' + (tours.learn ? '<button type="button" class="btn sm" data-learn-start>' + icon("play", "icon icon-sm") + "Learn the interface</button>" : "") + '<button type="button" class="btn quiet icon-only" data-close aria-label="Close">' + icon("close") + "</button></div>"
        + '<div class="cheat-cols"><section><h3>Moves, on every page</h3><dl class="moves">'
        + move("Hover", "Rest on any reference for its card")
        + move("Click", "Open its drawer; a record in a drawer opens another on top")
        + move("Esc or Back", "Close the top drawer; the page stays as it was")
        + move("Title in a drawer", "Open the record's full page")
        + move("Filter", "Add a chip; every page keeps what matches, and the address holds it")
        + move("× on a chip", "Remove it; Back undoes any filter change")
        + move("Follow", "Go from the set on screen to what it links to, counts first")
        + move("Crumbs", "Climb back a step, with its filter live again")
        + move("A tile", "Switch the Overview's work area; a bar sets its chip")
        + move("A zone", "Open its drawing; a doorway crosses to the next zone")
        + move("A team", "Open its card and list its open work")
        + "</dl></section><section><h3>Anywhere</h3><dl>" + row("/", "Search and jump (also ⌘K or Ctrl K)") + row("?", "This sheet") + row("T", "Start or resume a tour") + ($("present") ? row("P", "Present the deck") : "") + row("Esc", "Close the top drawer or dialog, or leave the tour")
        + "</dl><h3>Tour and deck</h3><dl>" + row("→ Space", "Next step or slide") + row("←", "Back") + row("Home End", "First or last") + ($("present") ? row("N", "Speaker notes in their own window") + row("⇧N", "Speaker notes under the slide") + row("F", "Full screen") : "")
        + "</dl><h3>Drawings (Tab to a part)</h3><dl>" + row("→ ←", "Follow a relationship out or in") + row("↑ ↓", "Move within a column") + row("Enter", "Select the part") + row("F", "Its neighbourhood") + row("+ − 0", "Zoom in, out, fit") + row("⇧ arrows", "Pan") + "</dl></section></div>";
      document.body.appendChild(help);
      help.addEventListener("click", function (ev) {
        if (ev.target === help || ev.target.closest("[data-close]")) help.close();
        if (ev.target.closest("[data-learn-start]")) { help.close(); startTour("learn"); }
      });
      help.addEventListener("close", function () { if (help._trigger && help._trigger.focus) help._trigger.focus(); });
    }
    help._trigger = document.activeElement;
    if (help.showModal) help.showModal(); else help.setAttribute("open", "");
  }

  // ---------- tour ----------
  // two tours: the story of this design (tour.yaml) and "Learn the interface" (client/learn.js, from this bundle)
  var tours = { story: bundle.tour && arr(bundle.tour.steps).length ? bundle.tour : null, learn: safe("learn", function () { return learnTour(ix); }) || null };
  var tour = tours.story;
  var tourPrefix = function (w) { return w === "learn" ? "#learn/" : "#tour/"; };
  var stepHash = function (st) { return st.hash || tourHash(st.target); };
  function captionBar() {
    var c = $("tour-caption");
    if (!c) {
      c = document.createElement("div"); c.id = "tour-caption"; c.className = "caption"; c.setAttribute("role", "region"); c.setAttribute("aria-label", "Tour");
      c.innerHTML = '<div class="inner"><div><p class="step" id="tour-step"></p><h2 id="tour-title" tabindex="-1"></h2><p id="tour-say"></p><p id="tour-missing" class="st warning sm" hidden></p></div>'
        + '<div class="acts"><button type="button" class="btn" id="tour-back">Back</button><button type="button" class="btn primary" id="tour-next">Next</button><button type="button" class="btn quiet" id="tour-exit">Exit</button></div></div>';
      document.body.appendChild(c);
      $("tour-back").addEventListener("click", function () { tourGo(S.tour.n - 1); });
      $("tour-next").addEventListener("click", function () { tourGo(S.tour.n + 1); });
      $("tour-exit").addEventListener("click", function () { tourExit(); });
    }
    return c;
  }
  // past the last step (Finish, or Next or the right arrow there) the tour ends: back where it started, and it says how to replay it
  function tourGo(n) { if (!tour) return; if (n > tour.steps.length && S.tour.on) { tourFinish(); return; } n = Math.max(1, Math.min(tour.steps.length, n)); S.go(tourPrefix(S.tour.which) + n); }
  function tourFinish() {
    var which = S.tour.which, from = S.tour.from || "#overview";
    S.tour.lastBy[which] = 1; // T, or Tour in the header, replays it from the first step
    tourExit(true);
    S.go(from);
    S.toast((which === "learn" ? "Learn the interface" : "The tour") + " is finished. Press T, or Tour in the header, to replay it.", { href: tourPrefix(which) + "1", label: "Replay it" });
  }
  function tourShow(n, which) {
    which = which || "story";
    var switching = S.tour.on && S.tour.which !== which;
    tour = tours[which];
    if (!tour) { S.go("#overview", { replace: true }); return; }
    n = Math.max(1, Math.min(tour.steps.length, n || 1));
    var st = tour.steps[n - 1], prev = S.tour.on && !switching ? tour.steps[S.tour.n - 1] : null;
    if (!S.tour.on) S.tour.from = S.beforePresent || "#overview"; // where the reader was when the tour started: Finish returns there
    S.tour.on = true; S.tour.n = n; S.tour.last = n; S.tour.which = which; S.tour.lastBy[which] = n;
    document.documentElement.classList.add("presenting");
    document.documentElement.classList.toggle("learning", which === "learn");
    var c = captionBar(); c.hidden = false;
    $("tour-step").textContent = "Step " + n + " of " + tour.steps.length + " · " + tour.title;
    $("tour-title").textContent = st.title;
    $("tour-say").innerHTML = linkifyText(ix, st.say);
    if (S.glossify) safe("glossary", function () { S.glossify([$("tour-title"), $("tour-say")]); });
    var miss = $("tour-missing");
    miss.hidden = !st.missing;
    if (st.missing) miss.innerHTML = icon("warning") + '<span class="w">This step’s target is gone (' + esc(st.missing) + ").</span>";
    $("tour-back").disabled = n === 1;
    $("tour-next").textContent = n === tour.steps.length ? "Finish" : "Next";
    S.captionH = c.offsetHeight;
    document.documentElement.style.setProperty("--caption-h", (c.offsetHeight + 16) + "px");
    S.tourHighlight = st.highlight && st.highlight.length ? new Set(st.highlight) : null;
    var sameView = prev && typeof prev.target === "object" && typeof st.target === "object" && prev.target.view != null && prev.target.view === st.target.view;
    var r = parseRoute(stepHash(st));
    document.documentElement.classList.toggle("tour-inspect", r.page === "model" && (r.sub === "element" || r.sub === "focus"));
    showRoute(r, true);
    if (r.page === "model" && S.modelCtl && !sameView) S.modelCtl.refresh(true);
    if (sameView && S.modelCtl) S.modelCtl.highlight();
    if (!sameView) window.scrollTo(0, 0);
    // a rule or finding step lands on that rule's block, opened, its finding's row marked; not the top of Checks
    var anc = tourAnchor(st.target), ael = anc && document.getElementById(anc);
    $$(".tour-spot").forEach(function (x) { x.classList.remove("tour-spot"); });
    if (ael) {
      if (ael.tagName === "DETAILS") ael.open = true;
      var fat = st.target.finding != null ? str(st.target.finding).slice(str(st.target.finding).indexOf("@") + 1) : null;
      var row = fat ? $$(".subjects li", ael).filter(function (li) { var a = li.getAttribute("data-at") || ""; return a.slice(a.indexOf(":") + 1) === fat; })[0] : null;
      (row || ael).classList.add("tour-spot");
      if ((row || ael).scrollIntoView) (row || ael).scrollIntoView({ block: row ? "center" : "start" });
    }
    if (r.page === "model" && S.modelCtl && r.sub === "element") S.modelCtl.centerNode(r.id, true, 1);
    if (r.page === "model" && S.modelCtl && S.tourHighlight) S.modelCtl.fitTo(S.tourHighlight);
    S.announce("Step " + n + " of " + tour.steps.length + ": " + st.title);
    $("tour-title").focus({ preventScroll: true });
    if (st.act) learnAct(st);
  }
  /** A Learn step's move, performed on screen: a card on hover, a drawer, a second drawer on top. */
  function learnAct(st) {
    var k = splitKey(st.ref || ""), el = null;
    $$('[data-page="' + S.page + '"] a[data-unit="' + cssEscape(k.id) + '"], [data-page="' + S.page + '"] [data-ref="' + cssEscape(st.ref || "") + '"]').some(function (x) { if (x.offsetParent) { el = x; return true; } return false; });
    $$(".learn-spot").forEach(function (x) { x.classList.remove("learn-spot"); });
    if (el) { el.classList.add("learn-spot"); if (el.scrollIntoView) el.scrollIntoView({ block: "center" }); }
    setTimeout(function () {
      if (!S.tour.on) return;
      if (st.act === "hover" && el && S.showCardAt) S.showCardAt(el);
      if (st.act === "drawer" || st.act === "stack") S.openDrawer(k.kind, k.id, el);
      if (st.act === "stack" && st.ref2) { var k2 = splitKey(st.ref2); S.openDrawer(k2.kind, k2.id); }
      $("tour-title").focus({ preventScroll: true });
    }, 120);
  }
  function tourExit(silent) {
    if (!S.tour.on) return;
    S.tour.on = false;
    document.documentElement.classList.remove("presenting", "tour-inspect", "learning");
    var c = $("tour-caption"); if (c) c.hidden = true;
    S.tourHighlight = null;
    $$(".learn-spot").forEach(function (x) { x.classList.remove("learn-spot"); });
    if (S.modelCtl) { S.modelCtl.highlight(); if (S.page === "model") S.modelCtl.refresh(true); }
    if (!silent && tour) {
      var h = stepHash(tour.steps[S.tour.n - 1]);
      if (history.replaceState) history.replaceState(null, "", h);
      showRoute(parseRoute(h), true);
      S.announce("Left the tour. Press T to resume at step " + S.tour.n + ".");
    }
  }
  function startTour(which) { S.go(tourPrefix(which) + (S.tour.lastBy[which] || 1)); }
  S.startTour = startTour;
  safe("tour", function () {
    var tb = $("tour-btn"); if (!tb || (!tours.story && !tours.learn)) return;
    tb.hidden = false;
    tb.addEventListener("click", function (ev) {
      if (!tours.story || !tours.learn) { startTour(tours.story ? "story" : "learn"); return; }
      ev.stopPropagation(); // the document listener closes any open popover on a click outside it
      openGpop(tb, '<p class="gpop-h">Tour</p><ul class="gpop-list" role="menu">'
        + '<li><button type="button" role="menuitem" data-tour-pick="story"><span class="v">Story of this design</span><span class="n">' + esc(PROSE.count(tours.story.steps.length, "step")) + "</span></button></li>"
        + '<li><button type="button" role="menuitem" data-tour-pick="learn"><span class="v">Learn the interface</span><span class="n">' + esc(PROSE.count(tours.learn.steps.length, "step")) + "</span></button></li></ul>", "Tours");
    });
    document.addEventListener("click", function (ev) { var p = ev.target.closest && ev.target.closest("[data-tour-pick]"); if (!p) return; closeGpop(); startTour(p.getAttribute("data-tour-pick")); });
  });

  // ---------- global keys ----------
  document.addEventListener("keydown", function (ev) {
    var t = ev.target, typing = t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    var dialogOpen = !!document.querySelector("dialog[open]");
    if ((ev.metaKey || ev.ctrlKey) && (ev.key === "k" || ev.key === "K")) { ev.preventDefault(); if (!dialogOpen) openPalette(); return; }
    if (typing || dialogOpen || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (pop && ev.key === "Escape") { closePop(); return; }
    if (S.tour.on) {
      if (ev.key === "ArrowRight" || ev.key === " " || ev.key === "PageDown") { ev.preventDefault(); tourGo(S.tour.n + 1); return; }
      if (ev.key === "ArrowLeft" || ev.key === "PageUp") { ev.preventDefault(); tourGo(S.tour.n - 1); return; }
      if (ev.key === "Home") { ev.preventDefault(); tourGo(1); return; }
      if (ev.key === "End") { ev.preventDefault(); tourGo(tour.steps.length); return; }
      if (ev.key === "Escape") { ev.preventDefault(); tourExit(); return; }
    }
    if (S.page === "present" && S.presentCtl) { if (ev.key === "?") { ev.preventDefault(); openHelp(); return; } if (S.presentCtl.key(ev)) return; return; }
    if (t && t.closest && t.closest(".canvas")) { if (ev.key === "?") { ev.preventDefault(); openHelp(); } return; }
    if (ev.key === "/") { ev.preventDefault(); openPalette(); }
    else if (ev.key === "?") { ev.preventDefault(); openHelp(); }
    else if ((ev.key === "t" || ev.key === "T") && (tours.story || tours.learn)) { ev.preventDefault(); startTour(S.tour.lastBy[S.tour.which] ? S.tour.which : tours.story ? "story" : "learn"); }
    else if ((ev.key === "p" || ev.key === "P") && $("present")) { ev.preventDefault(); S.go(R.present(S.presentCtl ? S.presentCtl.current() : 1)); }
  });

  // ---------- resize (one-shot, debounced) ----------
  var rt = null;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (S.page === "model" && S.modelCtl) S.modelCtl.resize(); }, 150); });

  // ---------- live reload hooks (called by the dev server's snippet; absent from the offline file) ----------
  api.state = function () {
    var M = S.modelCtl ? S.modelCtl.state() : null;
    return { hash: location.hash, x: window.scrollX, y: window.scrollY, lens: S.lens, hiddenEl: Array.from(S.hiddenElKinds), hiddenRel: Array.from(S.hiddenRelKinds),
      cam: M && M.cam ? { k: M.cam.k, tx: M.cam.tx, ty: M.cam.ty } : null, open: $$("details[open][id]").map(function (d) { return d.id; }),
      summary: { hash: bundle.engine && bundle.engine.hash, patches: arr(bundle.patches).map(function (p) { return p.id + ":" + p.status; }), findings: arr(bundle.findings).length, digest: DIGEST.digest(bundle) } };
  };
  api.restore = function (s) {
    if (!s) return;
    S.lens = s.lens || S.lens; arr(s.hiddenEl).forEach(function (k) { S.hiddenElKinds.add(k); }); arr(s.hiddenRel).forEach(function (k) { S.hiddenRelKinds.add(k); });
    arr(s.open).forEach(function (id) { var d = document.getElementById(id); if (d) d.open = true; });
    if (s.hash && location.hash !== s.hash && history.replaceState) history.replaceState(null, "", s.hash);
    route();
    if (s.cam && S.modelCtl) { var M = S.modelCtl.state(); M.cam && (M.cam.k = s.cam.k, M.cam.tx = s.cam.tx, M.cam.ty = s.cam.ty, M.cam.apply()); }
    window.scrollTo(s.x || 0, s.y || 0);
    var before = s.summary || {}, now = api.state().summary, parts = [];
    var li = $("live-ind"); if (li) { li.hidden = false; li.textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    if (S.since && S.since.absorb) S.since.absorb();
    if (before.digest) {
      // the same comparison as "Since you last looked", from the build before the reload to this one
      var d = DIGEST.compare(before.digest, now.digest, DIGEST.names(bundle));
      // a note answered, added or resolved: the toast links to it (the first, when several changed)
      var nn = arr(d.notes && d.notes.answered).concat(arr(d.notes && d.notes.added), arr(d.notes && d.notes.resolved));
      S.toast(DIGEST.isEmpty(d) ? "Updated: rebuilt with nothing changed" : PROSE.sentence("Updated: " + sinceList(d, DIGEST.names(bundle))), nn.length ? { href: "#notes/" + encodeURIComponent(nn[0].id), label: nn.length === 1 ? "Open the note" : "Open the first note" } : null);
    } else {
      var bp = new Set(arr(before.patches));
      now.patches.forEach(function (p) { if (!bp.has(p)) parts.push(p.split(":")[0] + " " + p.split(":")[1]); });
      if (before.findings != null && before.findings !== now.findings) parts.push(PROSE.count(Math.abs(now.findings - before.findings), (now.findings > before.findings ? "more" : "fewer") + " finding"));
      S.toast(parts.length ? "Updated: " + PROSE.list(parts) : "Updated: rebuilt with no change to patches or findings");
    }
  };
  api.live = function () { var li = $("live-ind"); if (li) li.hidden = false; };

  // focus: a team or a lead the reader picked, kept per browser; applied by every page after it draws
  S.reroute = function () { if (S.tour.on || S.page === "present") return; safe("route", function () { showRoute(parseRoute(location.hash), true); }); };
  safe("focus", function () { wireFocus(S, store); });
  safe("grammar", function () { wireGrammar(S); });
  safe("glossary", function () { wireGlossary(S); });
  safe("linkify", function () { linkifyAll(S, document); });
  safe("notes", function () { wireNotes(S); fillSlots(S, document); });
  safe("since", function () { sinceLooked(S, store); });
  S.booting = true;
  safe("route", route);
  S.booting = false;
}

api.boot = boot; api.tourHash = tourHash; api.tourAnchor = tourAnchor; api.searchIndex = searchIndex; api.searchRank = searchRank;
