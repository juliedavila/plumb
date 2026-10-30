/* Plumb portfolio page client. Concatenated after client/prose.js inside one function (PORTFOLIO_JS in
   src/site/portfolio.ts). The page is static markup; this adds the theme, the focus across designs, the estimates'
   team filter and hover cards. It opens no connection and sets no repeating timer.
   Focus: a team or a lead, picked in the header, kept in localStorage under the key every page built
   inside this portfolio shares, so the focus follows the reader into a design's page and back. The facts were computed
   at build time by the design pages' own focusFacts, run per design and merged (src/site/portfolio-facts.ts); this file
   only applies them. focusOf, focusVerdict and focusNote are pure, so the tests call them without a DOM. */

function str(v) { return v == null ? "" : String(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function esc(v) { return str(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function $(id) { return document.getElementById(id); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

/** The facts for a focus { kind, id }, or null when this build does not offer it. */
function focusOf(data, f) {
  if (!f || typeof f !== "object" || (f.kind !== "team" && f.kind !== "lead")) return null;
  var facts = (data && data.focus && data.focus.facts) || {};
  return facts[f.kind + ":" + f.id] || null;
}

/**
 * Whether a marked element is theirs ("in"), not theirs ("out"), or says nothing about the focus (null), from its
 * data attributes: a milestone (ms), a design row (design), a team (team), a seam (seam and its owner teams), a crossing
 * (ends), a unit (unit) or a finding (finding). Pure.
 */
function focusVerdict(ff, d) {
  if (!ff || !d) return null;
  var has = function (xs, x) { return arr(xs).indexOf(x) >= 0; };
  if (d.ms) return ff.milestones && ff.milestones[d.ms] ? "in" : "out";
  if (d.finding) return has(ff.findings, d.finding) ? "in" : "out";
  if (d.ends) return str(d.ends).split(" ").some(function (x) { return has(ff.parts, x); }) ? "in" : "out";
  if (d.seam) {
    var mine = str(d.teams).split(" ").some(function (t) { return t && has(ff.teams, t); });
    return mine || d.touch ? "in" : "out";
  }
  if (d.unit) return (ff.units && ff.units[d.unit]) || has(ff.waiting, d.unit) ? "in" : "out";
  if (d.team) return has(ff.teams, d.team) ? "in" : "out";
  if (d.design) return ff.designs && ff.designs[d.design] ? "in" : "out";
  return null;
}

/** What the page says while a focus applies. */
function focusNote(ff) {
  if (!ff) return "";
  var nDesigns = Object.keys(ff.designs || {}).length, nUnits = Object.keys(ff.units || {}).length;
  var what = nUnits ? PROSE.count(nUnits, "unit") + " in " + PROSE.count(nDesigns, "design") : "no unit in any design";
  return PROSE.sentence("Focus: " + ff.name + (ff.kind === "lead" ? ", a lead" : "") + ". Theirs: " + what + (arr(ff.teams).length && ff.kind === "lead" ? ", and what they inherit through " + PROSE.count(ff.teams.length, "team") + " they lead" : "")) + " Their work is marked in every section and the rest is dimmed.";
}

api.focusOf = focusOf; api.focusVerdict = focusVerdict; api.focusNote = focusNote;

function boot() {
  var data;
  try { data = JSON.parse(($("de-portfolio") || {}).textContent || "{}"); } catch (e) { data = {}; console.error("Plumb: the portfolio data did not parse", e); }
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* unavailable: it holds for this visit */ } }, del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* unavailable */ } } };
  var safe = function (name, fn) { try { return fn(); } catch (e) { console.error("Plumb: " + name + " failed", e); } };
  var announce = function (m) { var el = $("live"); if (el) el.textContent = m; };
  document.documentElement.classList.add("js");

  // ---------- theme: the same control and storage as every design page ----------
  safe("theme", function () {
    var btn = $("theme-btn"), menu = $("theme-menu"), cur = store.get("de-theme") || "auto";
    if (["auto", "light", "dark"].indexOf(cur) < 0) cur = "auto";
    var apply = function () {
      if (cur === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", cur);
      $$("[data-theme-set]", menu).forEach(function (b) { b.setAttribute("aria-checked", b.getAttribute("data-theme-set") === cur ? "true" : "false"); });
      btn.setAttribute("aria-label", "Colour theme: " + cur.charAt(0).toUpperCase() + cur.slice(1));
    };
    btn.hidden = false; apply();
    var close = function (back) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); if (back) btn.focus(); };
    btn.addEventListener("click", function (ev) { ev.stopPropagation(); var open = menu.hidden; closeMenus(); menu.hidden = !open; btn.setAttribute("aria-expanded", open ? "true" : "false"); if (open) (menu.querySelector('[aria-checked="true"]') || menu.firstElementChild).focus(); });
    menu.addEventListener("click", function (ev) { var b = ev.target.closest("[data-theme-set]"); if (!b) return; cur = b.getAttribute("data-theme-set"); store.set("de-theme", cur); apply(); close(true); });
    menu.addEventListener("keydown", function (ev) { menuKeys(ev, menu, function () { close(true); }); });
  });
  function closeMenus() { $$(".menu").forEach(function (m) { m.hidden = true; }); $$("[aria-haspopup]").forEach(function (b) { b.setAttribute("aria-expanded", "false"); }); }
  function menuKeys(ev, menu, close) {
    var items = $$("button", menu), i = items.indexOf(document.activeElement);
    if (ev.key === "Escape") { close(); ev.stopPropagation(); }
    else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); items[(i + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
  }
  document.addEventListener("click", function (ev) { if (!ev.target.closest(".menu-wrap")) closeMenus(); });

  // ---------- focus across designs ----------
  var F = data.focus || { options: { teams: [], leads: [] }, facts: {} };
  var key = F.key || "de-focus:portfolio:" + str(data.name);
  var focus = null;
  try { var saved = JSON.parse(store.get(key) || "null"); if (focusOf(data, saved)) focus = { kind: saved.kind, id: saved.id }; } catch (e) { /* no saved focus */ }
  var teamRows = $$(".pf-teams > .pf-team"), teamBox = teamRows.length ? teamRows[0].parentNode : null;
  function attrsOf(el) {
    var d = {};
    ["ms", "design", "team", "seam", "teams", "ends", "unit", "finding"].forEach(function (k) { var v = el.getAttribute("data-" + k); if (v != null) d[k] = v; });
    return d;
  }
  function apply() {
    var ff = focusOf(data, focus);
    // a seam is theirs when they own it or one of its crossings touches their parts
    $$("[data-seam]").forEach(function (s) { s.removeAttribute("data-touch"); });
    $$("[data-ms],[data-design],[data-team],[data-seam],[data-ends],[data-unit],[data-finding]").forEach(function (el) {
      var d = attrsOf(el);
      if (d.seam && ff) d.touch = $$("[data-ends]", el).some(function (x) { return focusVerdict(ff, { ends: x.getAttribute("data-ends") }) === "in"; });
      var v = focusVerdict(ff, d);
      el.classList.toggle("fz-in", v === "in"); el.classList.toggle("fz-out", v === "out");
      var share = el.querySelector(":scope > .fz-share");
      if (share) { var t = ff && d.ms && ff.milestones[d.ms] ? ff.milestones[d.ms] : ""; share.textContent = t; share.hidden = !t; }
    });
    // each unit named on the page says how it is theirs ("owns", "leads; owns, inherited from ..."), each team row whether they lead it
    $$("[data-unit], .pf-team[data-team]").forEach(function (el) {
      var u = el.getAttribute("data-unit"), t = el.getAttribute("data-team");
      var words = !ff ? "" : u ? (ff.units && ff.units[u]) || (arr(ff.waiting).indexOf(u) >= 0 ? "blocked by them" : "") : arr(ff.teams).indexOf(t) >= 0 ? (ff.kind === "lead" ? "they lead it" : "their team") : "";
      var tag = el.querySelector(":scope > .focus-rel, :scope > .pf-team-head > .focus-rel"), host = u ? el : el.querySelector(".pf-team-head");
      if (!words) { if (tag) tag.remove(); return; }
      if (!tag && host) { tag = document.createElement("span"); tag.className = "tag accent focus-rel"; host.appendChild(tag); }
      if (tag) tag.textContent = words;
    });
    // the design rows say when nothing of theirs is in them
    $$(".rm-row").forEach(function (r) { var n = r.querySelector(".fz-none"); if (!n) return; var none = ff && !(ff.designs || {})[r.getAttribute("data-design")]; n.hidden = !none; n.textContent = none ? "Nothing of theirs in this design" : ""; });
    // load: their team rows first, the rest after in their own order
    if (teamBox) {
      var order = teamRows.slice();
      if (ff) order.sort(function (a, b) { return Number(focusVerdict(ff, { team: b.getAttribute("data-team") }) === "in") - Number(focusVerdict(ff, { team: a.getAttribute("data-team") }) === "in"); });
      order.forEach(function (r) { teamBox.appendChild(r); });
    }
    var note = $("pf-focus-note");
    if (note) { note.hidden = !ff; note.innerHTML = ff ? '<span>' + esc(focusNote(ff)) + '</span> <button type="button" class="btn quiet" data-focus-clear>Clear the focus</button>' : ""; }
    var chip = $("pf-focus-chip");
    if (chip) chip.innerHTML = ff ? '<span class="fchip-x focus-chip"><span class="fc">' + esc("Focus: " + ff.name) + '</span><button type="button" class="fx" data-focus-clear aria-label="' + esc("Clear the focus on " + ff.name) + '">×</button></span>' : "";
    label();
    document.body.classList.toggle("focused", !!ff);
  }
  var btn = $("focus-btn"), fmenu = $("focus-menu");
  function label() {
    if (!btn) return;
    var ff = focusOf(data, focus), lb = btn.querySelector(".lbl");
    if (lb) lb.textContent = ff ? "Focus: " + ff.name : "Focus";
    btn.setAttribute("aria-pressed", ff ? "true" : "false");
  }
  function setFocus(f) {
    focus = f && focusOf(data, f) ? { kind: f.kind, id: f.id } : null;
    if (focus) store.set(key, JSON.stringify(focus)); else store.del(key);
    apply();
    announce(focus ? "Focused on " + focusOf(data, focus).name + ". Their work is marked in every section." : "Focus cleared. Every section shows everything.");
  }
  safe("focus", function () {
    var opts = F.options || { teams: [], leads: [] };
    if (!btn || !fmenu || (!arr(opts.teams).length && !arr(opts.leads).length)) return;
    btn.hidden = false;
    var item = function (o) { var on = focus && focus.kind === o.kind && focus.id === o.id; return '<button type="button" role="menuitemradio" aria-checked="' + (on ? "true" : "false") + '" data-focus-pick="' + esc(o.kind + ":" + o.id) + '"><span>' + esc(o.name) + '</span><span class="n">' + (o.kind === "team" ? "Team" : "Lead") + "</span></button>"; };
    var draw = function () {
      fmenu.innerHTML = '<h4>Focus every section on a team or a lead</h4>' + (focus ? '<button type="button" role="menuitem" data-focus-clear>Clear the focus</button>' : "")
        + (arr(opts.teams).length ? "<h4>Teams</h4>" + opts.teams.map(item).join("") : "") + (arr(opts.leads).length ? "<h4>Leads</h4>" + opts.leads.map(item).join("") : "");
    };
    btn.addEventListener("click", function (ev) { ev.stopPropagation(); var open = fmenu.hidden; closeMenus(); if (open) { draw(); fmenu.hidden = false; btn.setAttribute("aria-expanded", "true"); (fmenu.querySelector('[aria-checked="true"]') || fmenu.querySelector("button")).focus(); } });
    fmenu.addEventListener("keydown", function (ev) { menuKeys(ev, fmenu, function () { closeMenus(); btn.focus(); }); });
    document.addEventListener("click", function (ev) {
      var p = ev.target.closest && ev.target.closest("[data-focus-pick]");
      if (p) { var v = p.getAttribute("data-focus-pick"), i = v.indexOf(":"); closeMenus(); setFocus({ kind: v.slice(0, i), id: v.slice(i + 1) }); return; }
      if (ev.target.closest && ev.target.closest("[data-focus-clear]")) { closeMenus(); setFocus(null); }
    });
    apply();
  });

  // ---------- the estimates' team filter ----------
  safe("estimates", function () {
    var box = $("est-filter"), sel = $("est-team"), cnt = $("est-count"); if (!box || !sel) return;
    box.hidden = false;
    var rows = $$("table.pf-est tbody tr");
    var run = function () {
      var t = sel.value, n = 0;
      rows.forEach(function (r) { var show = !t || r.getAttribute("data-team") === t; r.hidden = !show; if (show) n++; });
      if (cnt) cnt.textContent = t ? PROSE.count(n, "estimate") + " on " + sel.options[sel.selectedIndex].text + "'s rows" : PROSE.count(rows.length, "estimate");
    };
    sel.addEventListener("change", run); run();
  });

  // ---------- hover cards: a milestone's delivery, a trend's points, a term's meaning ----------
  safe("hover", function () {
    var tip = $("pf-hover"); if (!tip) return;
    var cur = null, showT = null;
    var place = function (el) {
      var r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
      var x = Math.max(8, Math.min(r.left, vw - tip.offsetWidth - 8)), y = r.bottom + 8;
      if (y + tip.offsetHeight > vh - 8) y = Math.max(8, r.top - tip.offsetHeight - 8);
      tip.style.left = Math.round(x) + "px"; tip.style.top = Math.round(y) + "px";
    };
    var show = function (el) {
      cur = el; var lines = str(el.getAttribute("data-hover")).split("\n");
      tip.innerHTML = '<p class="card-t">' + esc(lines[0]) + "</p>" + (lines.length > 1 ? '<ul class="pf-hover-lines">' + lines.slice(1).map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>" : "");
      tip.hidden = false; place(el);
    };
    var hide = function () { clearTimeout(showT); tip.hidden = true; cur = null; };
    document.addEventListener("mouseover", function (ev) { var el = ev.target.closest && ev.target.closest("[data-hover]"); if (!el || el === cur) return; clearTimeout(showT); showT = setTimeout(function () { if (el.isConnected) show(el); }, 300); });
    document.addEventListener("mouseout", function (ev) { var el = ev.target.closest && ev.target.closest("[data-hover]"); if (!el) return; if (ev.relatedTarget && el.contains(ev.relatedTarget)) return; hide(); });
    document.addEventListener("focusin", function (ev) { var el = ev.target.closest && ev.target.closest("[data-hover]"); if (el) show(el); else if (cur) hide(); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !tip.hidden) hide(); });
    document.addEventListener("scroll", function () { if (!tip.hidden) hide(); }, { passive: true, capture: true });
  });
}

api.boot = boot;
