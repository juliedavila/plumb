/* Plumb site client: flow words and blocks. Pure functions over the bundle (b.flow, b.model), shared by the
   page and the server render (src/site/flow.ts loads this file), so a number reads the same everywhere. Every flow
   number goes out with its source word (measured, estimated, declared, or measured in the tracker) and its date, and
   an estimate is never called a measurement. Nothing here touches the DOM. */
var FLOWUI = (function () {
  "use strict";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function e(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function a(x) { return Array.isArray(x) ? x : []; }
  function r1(n) { var r = Math.round(n * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); }
  /** "4 days", "1 day", "4.8 days". */
  function days(n) { var t = r1(n); return t + (t === "1" ? " day" : " days"); }
  /** "4 d" for a badge. */
  function d(n) { return r1(n) + " d"; }
  function pct(x) { return Math.round(x * 100) + "%"; }
  /** "1 Oct", or "1 Oct 2025" in another year than the build's. */
  function date(iso, today) {
    if (!iso) return "";
    var p = String(iso).slice(0, 10).split("-").map(Number);
    if (!p[0] || !p[1] || !p[2]) return String(iso);
    return p[2] + " " + MONTHS[p[1] - 1] + (today && Number(String(today).slice(0, 4)) === p[0] ? "" : " " + p[0]);
  }
  function src(s) { return s === "tracker" ? "measured in the tracker" : s && s !== "unknown" ? s : "source not given"; }
  /** "4 days, estimated, as of 1 Oct". */
  function val(v, today, unit) {
    if (!v) return "";
    return (unit === "limit" ? String(v.value) : days(v.value)) + ", " + src(v.source) + (v.asOf ? ", as of " + date(v.asOf, today) : ", date not given") + (v.stale ? " (older than the age limit)" : "");
  }
  /** "4.8 days, measured in the tracker (median of 4 changes)". */
  function meas(m) { return m ? days(m.days) + ", measured in the tracker (median of " + m.n + (m.n === 1 ? " change" : " changes") + ")" : ""; }

  var cache = null;
  function idx(b) {
    if (cache && cache.b === b) return cache;
    var c = { b: b, el: new Map(), team: new Map(), stream: new Map() };
    a(b && b.model && b.model.elements).forEach(function (x) { c.el.set(x.id, x); });
    a(b && b.model && b.model.teams).forEach(function (x) { c.team.set(x.id, x); });
    a(b && b.flow && b.flow.streams).forEach(function (s) { c.stream.set(s.view, s); });
    cache = c; return c;
  }
  function teamName(b, id) { var t = idx(b).team.get(id); return t ? t.name : id || "no team"; }
  function elName(b, id) { var x = idx(b).el.get(id); return x ? x.name : id; }
  /** "Engineering to Platform". */
  function hop(b, h) { return teamName(b, h.fromTeam) + " to " + teamName(b, h.toTeam); }
  function step(b, id) { return b && b.flow && b.flow.elements ? b.flow.elements[id] : undefined; }
  function stream(b, viewId) { return idx(b).stream.get(viewId); }
  function today(b) { return b && b.flow ? b.flow.asOf : ""; }
  function isQueue(b, id) { var x = idx(b).el.get(id); return !!x && x.kind === "queue"; }

  /**
   * A queue's current WIP from the tracker: the changes waiting now in a status that stands for the step the queue
   * feeds (the open count of that step's measured wait). Null when the tracker cannot say.
   */
  function wipNow(b, id) {
    var m = b && b.flow && b.flow.measured;
    if (!m || !m.available || !isQueue(b, id)) return null;
    var feeds = a(b.model && b.model.relationships).filter(function (r) { return r.from === id && m.steps[r.to] && m.steps[r.to].wait; }).map(function (r) { return r.to; });
    if (!feeds.length) return null;
    var n = feeds.reduce(function (t, s) { return t + (m.steps[s].wait.open || 0); }, 0);
    return { n: n, steps: feeds, to: m.to };
  }
  function wipNowWords(b, id) {
    var w = wipNow(b, id), s = step(b, id) || {};
    if (!w) return "";
    return w.n + (w.n === 1 ? " change waits" : " changes wait") + " in it now, measured in the tracker (before " + w.steps.map(function (x) { return elName(b, x); }).join(" and ") + ")" + (s.wip ? (w.n > s.wip.value ? ", over its limit of " + s.wip.value : ", within its limit of " + s.wip.value) : "");
  }

  /** The badge lines a part's box carries: its wait, the tracker's measure, its WIP limit (or that it has none). Each { cls, text, title }. */
  function badges(b, id) {
    if (!b || !b.flow) return [];
    var s = step(b, id) || {}, t = today(b), out = [];
    if (s.wait) out.push({ cls: "fbadge" + (s.wait.stale ? " stale" : "") + (s.wait.source ? " s-" + s.wait.source : " s-unknown"), text: "wait " + d(s.wait.value) + " · " + (s.wait.source || "no source") + (s.wait.stale ? ", old" : ""), short: "wait " + d(s.wait.value), title: "Wait before " + elName(b, id) + ": " + val(s.wait, t) + "." });
    if (s.measured && s.measured.wait) out.push({ cls: "fbadge s-tracker", text: "tracker " + d(s.measured.wait.days), short: "tracker " + d(s.measured.wait.days), title: "The tracker measured " + meas(s.measured.wait) + "." });
    if (isQueue(b, id)) {
      var now = wipNow(b, id);
      if (now) out.push({ cls: "fbadge " + (s.wip && now.n > s.wip.value ? "none" : "s-tracker"), text: "now " + now.n + (s.wip ? " of " + s.wip.value + " · tracker" : " · tracker"), short: "now " + now.n + (s.wip ? " of " + s.wip.value : ""), title: wipNowWords(b, id) + "." });
      if (s.wip) out.push({ cls: "fbadge" + (s.wip.source ? " s-" + s.wip.source : " s-unknown"), text: "WIP limit " + s.wip.value + " · " + (s.wip.source || "no source"), short: "limit " + s.wip.value, title: "WIP limit: " + val(s.wip, t, "limit") + "." });
      else out.push({ cls: "fbadge none", text: "no WIP limit", short: "no limit", title: elName(b, id) + " is a queue with no WIP limit, so nothing stops it growing." });
    }
    return out;
  }

  /** "21 days (15 estimated, 6 measured)". */
  function sum(s) {
    if (!s) return "";
    var by = s.bySource || {}, ks = Object.keys(by).filter(function (k) { return by[k] > 0; }).sort(function (x, y) { return by[y] - by[x]; });
    return days(s.days) + (ks.length ? " (" + ks.map(function (k) { return r1(by[k]) + " " + src(k); }).join(", ") + ")" : "");
  }
  /** The handoff count against the limit, in words. */
  function limitWords(n, limit) { return n > limit ? "over the limit of " + limit : n === limit ? "at the limit of " + limit : "within the limit of " + limit; }
  /** The dates the declared values were taken, "as of 30 Sep to 1 Oct". */
  function asOfRange(b, s) {
    var ds = [];
    a(s.path).forEach(function (id) { var x = step(b, id); ["wait", "work"].forEach(function (k) { if (x && x[k] && x[k].asOf) ds.push(x[k].asOf); }); });
    ds.sort();
    if (!ds.length) return "";
    var t = today(b);
    return ds[0] === ds[ds.length - 1] ? "as of " + date(ds[0], t) : "as of " + date(ds[0], t) + " to " + date(ds[ds.length - 1], t);
  }

  /** The one-paragraph summary of a stream: lead time, waiting and working, efficiency, handoffs and the hops. */
  function summary(b, s) {
    var out = [];
    if (s.lead != null) out.push("A change takes about " + days(s.lead) + " from " + elName(b, s.path[0]) + " to " + elName(b, s.path[s.path.length - 1]) + ": " + sum(s.wait) + " waiting and " + sum(s.work) + " of work, so flow efficiency is " + pct(s.efficiency || 0) + ".");
    else out.push("Changes wait " + sum(s.wait) + " along this stream" + (s.wait.missing.length ? "; " + s.wait.missing.length + (s.wait.missing.length === 1 ? " step declares" : " steps declare") + " no wait" : "") + (s.work ? "; work is not declared at every step, so lead time and flow efficiency are not computed" : "; no step declares its work, so lead time and flow efficiency are not computed") + ".");
    out.push("It crosses " + s.handoffs + (s.handoffs === 1 ? " team handoff" : " team handoffs") + ", " + limitWords(s.handoffs, s.limit) + ": " + a(s.hops).map(function (h) { return hop(b, h); }).join(", ") + ".");
    var r = asOfRange(b, s);
    if (r) out.push("Declared values " + r + ".");
    return out.join(" ");
  }
  /** The tracker's lead time beside the declared one, over the steps its statuses cover. */
  function measuredLine(b, s) {
    var m = b.flow && b.flow.measured;
    if (!m) return "";
    if (!m.available) return m.reason || "";
    if (!s.measured) return "The tracker measures no step of this stream.";
    var gap = s.measured.lead.days - s.measured.declared;
    var cv = s.measured.covered;
    return "The tracker measured a lead time of " + days(s.measured.lead.days) + " over the " + cv.length + " steps its statuses cover, " + elName(b, cv[0]) + " to " + elName(b, cv[cv.length - 1]) + " (median of " + s.measured.lead.n + " changes" + (m.from ? ", " + date(m.from, today(b)) + " to " + date(m.to, today(b)) : "") + "), against " + days(s.measured.declared) + " declared for them: " + (Math.abs(gap) < 0.05 ? "the same." : days(Math.abs(gap)) + (gap > 0 ? " more than declared." : " less than declared."));
  }

  /** The days a handoff could save at most, with the source. */
  function behind(h) {
    if (h.measuredBehind) return { days: h.measuredBehind.days, source: "tracker" };
    if (h.waitBehind) return { days: h.waitBehind.value, source: h.waitBehind.source || "unknown" };
    return null;
  }
  function ranked(s) {
    return a(s.hops).slice().sort(function (x, y) { var bx = behind(x), by = behind(y); return (by ? by.days : -1) - (bx ? bx.days : -1) || (x.relationship < y.relationship ? -1 : 1); });
  }

  /** The flow panel under a stream drawing: the numbers, the handoffs ranked by the wait behind them, measured beside declared. */
  function panel(b, viewId, link) {
    var s = stream(b, viewId);
    if (!s) return "";
    link = link || function (id) { return e(elName(b, id)); };
    var t = today(b), h = [];
    var stat = function (label, value, sub, tone) { return '<div class="fstat' + (tone ? " " + tone : "") + '"><span class="l">' + e(label) + '</span><span class="v">' + e(value) + '</span><span class="s">' + e(sub) + "</span></div>"; };
    var st = [];
    st.push(s.lead != null ? stat("Lead time", days(s.lead), "declared: " + r1(s.wait.days) + " waiting, " + r1(s.work.days) + " working; " + (s.sources.length ? s.sources.join(" and ") : "source not given")) : stat("Waiting", days(s.wait.days), "declared; work is not known at every step"));
    if (s.efficiency != null) st.push(stat("Flow efficiency", pct(s.efficiency), "work over lead time, from the declared values"));
    st.push(stat("Team handoffs", String(s.handoffs), limitWords(s.handoffs, s.limit), s.handoffs > s.limit ? "bad" : ""));
    if (s.measured) st.push(stat("Tracker lead time", days(s.measured.lead.days), "measured over " + s.measured.lead.n + " changes, " + s.measured.covered.length + " steps; " + days(s.measured.declared) + " declared there"));
    h.push('<section class="flow-panel" id="flow-panel" aria-labelledby="h-flow"><h3 id="h-flow">Flow along this stream</h3><p class="small fg2">' + e(summary(b, s)) + "</p>");
    var ml = measuredLine(b, s);
    if (ml) h.push('<p class="small fg2">' + e(ml) + "</p>");
    h.push('<div class="fstats">' + st.join("") + "</div>");
    // handoffs ranked by the wait behind them
    h.push('<h4 class="fh">Handoffs ranked by the wait behind them</h4><p class="small muted">Removing a handoff saves at most the wait at the step it feeds. The tracker’s measure is used where it has one; otherwise the declared value, with its source.</p>');
    h.push('<div class="table-wrap reflow"><table class="reflow flow-rank"><caption class="sr-only">Handoffs ranked by the wait behind them</caption><thead><tr><th scope="col">Handoff</th><th scope="col">Wait sits at</th><th scope="col">Wait behind it</th><th scope="col">Declared</th><th scope="col">Why it waits</th></tr></thead><tbody>'
      + ranked(s).map(function (x) {
        var bh = behind(x), into = x.behind || x.to, desc = (idx(b).el.get(into) || {}).description || "";
        return '<tr data-hop="' + e(x.relationship) + '"><td class="lead" data-label="Handoff">' + e(hop(b, x)) + '</td><td class="inline" data-label="Wait sits at">' + link(into) + '</td><td class="inline" data-label="Wait behind it">'
          + (bh ? "<strong>" + e(days(bh.days)) + "</strong> " + e(src(bh.source)) : '<span class="muted">No step waits here before the next handoff</span>') + '</td><td class="inline" data-label="Declared">' + (x.waitBehind ? e(val(x.waitBehind, t)) : '<span class="muted">none</span>') + '</td><td class="inline" data-label="Why it waits">' + e(desc) + "</td></tr>";
      }).join("") + "</tbody></table></div>");
    // measured beside declared, per step the tracker covers
    var m = b.flow.measured;
    if (m && m.available) {
      var rows = a(s.path).filter(function (id) { return m.steps[id]; });
      h.push('<h4 class="fh">Measured beside declared</h4><p class="small muted">The tracker’s medians come from issue status history; the declared values are the model’s, with their source.</p>');
      var gapTxt = function (mm, v) { if (!mm || !v) return ""; var g = mm.days - v.value; return Math.abs(g) < 0.05 ? "same" : (g > 0 ? "+" : "−") + days(Math.abs(g)); };
      h.push('<div class="table-wrap reflow"><table class="reflow flow-meas"><caption class="sr-only">Measured beside declared</caption><thead><tr><th scope="col">Step</th><th scope="col">Declared wait</th><th scope="col">Tracker wait</th><th scope="col">Gap</th><th scope="col">Declared work</th><th scope="col">Tracker work</th></tr></thead><tbody>'
        + rows.map(function (id) {
          var x = step(b, id) || {}, mm = m.steps[id] || {};
          return '<tr><td class="lead" data-label="Step">' + link(id) + '</td><td class="inline" data-label="Declared wait">' + e(x.wait ? val(x.wait, t) : "none") + '</td><td class="inline" data-label="Tracker wait">' + e(mm.wait ? meas(mm.wait) : "no status for it") + '</td><td class="inline n" data-label="Gap">' + e(gapTxt(mm.wait, x.wait)) + '</td><td class="inline" data-label="Declared work">' + e(x.work ? val(x.work, t) : "none") + '</td><td class="inline" data-label="Tracker work">' + e(mm.work ? meas(mm.work) : "no status for it") + "</td></tr>";
        }).join("") + "</tbody></table></div>");
      var none = a(s.path).filter(function (id) { var x = step(b, id); return x && x.wait && !m.steps[id]; });
      if (none.length) h.push('<p class="small muted">No tracker status stands for ' + e(none.map(function (id) { return elName(b, id); }).join(", ").replace(/, ([^,]*)$/, " or $1")) + ", so " + (none.length === 1 ? "it keeps its" : "they keep their") + " declared values only.</p>");
    } else if (m && m.reason) h.push('<p class="small muted">' + e(m.reason) + "</p>");
    h.push("</section>");
    return h.join("");
  }

  /** A part's flow numbers for its inspector: declared with source and date, the tracker's beside them, the gap. */
  function partRows(b, id) {
    var s = step(b, id), t = today(b), rows = [];
    if (!s) return rows;
    var m = s.measured || {};
    if (s.wait) rows.push(["Wait before it", val(s.wait, t)]);
    if (m.wait) rows.push(["Tracker wait", meas(m.wait) + (s.wait ? ", " + gapWords(m.wait.days - s.wait.value) : "")]);
    if (s.work) rows.push(["Work at it", val(s.work, t)]);
    if (m.work) rows.push(["Tracker work", meas(m.work) + (s.work ? ", " + gapWords(m.work.days - s.work.value) : "")]);
    if (s.wip) rows.push(["WIP limit", val(s.wip, t, "limit")]);
    else if (isQueue(b, id)) rows.push(["WIP limit", "none: nothing stops this queue growing"]);
    if (wipNow(b, id)) rows.push(["In it now", wipNowWords(b, id)]);
    return rows;
  }
  function gapWords(g) { return Math.abs(g) < 0.05 ? "the same as declared" : days(Math.abs(g)) + (g > 0 ? " more than declared" : " less than declared"); }

  /** The Overview's flow tile: lead time, wait share and handoffs against the limit, for the first stream. */
  function tile(b) {
    var s = b && b.flow && b.flow.streams && b.flow.streams[0];
    if (!s) return null;
    var waitShare = s.lead ? s.wait.days / s.lead : null;
    var big = s.lead != null ? days(s.lead) : days(s.wait.days) + " waiting";
    var line = "lead time, " + (s.sources.length ? s.sources.join(" and ") : "source not given") + (waitShare != null ? " · " + pct(waitShare) + " waiting" : "") + " · " + s.handoffs + " handoffs, limit " + s.limit;
    return { view: s.view, title: s.title, big: big, line: line, bad: s.handoffs > s.limit, measured: s.measured ? "Tracker: " + days(s.measured.lead.days) + " over " + s.measured.covered.length + " steps (" + s.measured.lead.n + " changes), " + days(s.measured.declared) + " declared there" : "" };
  }

  return { days: days, d: d, pct: pct, date: date, src: src, val: val, meas: meas, hop: hop, step: step, stream: stream, badges: badges, wipNow: wipNow, wipNowWords: wipNowWords, sum: sum, summary: summary, measuredLine: measuredLine, behind: behind, ranked: ranked, panel: panel, partRows: partRows, tile: tile, limitWords: limitWords, teamName: teamName, elName: elName, asOfRange: asOfRange };
})();
