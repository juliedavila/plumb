/* Plumb site client, part 0b: build digests and comparisons.
   One source for "what changed": the page keeps a digest of the last build its reader opened (localStorage) and leads
   with what changed since; `bun plumb.ts diff` (src/core/diff.ts loads this same file) compares two builds. A digest is
   compact: one short hash per record of each kind, plus the state a reader cares about (a unit's state, a patch's
   status, a note's status, a claim's grade). Pure: no DOM, no storage. */
var DIGEST = (function () {
  function arr(x) { return Array.isArray(x) ? x : []; }
  function str(x) { return x == null ? "" : String(x); }
  /** JSON with object keys sorted, so the same record always hashes the same. */
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }
  /** FNV-1a, 32 bits, base 36: short and stable. Collisions only hide a change, never invent one. */
  function h(s) {
    var x = 2166136261;
    for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
    return (x >>> 0).toString(36);
  }
  function unitState(b, u) {
    var st = u.status || "todo";
    if (st === "done" || st === "doing") return st;
    return arr(b.analysis && b.analysis.frontier).indexOf(u.id) >= 0 ? "ready" : "blocked";
  }
  var KINDS = ["element", "relationship", "unit", "claim", "finding", "patch", "note"];
  var KINDS04 = ["contract", "team", "phase", "system", "zone", "current"]; // 0.4 bundles only (src/core/digest.ts); current: current-state records
  var WORDS = ["name", "title", "label", "description", "owner", "verifier", "status", "lead"];
  var PHASE_WORDS = WORDS.concat(["delivers", "means", "target", "override", "accountable", "confirmed_by", "flow_target"]);
  function recordDigest(kind, rec) {
    var c = Object.assign({}, rec || {}), full = h(canon(c));
    (kind === "phase" ? PHASE_WORDS : WORDS).forEach(function (k) { delete c[k]; });
    return { full: full, bare: h(canon(c)) };
  }
  /** A digest of a bundle: { v, built, hash, r: { "kind:id": "hash" or "hash|state" } }. */
  function digest(b) {
    b = b || {};
    var m = b.model || {}, p = b.plan || {}, r = {};
    // "~" and four characters: the same record without its wording and owners, so a comparison can tell
    // "re-derived" from "redesigned" (a collision only reads a change as a rewording at 1 in 1.6 million)
    var bare = function (o, drop) { var c = Object.assign({}, o); drop.forEach(function (k) { delete c[k]; }); return "~" + h(canon(c)).slice(-4); };
    arr(m.elements).forEach(function (e) { if (e) r["element:" + e.id] = h(canon(e)) + bare(e, WORDS); });
    arr(m.relationships).forEach(function (rl) { if (rl) r["relationship:" + rl.id] = h(canon(rl)) + bare(rl, WORDS); });
    arr(p.units).forEach(function (u) { if (u && r["unit:" + u.id] == null) { var c = Object.assign({}, u); delete c.status; r["unit:" + u.id] = h(canon(c)) + bare(u, WORDS) + "|" + unitState(b, u); } });
    arr(m.claims).forEach(function (c) { if (c) { var x = Object.assign({}, c); delete x.grade; r["claim:" + c.id] = h(canon(x)) + "|" + c.grade; } });
    arr(b.findings).forEach(function (f) { if (f) r["finding:" + f.pack + "/" + f.rule + "@" + f.at] = h(str(f.severity) + str(f.message)); });
    arr(b.patches).forEach(function (pt) { if (pt) r["patch:" + pt.id] = h(canon({ t: pt.title, w: pt.why, o: pt.ops })) + "|" + pt.status; });
    arr(b.notes && b.notes.items).forEach(function (n) { if (n) { var x = Object.assign({}, n); delete x.status; delete x.updated; r["note:" + n.id] = h(canon(x)) + "|" + n.status; } });
    var is04 = !!(b.instance && b.instance.schema);
    if (is04) [["contract", m.contracts], ["team", m.teams], ["phase", p.phases], ["system", m.systems], ["zone", m.zones]].forEach(function (k) {
      arr(k[1]).forEach(function (x) { if (x) r[k[0] + ":" + (k[0] === "contract" ? x.name : x.id)] = h(canon(x)) + bare(x, k[0] === "phase" ? PHASE_WORDS : WORDS); });
    });
    // a current-state record, with whether a person confirmed it: what the investigation pod added shows as added
    if (is04) arr(b.current && b.current.records).forEach(function (c) { if (c) { var x = Object.assign({}, c); delete x.text; delete x.name; delete x.state; r["current:" + c.part] = h(canon(x)) + "|" + c.state; } });
    var out = { v: 1, built: str(b.engine && b.engine.built), hash: str(b.engine && b.engine.hash), r: r };
    if (is04) out.k = KINDS.concat(KINDS04);
    // what each record was called, so a record or finding that later goes is still named by its title, never its id
    var nm = names(b), n = {};
    Object.keys(r).forEach(function (k) { if (nm[k] && k.indexOf("note:") !== 0) n[k] = clip(nm[k], k.indexOf("finding:") === 0 ? 120 : 70); });
    out.n = n;
    // the fields a reader compares by value ("due 30 Oct to 9 Oct"): a unit's due date, milestone and own owner, a
    // part's owner, a milestone's target and the status a person set on it
    var f = {}, put = function (k, o) { var c = {}; Object.keys(o).forEach(function (x) { if (o[x] != null && o[x] !== "") c[x] = String(o[x]); }); if (Object.keys(c).length) f[k] = c; };
    arr(p.units).forEach(function (u) { if (u) put("unit:" + u.id, { due: u.due, phase: u.phase, owner: u.owner, lead: u.lead }); });
    arr(m.elements).forEach(function (e) { if (e) put("element:" + e.id, { owner: e.owner }); });
    arr(p.phases).forEach(function (ph) { if (ph) put("phase:" + ph.id, { target: ph.target, override: ph.override && ph.override.status, lead: ph.lead }); });
    out.f = f;
    // the status as shown, so a comparison can say "went amber to red"; the rule set, so a new rule is not the design getting worse
    if (b.status && b.status.overall) { var sm = {}, sc = {}; arr(b.status.milestones).forEach(function (m) { if (m) { sm[m.phase] = m.status; sc[m.phase] = m.computed || m.status; } }); out.s = { o: b.status.overall.status, m: sm, c: sc }; }
    var rk = []; arr(b.instance && b.instance.packs).forEach(function (pk) { arr(pk && pk.rules).forEach(function (rr) { rk.push(pk.name + "/" + rr.id); }); });
    if (rk.length) out.rk = rk.sort();
    return out;
  }
  /** What each record is called, for the comparison's lists. */
  function names(b) {
    b = b || {};
    var m = b.model || {}, p = b.plan || {}, out = {};
    var el = {}; arr(m.elements).forEach(function (e) { if (e) { el[e.id] = e.name; out["element:" + e.id] = e.name || e.id; } });
    arr(m.relationships).forEach(function (x) { if (x) out["relationship:" + x.id] = x.label ? x.label : (el[x.from] || x.from) + " to " + (el[x.to] || x.to); });
    arr(p.units).forEach(function (u) { if (u) out["unit:" + u.id] = u.title || u.id; });
    arr(m.claims).forEach(function (c) { if (c) out["claim:" + c.id] = c.statement || c.id; });
    var rules = {}; arr(b.instance && b.instance.packs).forEach(function (pk) { arr(pk && pk.rules).forEach(function (rr) { rules[pk.name + "/" + rr.id] = rr.title; }); });
    arr(b.patches).forEach(function (pt) { if (pt) out["patch:" + pt.id] = pt.title || pt.id; });
    arr(b.notes && b.notes.items).forEach(function (n) { if (n) out["note:" + n.id] = clip(n.text, 80); });
    out.__rules = rules;
    arr(m.teams).forEach(function (t) { if (t) out["team:" + t.id] = t.name || t.id; });
    var ph = arr(p.phases).slice().sort(function (x, y) { return (x.order || 0) - (y.order || 0); });
    ph.forEach(function (x) { if (x) out["phase:" + x.id] = x.name || x.id; });
    out.__phases = ph.map(function (x) { return x.id; });
    // a finding is named by its rule and the record it sits on, by name (the id is on its card)
    arr(m.contracts).forEach(function (c) { if (c) out["contract:" + c.name] = c.name; });
    [["system", m.systems], ["zone", m.zones]].forEach(function (k) { arr(k[1]).forEach(function (x) { if (x) out[k[0] + ":" + x.id] = x.name || x.id; }); });
    arr(b.current && b.current.records).forEach(function (c) { if (c) out["current:" + c.part] = c.name || el[c.part] || c.part; });
    var teamName = {}; arr(m.teams).forEach(function (t) { if (t) teamName[t.id] = t.name; });
    var viewName = {}; arr(m.views).forEach(function (v) { if (v) viewName[v.id] = v.title; });
    arr(b.findings).forEach(function (f) {
      if (!f) return;
      var on = out[f.atKind + ":" + f.at] || (f.atKind === "team" ? teamName[f.at] : f.atKind === "view" ? viewName[f.at] : "") || (f.atKind === "contract" ? f.at : "");
      out["finding:" + f.pack + "/" + f.rule + "@" + f.at] = (rules[f.pack + "/" + f.rule] || f.rule) + ": " + (on ? clip(on, 90) : f.text ? clip(f.text, 90) : f.at);
    });
    return out;
  }
  function clip(t, n) { t = str(t).replace(/\s+/g, " ").trim(); if (t.length <= n) return t; var c = t.slice(0, n), i = c.lastIndexOf(" "); return (i > n * 0.6 ? c.slice(0, i) : c).replace(/[\s,;:.]+$/, "") + "…"; }
  function split(v) { var s = str(v), i = s.indexOf("|"), hh = i < 0 ? s : s.slice(0, i), t = hh.indexOf("~"); return { h: t < 0 ? hh : hh.slice(0, t), x: t < 0 ? "" : hh.slice(t + 1), s: i < 0 ? "" : s.slice(i + 1) }; }
  /**
   * Compare two digests (old, new). Names come from the new build, else the old, else the id.
   * Returns the BuildDiff shape in src/types.ts (from and to are filled by the caller).
   */
  function compare(a, b, namesNew, namesOld) {
    var ra = (a && a.r) || {}, rb = (b && b.r) || {};
    namesNew = namesNew || {}; namesOld = namesOld || {};
    var rules = namesNew.__rules || namesOld.__rules || {};
    // a finding that is gone is still named by its rule, which the newer build usually still describes
    var findingName = function (id) { var at = id.lastIndexOf("@"); var rule = at < 0 ? id : id.slice(0, at); return rules[rule] ? rules[rule] + ": " + id.slice(at + 1) : id; };
    var na0 = (a && a.n) || {};
    var rec = function (key) { var i = key.indexOf(":"), kind = key.slice(0, i), id = key.slice(i + 1); return { kind: kind, id: id, name: str(namesNew[key] || namesOld[key] || na0[key] || (kind === "finding" ? findingName(id) : id)) }; };
    var d = { findings: { added: [], gone: [] }, units: { ready: [], done: [] }, added: [], removed: [], changed: [], reworded: [],
      notes: { added: [], answered: [], resolved: [] }, patches: { added: [], decided: [] }, claims: { regraded: [] }, counts: {} };
    var ka = (a && a.k) || KINDS, kb = (b && b.k) || KINDS; // the kinds each side covers

    var kinds = KINDS.concat(KINDS04.filter(function (k) { return ka.indexOf(k) >= 0 && kb.indexOf(k) >= 0; }));
    var covered = function (key) { return kinds.indexOf(key.slice(0, key.indexOf(":"))) >= 0; };
    kinds.forEach(function (k) { d.counts[k] = { added: 0, removed: 0, changed: 0 }; });
    // the rule sets, when both sides recorded one: a finding of a rule the other side lacks is a change in the checks
    var rka = a && a.rk, rkb = b && b.rk, ruleOf = function (id) { var at = id.lastIndexOf("@"); return at < 0 ? id : id.slice(0, at); };
    if (rka && rkb) d.checks = { rulesAdded: rkb.filter(function (x) { return rka.indexOf(x) < 0; }), rulesRemoved: rka.filter(function (x) { return rkb.indexOf(x) < 0; }), findingsAdded: [], findingsGone: [] };
    var newRule = function (id) { return d.checks && rkb.indexOf(ruleOf(id)) >= 0 && rka.indexOf(ruleOf(id)) < 0; }, goneRule = function (id) { return d.checks && rka.indexOf(ruleOf(id)) >= 0 && rkb.indexOf(ruleOf(id)) < 0; };
    // status moves, milestone by milestone in plan order, when both sides recorded status
    if (a && a.s && b && b.s) {
      var order = (namesNew.__phases || namesOld.__phases || Object.keys(b.s.m)).filter(function (id) { return id in b.s.m; });
      d.status = { moves: [] };
      if (a.s.o !== b.s.o) d.status.overall = { from: a.s.o, to: b.s.o };
      order.forEach(function (id) { var x = a.s.m[id], y = b.s.m[id]; if (x && y && x !== y) { var mv = { kind: "phase", id: id, name: str(namesNew["phase:" + id] || namesOld["phase:" + id] || id), from: x, to: y }; var cy = b.s.c && b.s.c[id]; if (cy && cy !== y) { mv.override = true; mv.computed = cy; } d.status.moves.push(mv); } });
    }
    // field-level changes, by value, where both sides recorded the fields
    if (a && a.f && b && b.f) {
      d.fields = [];
      Object.keys(b.f).sort().forEach(function (key) {
        var x = a.f[key], y = b.f[key]; if (!x) return;
        Object.keys(Object.assign({}, x, y)).sort().forEach(function (fl) {
          if (x[fl] === y[fl]) return;
          var i = key.indexOf(":"), kind = key.slice(0, i), id = key.slice(i + 1);
          d.fields.push({ kind: kind, id: id, name: str(namesNew[key] || namesOld[key] || na0[key] || id), field: fl, from: x[fl] || "", to: y[fl] || "" });
        });
      });
    }
    var cnt = function (k, what) { (d.counts[k] = d.counts[k] || { added: 0, removed: 0, changed: 0 })[what]++; };
    Object.keys(rb).sort().forEach(function (key) {
      if (!covered(key)) return;
      var r = rec(key), nb = split(rb[key]);
      if (!(key in ra)) {
        cnt(r.kind, "added");
        if (r.kind === "finding") (newRule(r.id) ? d.checks.findingsAdded : d.findings.added).push(r);
        else if (r.kind === "note") d.notes.added.push(r);
        else if (r.kind === "patch") d.patches.added.push(r);
        else d.added.push(r);
        if (r.kind === "unit" && (nb.s === "ready" || nb.s === "done")) (nb.s === "ready" ? d.units.ready : d.units.done).push(r);
        return;
      }
      var na = split(ra[key]);
      if (na.h !== nb.h) {
        // only its wording or owner changed: re-derived, not redesigned
        if (na.x && na.x === nb.x) { d.counts[r.kind].reworded = (d.counts[r.kind].reworded || 0) + 1; d.reworded.push(r); }
        else { cnt(r.kind, "changed"); if (r.kind !== "finding") d.changed.push(r); }
      }
      if (r.kind === "unit" && na.s !== nb.s) { if (nb.s === "ready") d.units.ready.push(r); else if (nb.s === "done") d.units.done.push(r); }
      if (r.kind === "note" && na.s !== nb.s) { if (nb.s === "answered") d.notes.answered.push(r); else if (nb.s === "resolved") d.notes.resolved.push(r); }
      if (r.kind === "patch" && na.s !== nb.s && na.s === "proposed") d.patches.decided.push({ kind: r.kind, id: r.id, name: r.name, from: na.s, to: nb.s });
      if (r.kind === "claim" && na.s !== nb.s) d.claims.regraded.push({ kind: r.kind, id: r.id, name: r.name, from: na.s, to: nb.s });
    });
    Object.keys(ra).sort().forEach(function (key) {
      if (key in rb || !covered(key)) return;
      var r = rec(key);
      cnt(r.kind, "removed");
      if (r.kind === "finding") (goneRule(r.id) ? d.checks.findingsGone : d.findings.gone).push(r); else d.removed.push(r);
    });
    // new risks: claims that became load-bearing and untested
    d.risks = d.findings.added.filter(function (r) { return r.id.indexOf("premises/load-bearing-untested@") === 0; }).map(function (r) { var cid = r.id.slice(r.id.indexOf("@") + 1); return { kind: "claim", id: cid, name: str(namesNew["claim:" + cid] || namesOld["claim:" + cid] || na0["claim:" + cid] || cid) }; });
    return d;
  }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function day(iso) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(str(iso)); return m ? Number(m[3]) + " " + MON[Number(m[2]) - 1] : str(iso); }
  /** One field change in words: "due 30 Oct to 9 Oct", "milestone “See the stream” to “Shorten it”", "owner Product to Platform". */
  function fieldText(fc, nm) {
    nm = nm || {};
    var v = function (x) { if (!x) return "none"; if (fc.field === "due" || fc.field === "target") return day(x); if (fc.field === "phase") return "\u201c" + str(nm["phase:" + x] || x) + "\u201d"; if (fc.field === "owner") return str(nm["team:" + x] || x); return x; };
    var w = { due: "due", phase: "milestone", owner: "owner", target: "target", override: "status set manually" }[fc.field] || fc.field;
    return w + " " + v(fc.from) + " to " + v(fc.to);
  }
  /** Is there anything to say? */
  function isEmpty(d) {
    return !d || !(d.findings.added.length || d.findings.gone.length || d.units.ready.length || d.units.done.length || d.added.length || d.removed.length || d.changed.length || arr(d.reworded).length
      || d.notes.added.length || d.notes.answered.length || d.notes.resolved.length || d.patches.added.length || d.patches.decided.length || d.claims.regraded.length
      || (d.status && (d.status.overall || d.status.moves.length)) || arr(d.fields).length || (d.checks && (d.checks.rulesAdded.length || d.checks.rulesRemoved.length || d.checks.findingsAdded.length || d.checks.findingsGone.length)));
  }
  /** A status move in words: "“X” went amber to green by override; computed still amber". */
  function moveText(m) {
    var t = "\u201c" + str(m.name) + "\u201d went " + m.from + " to " + m.to;
    if (m.override) t += " by override; computed " + (m.computed === m.from ? "still " : "") + m.computed;
    return t;
  }
  function verOf(v) { return v && v.version ? v.version + (v.titles && v.titles !== v.version ? ", titles " + v.titles : "") : ""; }
  /**
   * What re-derived records mean, in one sentence, or "": records whose only change is their wording or owner. When
   * nothing else in the design changed, the design did not change. An older side with no wording-free hashes cannot
   * tell the two apart, and says so when the importer's version is not recorded on it.
   */
  function churnText(d, importer) {
    var rw = arr(d && d.reworded).length, from = importer && importer.from, to = importer && importer.to;
    var structural = ["element", "relationship", "unit", "claim"].some(function (k) { var c = d && d.counts && d.counts[k]; return c && (c.added || c.removed || c.changed); });
    var by = from && to && verOf(from) !== verOf(to) ? " by the importer (version " + verOf(from) + " to " + verOf(to) + ")" : to && !from ? " by the importer" : "";
    if (rw && !structural) return "Titles and owners were re-derived" + by + "; the design did not change.";
    if (rw) return rw + (rw === 1 ? " record was" : " records were") + " only re-worded or re-owned" + by + "; the rest changed in the design.";
    if (structural && to && !from) return "The earlier report does not record the importer's version, so some of these changes may be re-derived titles and owners rather than design changes.";
    return "";
  }
  return { digest: digest, names: names, compare: compare, fieldText: fieldText, isEmpty: isEmpty, hash: h, canon: canon, moveText: moveText, churnText: churnText, recordDigest: recordDigest };
})();
