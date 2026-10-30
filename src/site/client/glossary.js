/* Plumb site client, part 3g: the glossary. bundle.glossary holds a short definition per term (the engine's
   terms with the instance's additions and overrides, src/core/glossary.ts). At a term's first use in the tour's
   caption and in each page's section headings, the word gets a dotted underline and a definition on hover or keyboard
   focus, in one tooltip styled like the record card. Escape, moving away or blur closes it. glossMatches is pure, so
   the tests call it without a DOM. */

var GLOSS_SKIP = "a, button, code, kbd, svg, input, textarea, select, .gl, .id, .ref, .count, .badge, .tag, [data-no-gloss]";

/** The terms and one matcher over every form, longest first, so "work unit" wins over "unit". */
function glossIndex(ix) {
  if (ix._gloss !== undefined) return ix._gloss;
  var terms = arr(ix.b && ix.b.glossary).filter(function (t) { return t && t.term && t.definition; });
  if (!terms.length) { ix._gloss = null; return null; }
  var byForm = new Map(), forms = [];
  terms.forEach(function (t) { arr(t.forms).concat([t.term]).forEach(function (f) { var k = str(f).toLowerCase(); if (k && !byForm.has(k)) { byForm.set(k, t); forms.push(str(f)); } }); });
  forms.sort(function (a, b) { return b.length - a.length; });
  var pattern = forms.map(function (f) { return f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"); }).join("|");
  ix._gloss = { terms: terms, byForm: byForm, re: new RegExp("(^|[^A-Za-z0-9-])(" + pattern + ")(?![A-Za-z0-9])", "gi") };
  return ix._gloss;
}

/** Where terms occur in a text, each term once (its first use), skipping terms already in seen: [{ start, end, term }]. */
function glossMatches(ix, text, seen) {
  var g = glossIndex(ix); if (!g) return [];
  seen = seen || new Set();
  var out = [], t = str(text), m;
  g.re.lastIndex = 0;
  while ((m = g.re.exec(t))) {
    var word = m[2], start = m.index + m[1].length, term = g.byForm.get(word.toLowerCase().replace(/\s+/g, " "));
    if (term && !seen.has(term.term)) { seen.add(term.term); out.push({ start: start, end: start + word.length, term: term.term }); }
    if (m[0].length === 0) g.re.lastIndex++;
  }
  return out;
}

/** The definition of a term by its name. */
function glossTerm(ix, name) {
  var g = glossIndex(ix); if (!g) return null;
  for (var i = 0; i < g.terms.length; i++) if (g.terms[i].term === name) return g.terms[i];
  return null;
}

/** Marks the first use of each term in the text of these elements (in order), once per seen set. */
function glossify(ix, els, seen) {
  if (!glossIndex(ix) || typeof document === "undefined") return;
  seen = seen || new Set();
  arr(els).forEach(function (root) {
    if (!root || (root.closest && root.closest("[data-no-gloss]"))) return;
    $$(".gl", root).forEach(function (x) { seen.add(x.getAttribute("data-gl")); });
    var walker = document.createTreeWalker(root, 4 /* text */), nodes = [], n;
    while ((n = walker.nextNode())) { var p = n.parentElement; if (p && !p.closest(GLOSS_SKIP)) nodes.push(n); }
    nodes.forEach(function (node) {
      var ms = glossMatches(ix, node.nodeValue, seen);
      if (!ms.length) return;
      var text = node.nodeValue, frag = document.createDocumentFragment(), at = 0;
      ms.forEach(function (m) {
        if (m.start > at) frag.appendChild(document.createTextNode(text.slice(at, m.start)));
        var s = document.createElement("span");
        s.className = "gl"; s.tabIndex = 0; s.setAttribute("role", "term"); s.setAttribute("data-gl", m.term);
        s.textContent = text.slice(m.start, m.end);
        frag.appendChild(s); at = m.end;
      });
      if (at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
      node.parentNode.replaceChild(frag, node);
    });
  });
}

/** A page's section headings, first use per page. */
function glossifyPage(S, pageEl) {
  if (!pageEl) return;
  // headings a reader sees: not a screen-reader-only heading (a tab stop nobody can see), not one hidden or in a drawer
  glossify(S.ix, $$("h2, h3", pageEl).filter(function (h) { return !h.closest(".drawer, .hovercard, .deck, .card-t, .sr-only, [hidden]") && h.getClientRects().length > 0; }), new Set());
}

/** The tooltip: one element, shown on hover (after a short pause) or focus of a marked term. */
function wireGlossary(S) {
  var ix = S.ix;
  if (!glossIndex(ix)) return;
  var tip = document.createElement("div");
  tip.className = "hovercard gloss-tip"; tip.id = "gloss-tip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
  document.body.appendChild(tip);
  var cur = null, showT = null, hideT = null;
  function place(el) {
    var r = el.getBoundingClientRect(), cw = tip.offsetWidth, ch = tip.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var x = Math.max(8, Math.min(r.left, vw - cw - 8)), y = r.bottom + 8;
    if (y + ch > vh - 8) y = Math.max(8, r.top - ch - 8);
    tip.style.left = Math.round(x) + "px"; tip.style.top = Math.round(y) + "px";
  }
  function show(el) {
    var t = glossTerm(ix, el.getAttribute("data-gl")); if (!t) return;
    if (cur && cur !== el) cur.removeAttribute("aria-describedby");
    cur = el;
    tip.innerHTML = '<div class="card-head">' + icon("info", "icon icon-sm kind-ic") + '<span class="card-kind">' + (t.source === "instance" ? "In this design" : "Term") + '</span></div><p class="card-t">' + esc(cap1(t.term)) + '</p><p class="gloss-def">' + esc(t.definition) + "</p>";
    tip.hidden = false; place(el);
    el.setAttribute("aria-describedby", "gloss-tip");
  }
  function hide() { clearTimeout(showT); tip.hidden = true; if (cur) cur.removeAttribute("aria-describedby"); cur = null; }
  S.hideGloss = hide;
  S.glossify = function (els) { glossify(ix, els, new Set()); };
  S.glossifyPage = function (el) { glossifyPage(S, el); };
  document.addEventListener("mouseover", function (ev) {
    var el = ev.target.closest && ev.target.closest(".gl"); if (!el) return;
    clearTimeout(hideT); if (el === cur) return;
    clearTimeout(showT); showT = setTimeout(function () { if (el.isConnected) show(el); }, 300);
  });
  document.addEventListener("mouseout", function (ev) {
    var el = ev.target.closest && ev.target.closest(".gl"); if (!el) return;
    if (ev.relatedTarget && el.contains(ev.relatedTarget)) return;
    clearTimeout(showT);
    if (el === cur && document.activeElement !== el) hideT = setTimeout(hide, 100);
  });
  document.addEventListener("focusin", function (ev) { var el = ev.target.closest && ev.target.closest(".gl"); if (el) show(el); else if (cur) hide(); });
  document.addEventListener("focusout", function (ev) { if (ev.target === cur) hide(); });
  // Escape closes the definition first; a second Escape reaches the page (leaving a tour, closing a drawer)
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !tip.hidden) { ev.preventDefault(); ev.stopImmediatePropagation(); hide(); } }, true);
  document.addEventListener("scroll", function () { if (!tip.hidden && cur && document.activeElement !== cur) hide(); }, { passive: true, capture: true });
}

api.glossMatches = glossMatches; api.glossTerm = glossTerm; api.glossIndex = glossIndex;
