/* Plumb site client, part 3b: premises, notes and "since you last looked".
   - Claims: the grade (icon and word), the claims a record rests on, and a claim's "if this is false" detail.
   - Notes: shown in place on every record's detail, the Notes page, and the add, answer, resolve, reopen, edit and
     delete actions. Writes go through the dev server only (window.DE_DEV, injected by `bun plumb.ts dev`); opened from a
     file, notes are read-only and the add box copies the YAML to paste into notes.yaml.
   - Since you last looked: a compact digest of the last build the reader saw (DIGEST, localStorage) against this one.
   The renderers are pure (index in, HTML out) so tests call them without a DOM. */

var GRADES = { evidence: ["g-evidence", "Evidence", "backed by evidence"], inference: ["g-inference", "Inference", "inferred from evidence"], judgment: ["g-judgment", "Judgment", "a judgment call"], untested: ["g-untested", "Untested", "untested"] };
var CLAIM_KIND = { premise: "Premise", claim: "Conclusion", assumption: "Assumption" };
var NOTE_TARGET_WORD = { element: "part", relationship: "relationship", contract: "contract", unit: "unit", phase: "milestone", claim: "claim", patch: "patch", finding: "finding" };

function gradeHtml(g, size) {
  var x = GRADES[g] || ["g-untested", cap1(g || "ungraded"), g];
  return '<span class="st ' + x[0] + (size === "" ? "" : " " + (size || "sm")) + '">' + icon(x[0]) + '<span class="w">' + esc(x[1]) + "</span></span>";
}

/** Called at the end of buildIndex: claims, what rests on what, notes by record. */
function indexStrategy(ix) {
  var b = ix.b, m = b.model || {}, p = b.plan || {};
  ix.claim = new Map(); ix.claimsOf = new Map(); ix.notesAt = new Map(); ix.notes = [];
  arr(m.claims).forEach(function (c) { if (c && c.id != null) ix.claim.set(c.id, c); });
  var on = function (kind, rec) { arr(rec && rec.rests_on).forEach(function (c) { push(ix.claimsOf, kind + ":" + rec.id, c); }); };
  arr(m.elements).forEach(function (e) { on("element", e); });
  arr(m.relationships).forEach(function (r) { on("relationship", r); });
  arr(p.units).forEach(function (u) { on("unit", u); });
  arr(p.phases).forEach(function (ph) { on("phase", ph); });
  arr(m.claims).forEach(function (c) { on("claim", c); });
  ix.notes = arr(b.notes && b.notes.items).filter(Boolean);
  ix.notes.forEach(function (n) { if (n.target) push(ix.notesAt, n.target.kind + ":" + n.target.id, n); });
  ix.premises = b.premises || {};
}

/** Text cut at a word boundary with an ellipsis, so a quoted title never ends mid-word. */
function clip(t, n) { t = str(t).replace(/\s+/g, " ").trim(); if (t.length <= n) return t; var c = t.slice(0, n); var i = c.lastIndexOf(" "); return (i > n * 0.6 ? c.slice(0, i) : c).replace(/[\s,;:.]+$/, "") + "…"; }

function claimWeight(ix, id) {
  var im = ix.premises[id];
  if (!im) return 0;
  var slice = arr(im.units).reduce(function (t, g) { return t + arr(g.units).length; }, 0);
  return num(im.counts && im.counts.total) - num(im.counts && im.counts.units) + slice;
}
function claimLink(ix, id, withText) {
  var c = ix.claim.get(id);
  if (!c) return '<code class="muted" title="Not declared in this design">' + esc(id) + "</code>";
  return '<a class="claim-ref" href="' + R.claim(id) + '" data-claim="' + esc(id) + '" title="' + esc(id) + '">' + icon((GRADES[c.grade] || GRADES.untested)[0], "icon icon-sm st-" + (GRADES[c.grade] || GRADES.untested)[0])
    + '<span class="sr-only">' + esc((GRADES[c.grade] || GRADES.untested)[1]) + ': </span>' + esc(withText === false ? PROSE.quote(clip(c.statement, 72)) : c.statement) + "</a>";
}

/** "Rationale": the claims a record names, each with its grade. */
function restsOnSection(ix, kind, id) {
  var cs = ix.claimsOf.get(kind + ":" + id) || [];
  if (!cs.length) return "";
  return sec("Rationale", cs.length, '<ul class="rows">' + cs.map(function (c) { return "<li>" + claimLink(ix, c) + "</li>"; }).join("") + "</ul>");
}

/** Where a note's target lives on the page, as a link (or plain text when the record is gone). */
function noteTargetHtml(ix, t) {
  t = t || {};
  var k = t.kind, id = str(t.id);
  if (k === "element" && ix.el.has(id)) return elLink(ix, id);
  if (k === "unit" && ix.unit.has(id)) return unitLink(ix, id);
  if (k === "phase" && ix.phase.has(id)) return '<a href="' + R.milestone(id) + '">' + esc(milestoneLabel(ix, id)) + "</a>";
  if (k === "claim" && ix.claim.has(id)) return claimLink(ix, id, false);
  if (k === "patch" && ix.patch.has(id)) return '<a href="' + R.patch(id) + '" title="' + esc(id) + '">' + esc(PROSE.quote(ix.patch.get(id).title)) + "</a>";
  if (k === "relationship" && ix.rel.has(id)) { var r = ix.rel.get(id); return '<span title="' + esc(id) + '">' + elLink(ix, r.from) + ' <span role="img" aria-label="to">&#8594;</span> ' + elLink(ix, r.to) + "</span>"; }
  if (k === "contract" && ix.contract.has(id)) { var c = ix.contract.get(id), by = arr(c.produced_by)[0]; return (by && ix.el.has(by) ? '<a href="' + R.element(by) + '">' : "<span>") + '<span class="chip">' + esc(plainRef(ix, id)) + "</span>" + (by && ix.el.has(by) ? "</a>" : "</span>"); }
  if (k === "finding") {
    var at = id.indexOf("@"), pr = (at < 0 ? id : id.slice(0, at)).split("/"), rule = ix.rules.get(pr[0] + "/" + pr.slice(1).join("/"));
    return '<a href="' + R.rule(pr[0], pr.slice(1).join("/")) + '" title="' + esc(id) + '">' + esc(rule ? rule.title : "a check") + "</a>" + (at >= 0 ? " on " + esc(recName(ix, id.slice(at + 1))) : "");
  }
  return '<span class="muted" title="No longer in the model">' + esc(NOTE_TARGET_WORD[k] || k) + " " + esc(id) + "</span>";
}

/** A record named for a reader, whatever its kind: a part's name, a unit's or milestone's title, a claim's words. */
function recName(ix, id) {
  if (ix.el.has(id)) return ix.el.get(id).name || id;
  if (ix.unit.has(id)) return PROSE.quote(ix.unit.get(id).title);
  if (ix.claim && ix.claim.has(id)) return PROSE.quote(clip(ix.claim.get(id).statement, 60));
  if (ix.phase.has(id)) return PROSE.quote(milestoneLabel(ix, id));
  if (ix.team.has(id)) return teamName(ix, id);
  if (ix.rel.has(id)) { var r = ix.rel.get(id); return (ix.el.has(r.from) ? ix.el.get(r.from).name : r.from) + " → " + (ix.el.has(r.to) ? ix.el.get(r.to).name : r.to); }
  if (ix.patch.has(id)) return PROSE.quote(ix.patch.get(id).title);
  return id;
}

/** One note: kind and status, the text, the answer, who and when, and the actions the page allows. */
function noteCard(ix, n, o) {
  o = o || {};
  var q = n.kind === "question", st = n.status || "open";
  var stWord = st === "open" ? (q ? "Open question" : "Open") : st === "answered" ? "Answered" : "Resolved";
  var stCls = st === "open" ? (q ? "warning" : "doing") : st === "answered" ? "ready" : "done";
  var acts = "";
  if (o.edit) {
    var b = function (act, label, cls) { return '<button type="button" class="btn ' + (cls || "quiet") + ' sm" data-note-act="' + act + '" data-note-id="' + esc(n.id) + '">' + esc(label) + "</button>"; };
    acts = '<div class="note-acts">' + (q && st === "open" ? b("answer", "Answer", "") : "") + (st !== "resolved" ? b("resolve", "Resolve") : b("reopen", "Reopen")) + (st === "answered" ? b("reopen", "Reopen") : "") + b("edit", "Edit") + b("delete", "Delete") + "</div>";
  }
  return '<li class="note-card ' + esc(st) + (q ? " q" : "") + '" data-note="' + esc(n.id) + '" id="note-' + esc(n.id) + '" title="' + esc(n.id) + '">'
    + '<div class="note-head">' + icon(q ? "question" : "note", "icon st-" + stCls) + '<span class="st sm ' + stCls + '"><span class="w">' + esc(stWord) + "</span></span>"
    + (o.target === false ? "" : '<span class="note-on small">on ' + esc(NOTE_TARGET_WORD[n.target && n.target.kind] || (n.target && n.target.kind) || "") + " " + noteTargetHtml(ix, n.target) + "</span>")
    + "</div>"
    + '<p class="note-text">' + linkifyText(ix, n.text, true) + "</p>"
    // who wrote it and when, under the text; who answered and when, on the answer; both in the writer's own words
    + '<p class="note-meta xs muted">' + esc((q ? "Asked by " : "Written by ") + (n.author === "agent" ? "Claude" : "a person")) + " · " + (n.created ? '<time datetime="' + esc(n.created) + '">' + esc(humanTime(n.created)) + "</time>" : "no date") + "</p>"
    + (n.answer ? '<div class="note-answer"><span class="small fg2">' + (n.answered_by === "agent" ? icon("agent", "icon icon-sm") + "Answered by Claude" : n.answered_by === "person" ? "Answered by a person" : 'Answer <span class="xs muted">(who answered is not recorded)</span>') + (n.updated ? ' · <time datetime="' + esc(n.updated) + '">' + esc(humanTime(n.updated)) + "</time>" : "") + "</span><p>" + linkifyText(ix, n.answer, true) + "</p>" + (n.sources && n.sources.length ? '<p class="note-sources xs muted">Sources: ' + n.sources.map(function (x) { return linkifyText(ix, x, true); }).join("; ") + "</p>" : "") + "</div>" : "")
    + acts + "</li>";
}

/** The YAML for a note, as notes.yaml holds it (the offline add box copies this). */
function noteYaml(n) {
  var q = function (v) { return JSON.stringify(str(v)); };
  return "  - id: " + n.id + "\n    target: { kind: " + n.target.kind + ", id: " + q(n.target.id) + " }\n    kind: " + n.kind + "\n    text: " + q(n.text)
    + "\n    status: " + n.status + (n.answer ? "\n    answer: " + q(n.answer) + (n.answered_by ? "\n    answered_by: " + n.answered_by : "") + (n.sources && n.sources.length ? "\n    sources: [" + n.sources.map(q).join(", ") + "]" : "") : "") + "\n    author: " + n.author + "\n    created: " + q(n.created) + "\n    updated: " + q(n.updated) + "\n";
}
function nextNoteId(ix) { var max = 0; ix.notes.forEach(function (n) { var m = /^N-(\d+)$/.exec(n.id); if (m) max = Math.max(max, Number(m[1])); }); return "N-" + (max + 1); }

/**
 * Notes in place: the notes pinned to `targets` (each { kind, id, label }), open questions first, and a box to add
 * one. o.edit: the page can write (dev server); otherwise the box copies YAML.
 */
function notesBlock(ix, targets, o) {
  o = o || {};
  var keys = targets.map(function (t) { return t.kind + ":" + t.id; });
  var ns = [];
  keys.forEach(function (k) { (ix.notesAt.get(k) || []).forEach(function (n) { if (ns.indexOf(n) < 0) ns.push(n); }); });
  var rank = function (n) { return n.status === "open" ? (n.kind === "question" ? 0 : 1) : n.status === "answered" ? 2 : 3; };
  ns.sort(function (a, b) { return rank(a) - rank(b) || str(b.updated).localeCompare(str(a.updated)); });
  var many = targets.length > 1;
  var form = '<details class="disc note-add"' + (o.open ? " open" : "") + '><summary>' + (o.edit ? "Add a note or question" : "Add a note (copies YAML)") + '</summary><div class="body"><form class="note-form" data-note-form="add" data-targets="' + esc(JSON.stringify(targets.map(function (t) { return { kind: t.kind, id: t.id }; }))) + '">'
    + (many ? '<label class="field">Pinned to<select name="target">' + targets.map(function (t, i) { return '<option value="' + i + '">' + esc(t.label || (NOTE_TARGET_WORD[t.kind] + " " + t.id)) + "</option>"; }).join("") + "</select></label>" : "")
    + '<fieldset class="seg-radio"><legend class="sr-only">Kind</legend><label><input type="radio" name="kind" value="question" checked> Question</label><label><input type="radio" name="kind" value="note"> Note</label></fieldset>'
    + '<label class="field"><span class="sr-only">Text</span><textarea name="text" rows="3" maxlength="10000" required placeholder="What do you want to ask or record?"></textarea></label>'
    + '<div class="note-acts"><button type="submit" class="btn primary sm">' + (o.edit ? "Add" : "Copy as YAML") + "</button>" + (o.edit ? "" : '<span class="xs muted">Paste under <code>notes:</code> in notes.yaml; the page is read-only when opened from a file.</span>') + "</div></form></div></details>";
  var title = o.title || "Notes";
  return '<section class="notes-block" data-notes-block="' + esc(keys.join(" ")) + '"><h3>' + esc(title) + (ns.length ? ' <span class="count">' + ns.length + "</span>" : "") + "</h3>"
    + (ns.length ? '<ul class="note-list compact">' + ns.map(function (n) { return noteCard(ix, n, { edit: o.edit, target: many && (n.target.kind + ":" + n.target.id) !== keys[0] }); }).join("") + "</ul>" : "")
    + form + "</section>";
}

/** Exposure before evidence, in a sentence: where the first test lands and how much open work is built on it first. */
function exposureSentence(ix, c, im) {
  var ex = im && im.exposure;
  if (!ex) return "";
  var units = function (n) { return PROSE.count(n, "open unit"); };
  if (ex.firstTest) return ex.before
    ? "Its first test lands in " + PROSE.quote(milestoneLabel(ix, ex.firstTest.phase)) + "; " + units(ex.before) + " in earlier milestones " + (ex.before === 1 ? "is" : "are") + " built on it first."
    : "Its first test lands in " + PROSE.quote(milestoneLabel(ix, ex.firstTest.phase)) + ", before any open work in an earlier milestone is built on it.";
  if (c.grade === "evidence") return "";
  return ex.before ? "No work tests this, and " + units(ex.before) + " " + (ex.before === 1 ? "is" : "are") + " built on it." : "";
}

/** A claim's detail: the claim, how it is backed, its fallback, and what would be in question if it were false. */
function claimDetail(ix, id, o) {
  o = o || {};
  var c = ix.claim.get(id);
  if (!c) return '<p class="empty">No claim with id <code>' + esc(id) + "</code> in this design.</p>";
  var im = ix.premises[id], h = [];
  var lb = arr(ix.b.findings).some(function (f) { return f.pack === "premises" && f.rule === "load-bearing-untested" && f.at === id; });
  h.push('<div class="insp-head">' + (o.close ? '<a class="btn quiet insp-close" href="' + o.close + '" aria-label="Close the claim detail">' + icon("close") + "</a>" : "")
    + '<span class="kind">' + icon("k-claim", "icon icon-sm") + " " + esc(CLAIM_KIND[c.kind] || cap1(c.kind)) + " " + idCopy(id) + '</span><h2 tabindex="-1">' + esc(c.statement || id) + '</h2><div class="tags">'
    + (lb ? '<a class="tag warning" href="' + R.rule("premises", "load-bearing-untested") + '">' + icon("warning", "icon icon-sm") + "Untested, and much rests on it</a>" : "") + followBtn("claim", id) + "</div></div>");
  h.push(cardHtml(ix, "claim", id, "page"));
  var facts = [];
  if (c.source) facts.push("<dt>Source</dt><dd>" + linkifyText(ix, c.source) + "</dd>");
  var at = c.attrs || {};
  if (at.strength || at.verdict) facts.push("<dt>How it was graded</dt><dd>" + esc([at.strength ? "strength " + at.strength : "", at.verdict ? "verdict " + at.verdict : ""].filter(Boolean).join(", ")) + (at.strength_reason ? '<br><span class="small fg2">' + linkifyText(ix, at.strength_reason) + "</span>" : "") + "</dd>");
  if (at.falsifier) facts.push("<dt>Wrong if</dt><dd>" + linkifyText(ix, at.falsifier) + "</dd>");
  if (facts.length) h.push('<dl class="facts">' + facts.join("") + "</dl>");
  if (arr(c.rests_on).length) h.push(sec("It builds on", c.rests_on.length, '<ul class="rows">' + c.rests_on.map(function (x) { return "<li>" + claimLink(ix, x) + "</li>"; }).join("") + "</ul>"));
  var ex = im && im.exposure, lead = exposureSentence(ix, c, im);
  if (lead) h.push('<p class="exposure' + (ex && !arr(ex.tests).length ? " warn" : "") + '">' + esc(lead) + "</p>");
  // a flow metric that can regrade it: today's value, its source, and whether it holds; a person regrades
  if (im && im.flow) h.push(sec("Measured by flow", null, '<p class="small' + (im.flow.holds === false ? " warn-text" : "") + '">' + esc(im.flow.text) + (im.flow.view ? ' <a href="' + R.view(im.flow.view) + '">Open the stream</a>' : "") + "</p>"));
  var tested = arr(ex ? ex.tests : at.tested_by).filter(function (u) { return ix.unit.has(u); });
  h.push(sec("Tested by", tested.length || null, tested.length
    ? '<ul class="rows work-rows">' + tested.map(function (u) { return workRow(ix, u); }).join("") + "</ul>"
    : '<p class="small no-test">' + icon("warning", "icon icon-sm st-warning") + " No work tests this; it needs a test and an owner.</p>"));

  // the milestones at stake: those whose own work rests on it (with what reaching them means), and apart from them,
  // those its being untested turns amber (their status reasons name it, also through a part their work changes)
  var stake = arr(im && im.atStake), amberBy = arr(im && im.amberBy);
  var msRow = function (p, means) {
    var ms = arr(ix.b.status && ix.b.status.milestones).filter(function (m) { return m.phase === p; })[0];
    var because = ms && arr(ms.reasons).some(function (r) { return r.criterion === "untested-premise" && arr(r.refs).some(function (x) { return x.id === id; }); });
    // a red milestone is red for its red reasons; an untested belief only ever adds amber
    var why = !because ? "" : ms.computed === "red" ? "red for other reasons; this alone would make it amber" : (ms.computed !== ms.status ? "computed " + ms.computed + ", " : "") + "amber partly because this is untested";
    var ph = ix.phase.get(p);
    return '<li><a href="' + R.milestone(p) + '">' + esc(milestoneLabel(ix, p)) + "</a> " + (ms ? ragHtml(ms.status, "sm") : "") + (why ? ' <span class="xs muted">' + esc(why) + "</span>" : "")
      + (means && ph && ph.means ? '<br><span class="small fg2">Reaching it means: ' + esc(ph.means) + "</span>" : "") + "</li>";
  };
  if (stake.length) h.push(sec("Rests on it directly", stake.length, '<p class="small fg2" style="margin-bottom:4px">Milestones whose own work names this belief.</p><ul class="rows">' + stake.map(function (p) { return msRow(p, true); }).join("") + "</ul>"));
  var turned = amberBy.filter(function (p) { return stake.indexOf(p) < 0; });
  if (turned.length) h.push(sec("Turned amber by this", turned.length, '<p class="small fg2" style="margin-bottom:4px">Milestones whose work changes a part that rests on it; their status names it.</p><ul class="rows">' + turned.map(function (p) { return msRow(p, false); }).join("") + "</ul>"));
  if (!im || !num(im.counts && im.counts.total)) h.push(sec("If this is false", null, '<p class="small fg2">Nothing in the model or the plan rests on it, so nothing would be in question.</p>'));
  else {
    var k = im.counts, sliceN = arr(im.units).reduce(function (t, g) { return t + arr(g.units).length; }, 0);
    var what = PROSE.list([k.elements ? PROSE.count(k.elements, "part") : "", k.relationships ? PROSE.count(k.relationships, "relationship") : "", k.phases ? PROSE.count(k.phases, "milestone") : "", k.claims ? PROSE.count(k.claims, "other claim") : "", k.units ? PROSE.count(k.units, "unit") : ""]);
    var nd = arr(im.direct).length;
    var lead = PROSE.para(["Resting on it: " + what, nd === k.total ? (nd === 1 ? "" : "All of them rest on it directly") : "Of those, " + PROSE.fmt(nd) + " rest on it directly and the others through the claims named beside them",
      sliceN ? "The work that rests on it is " + PROSE.count(sliceN, "unit") + ", " + (im.openUnits === sliceN ? "none done yet" : PROSE.fmt(im.openUnits) + " of them not done") : ""]);
    var groups = [["claim", "Claims"], ["phase", "Milestones"], ["element", "Parts"], ["relationship", "Relationships"], ["unit", "Units"]];
    var body = '<p class="small fg2" style="margin-bottom:6px">' + esc(lead) + "</p>" + groups.map(function (g) {
      var xs = arr(im.dependents).filter(function (d) { return d.kind === g[0]; });
      if (!xs.length) return "";
      var row = function (d) {
        var link = d.kind === "element" ? elLink(ix, d.id) : d.kind === "unit" ? unitLink(ix, d.id) : d.kind === "claim" ? claimLink(ix, d.id) : d.kind === "phase" ? '<a href="' + R.milestone(d.id) + '">' + esc(milestoneLabel(ix, d.id)) + "</a>" : noteTargetHtml(ix, { kind: "relationship", id: d.id });
        return "<li>" + link + (arr(d.via).length > 1 ? ' <span class="xs muted">through ' + arr(d.via).slice(1).map(function (v) { return esc(recName(ix, v)); }).join(" → ") + "</span>" : "") + "</li>";
      };
      return '<h4 class="xs muted" style="margin:8px 0 2px">' + g[1] + " " + xs.length + '</h4><ul class="rows">' + xs.slice(0, 12).map(row).join("") + "</ul>"
        + (xs.length > 12 ? '<details class="disc"><summary>' + esc("Show " + PROSE.fmt(xs.length - 12) + " more") + '</summary><div class="body"><ul class="rows">' + xs.slice(12).map(row).join("") + "</ul></div></details>" : "");
    }).join("");
    h.push(sec("If this is false", null, body));
    if (sliceN) h.push(sec("Work that rests on it", sliceN, '<p class="small fg2" style="margin-bottom:4px">By milestone; open one for the titles.</p>' + arr(im.units).map(function (g) {
      var us = arr(g.units), open = us.filter(function (u) { var x = ix.unit.get(u); return x && x.status !== "done"; }).length;
      var first = ex && ex.firstTest && ex.firstTest.phase === g.phase;
      return '<details class="disc slice-g"><summary>' + esc(ix.phase.has(g.phase) ? milestoneLabel(ix, g.phase) : "No milestone") + ' <span class="count">' + us.length + "</span>"
        + '<span class="xs muted"> ' + esc(open === us.length ? "none done" : PROSE.fmt(open) + " open") + (first ? " · its first test lands here" : "") + "</span></summary>"
        + '<div class="body"><ul class="rows work-rows">' + us.map(function (u) { return workRow(ix, u, { milestone: false }); }).join("") + "</ul></div></details>";
    }).join("")));
  }
  var fl = findingsList(ix, "claim", id); if (fl) h.push(sec("Problems the checks found", (ix.findingsAt.get("claim:" + id) || []).length, fl));
  h.push(notesBlock(ix, [{ kind: "claim", id: id }], { edit: o.edit }));
  return h.join("");
}

// ---------- since you last looked ----------

function diffRecLink(ix, r) {
  var k = r.kind, id = r.id, name = esc(r.name);
  if ((k === "element" || k === "current") && ix.el.has(id)) return '<a href="' + R.element(id) + '">' + name + "</a>";
  if (k === "unit" && ix.unit.has(id)) return '<a href="' + R.unit(id) + '" data-unit="' + esc(id) + '" title="' + esc(id) + '">' + name + "</a>";
  if (k === "claim" && ix.claim.has(id)) return '<a href="' + R.claim(id) + '" title="' + esc(id) + '">' + esc(clip(r.name, 110)) + "</a>";
  if (k === "patch" && ix.patch.has(id)) return '<a href="' + R.patch(id) + '" title="' + esc(id) + '">' + name + "</a>";
  if (k === "note") return '<a href="#notes/' + enc(id) + '" title="' + esc(id) + '">' + name + "</a>";
  if (k === "relationship" && ix.rel.has(id)) return noteTargetHtml(ix, { kind: "relationship", id: id });
  if (k === "phase" && ix.phase.has(id)) return '<a href="' + R.milestone(id) + '">' + name + "</a>";
  if (k === "finding") { var at = id.indexOf("@"), pr = (at < 0 ? id : id.slice(0, at)).split("/"); return '<a href="' + R.rule(pr[0], pr.slice(1).join("/")) + '">' + name + "</a>"; }
  return '<span class="muted" title="' + esc(id) + '">' + name + "</span>";
}

var DIFF_NOUN = { element: "part", relationship: "relationship", unit: "unit", claim: "claim", finding: "finding", patch: "patch", note: "note", current: "current-state record" };
/** The comparison as one list, most urgent first ("2 new findings, 1 note answered and 3 records changed"). */
/** nm: the names DIGEST.fieldText reads (milestones, teams), DIGEST.names of the bundle on the page. */
function sinceList(d, nm) {
  var f = [];
  // status moves lead, in words: "“See the stream” went amber to red"
  arr(d.status && d.status.moves).forEach(function (m) { f.push(DIGEST.moveText(m)); }); // "… by override; computed still amber"
  if (d.findings.added.length) f.push(PROSE.count(d.findings.added.length, "new finding"));
  if (d.findings.gone.length) f.push(PROSE.count(d.findings.gone.length, "finding") + " gone");
  if (d.notes.answered.length) f.push(PROSE.count(d.notes.answered.length, "note") + " answered");
  if (d.notes.added.length) f.push(PROSE.count(d.notes.added.length, "new note"));
  if (d.notes.resolved.length) f.push(PROSE.count(d.notes.resolved.length, "note") + " resolved");
  // a note edited in place (its text, its answer or who answered) is a change too, or the toast says only "Updated."
  var moved = d.notes.answered.concat(d.notes.resolved).map(function (r) { return r.id; });
  var edited = arr(d.changed).filter(function (r) { return r.kind === "note" && moved.indexOf(r.id) < 0; }).length;
  if (edited) f.push(PROSE.count(edited, "note") + " edited");
  if (d.units.ready.length) f.push(PROSE.count(d.units.ready.length, "unit") + " newly ready");
  if (d.units.done.length) f.push(PROSE.count(d.units.done.length, "unit") + " newly done");
  if (d.patches.added.length) f.push(PROSE.count(d.patches.added.length, "new patch", "new patches"));
  if (d.patches.decided.length) f.push(PROSE.count(d.patches.decided.length, "patch", "patches") + " decided");
  if (d.claims.regraded.length) f.push(PROSE.count(d.claims.regraded.length, "claim") + " regraded");
  if (arr(d.risks).length) f.push(PROSE.count(d.risks.length, "new risk"));
  // a single field change is said in full ("“X”: due 30 Oct to 9 Oct"); more are counted
  var fl = arr(d.fields);
  if (fl.length === 1) f.push(PROSE.quote(fl[0].name) + ": " + DIGEST.fieldText(fl[0], nm));
  else if (fl.length) f.push(PROSE.count(fl.length, "date, milestone or owner") + " changed");
  // records counted apart: added, removed and changed in the design, and reworded (titles or owners only)
  var rk = Object.keys(d.counts).filter(function (k) { return k !== "finding" && k !== "note" && k !== "patch"; });
  var sum = function (w) { return rk.reduce(function (t, k) { return t + (d.counts[k][w] || 0); }, 0); };
  [["added", "added"], ["removed", "removed"], ["changed", "changed"], ["reworded", "reworded (titles or owners only)"]].forEach(function (p) { var n = sum(p[0]); if (n) f.push(PROSE.count(n, "record") + " " + p[1]); });
  // a change in the checks is kept apart: a new rule's findings are not the design getting worse
  var ck = d.checks;
  if (ck && (ck.rulesAdded.length || ck.rulesRemoved.length)) f.push("the checks changed (" + PROSE.list([ck.rulesAdded.length ? PROSE.count(ck.rulesAdded.length, "new rule") + (ck.findingsAdded.length ? " with " + PROSE.count(ck.findingsAdded.length, "finding") : "") : "", ck.rulesRemoved.length ? PROSE.count(ck.rulesRemoved.length, "rule") + " retired" : ""]) + ")");
  return f.length ? PROSE.list(f, { max: 6 }) : "";
}
/** The panel's lead sentence. */
function sinceSentence(d, nm) { var l = sinceList(d, nm); return l ? PROSE.sentence("Since then: " + l) : "Nothing changed."; }

function sinceHtml(ix, d, when) {
  var nm = DIGEST.names(ix.b);
  var group = function (title, xs, extra) {
    if (!xs.length) return "";
    return '<div class="since-g"><h3 class="small">' + esc(title) + ' <span class="count">' + xs.length + '</span></h3><ul class="rows">' + xs.slice(0, 6).map(function (r) { return "<li>" + diffRecLink(ix, r) + (extra ? " " + extra(r) : "") + "</li>"; }).join("")
      + (xs.length > 6 ? '<li class="xs muted">and ' + PROSE.fmt(xs.length - 6) + " more</li>" : "") + "</ul></div>";
  };
  var arrow = function (r) { return '<span class="xs muted">' + esc(r.from) + " → " + esc(r.to) + (r.override ? " by override; computed " + (r.computed === r.from ? "still " : "") + esc(r.computed) : "") + "</span>"; };
  var recCounts = Object.keys(d.counts).filter(function (k) { return k !== "finding" && k !== "note" && k !== "patch"; }).map(function (k) {
    var c = d.counts[k]; if (!c.added && !c.removed && !c.changed && !c.reworded) return "";
    return "<li><span>" + esc(cap1(PROSE.pluralOf(DIFF_NOUN[k] || k))) + '</span><span class="xs fg2">' + esc(PROSE.list([c.added ? PROSE.fmt(c.added) + " added" : "", c.removed ? PROSE.fmt(c.removed) + " removed" : "", c.changed ? PROSE.fmt(c.changed) + " changed" : "", c.reworded ? PROSE.fmt(c.reworded) + " reworded" : ""])) + "</span></li>";
  }).filter(Boolean);
  return '<div class="since-head"><h2 id="h-since" class="small-h">Since you last looked' + (when ? ' <span class="muted xs">' + esc(humanTime(when)) + "</span>" : "") + '</h2><button type="button" class="btn quiet sm" id="since-dismiss">Dismiss</button></div>'
    + '<p class="since-lead">' + esc(sinceSentence(d, nm)) + "</p>"
    + (DIGEST.churnText(d, d.importer) ? '<p class="small fg2">' + esc(DIGEST.churnText(d, d.importer)) + "</p>" : "")
    + '<div class="since-grid">'
    + group("Status", arr(d.status && d.status.moves), arrow)
    + group("New risks", arr(d.risks))
    + group("Dates, milestones and owners", arr(d.fields), function (r) { return '<span class="xs fg2">' + esc(DIGEST.fieldText(r, nm)) + "</span>"; })
    + group("New problems", d.findings.added) + group("Problems gone", d.findings.gone)
    + group("From new checks, not the design", arr(d.checks && d.checks.findingsAdded)) + group("Gone with retired checks", arr(d.checks && d.checks.findingsGone))
    + group("Notes answered", d.notes.answered) + group("New notes", d.notes.added) + group("Notes resolved", d.notes.resolved)
    + group("Newly ready", d.units.ready) + group("Newly done", d.units.done)
    + group("New changes", d.patches.added) + group("Changes decided", d.patches.decided, arrow) + group("Claims regraded", d.claims.regraded, arrow)
    + (recCounts.length ? '<div class="since-g"><h3 class="small">Records</h3><ul class="rows">' + recCounts.join("") + "</ul>"
      + (d.added.length + d.removed.length + d.changed.length ? '<details class="disc"><summary>Which ones</summary><div class="body"><ul class="rows">' + d.added.concat(d.changed).slice(0, 30).map(function (r) { return '<li><span class="tag">' + esc(DIFF_NOUN[r.kind] || r.kind) + "</span> " + diffRecLink(ix, r) + "</li>"; }).join("")
        + d.removed.slice(0, 15).map(function (r) { return '<li><span class="tag">' + esc(DIFF_NOUN[r.kind] || r.kind) + '</span> <s class="muted">' + esc(r.name) + "</s></li>"; }).join("") + "</ul></div></details>" : "") + "</div>" : "")
    + "</div>";
}

// ---------- page controllers ----------

function strategyPageCtl(S) {
  var ix = S.ix, rows = $$("#claim-list a[data-claim]"), F = { grade: new Set(), kind: new Set() };
  var bar = $("claim-filters"); if (bar) bar.hidden = false;
  function apply() {
    var q = (($("claim-text") || {}).value || "").toLowerCase().split(/\s+/).filter(Boolean), shown = 0, m = matchFor(S, "claim");
    rows.forEach(function (a) {
      var ok = (!m || m.has(a.getAttribute("data-claim"))) && (!F.grade.size || F.grade.has(a.getAttribute("data-grade"))) && (!F.kind.size || F.kind.has(a.getAttribute("data-kind")))
        && q.every(function (w) { return a.getAttribute("data-text").indexOf(w) >= 0; });
      a.parentNode.hidden = !ok; if (ok) shown++;
    });
    var c = $("claim-count"); if (c) c.textContent = shown === rows.length ? plural(shown, "claim") : cap1(listHeading(S, "claim", shown, "", { f: { grade: Array.from(F.grade), kind: Array.from(F.kind) }, more: [q.length ? "matching " + PROSE.quote(q.join(" ")) : ""] })) + ", of " + plural(rows.length, "claim");
    var none = $("claim-none"); if (none) { none.hidden = shown !== 0; if (m) none.textContent = filteredNote(S, "claim", 0, rows.length); }
  }
  if (bar) bar.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-cf]"); if (!b) return;
    var set = F[b.getAttribute("data-cf")], v = b.getAttribute("data-v");
    if (set.has(v)) set.delete(v); else set.add(v);
    b.setAttribute("aria-pressed", set.has(v) ? "true" : "false"); apply();
  });
  var t = $("claim-text"); if (t) t.addEventListener("input", apply);
  return {
    show: function (r) {
      apply();
      var id = r.sub === "claim" ? r.id : null, aside = $("claim-aside"), layout = $("strategy-layout"), main = layout && layout.querySelector(".plan-main");
      rows.forEach(function (a) { a.classList.toggle("sel", a.getAttribute("data-claim") === id); if (a.getAttribute("data-claim") === id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
      if (id) {
        var wide = isWide(1200);
        $("claim-detail").innerHTML = (wide ? "" : '<a class="back-link" href="#strategy">&#8592; All claims</a>') + claimDetail(ix, id, { close: wide ? "#strategy" : null, edit: !!S.dev });
        aside.hidden = false; layout.classList.toggle("has-detail", wide); if (main) main.hidden = !wide;
        fillTimes($("claim-detail"));
      } else { aside.hidden = true; layout.classList.remove("has-detail"); if (main) main.hidden = false; }
    }
  };
}

function notesPageCtl(S) {
  var ix = S.ix, F = { text: $("nf-text"), status: $("nf-status"), kind: $("nf-kind"), target: $("nf-target") };
  var mode = $("notes-mode");
  if (mode) mode.innerHTML = S.dev
    ? '<p class="callout info" style="margin-bottom:var(--sp-4)">' + icon("info") + "<span>Live: notes you add, answer, resolve or delete here are written to <code>notes.yaml</code>, and the page reloads with the change. An edit made to the file reloads the page too.</span></p>"
    : '<p class="callout" style="margin-bottom:var(--sp-4)">' + icon("info") + "<span>Read-only: this page was opened from a file. Run <code>bun plumb.ts dev</code> to add and answer notes here, or use a record's add box to copy the YAML for <code>notes.yaml</code>.</span></p>";
  function render() {
    var q = (F.text && F.text.value || "").toLowerCase().split(/\s+/).filter(Boolean), m = matchFor(S, "note");
    var xs = ix.notes.filter(function (n) {
      if (m && !m.has(n.id)) return false;
      if (!focusKeeps(S, "note", n.id)) return false;
      if (F.status && F.status.value && n.status !== F.status.value) return false;
      if (F.kind && F.kind.value && n.kind !== F.kind.value) return false;
      if (F.target && F.target.value && n.target.kind !== F.target.value) return false;
      var text = (n.id + " " + n.text + " " + (n.answer || "") + " " + n.target.kind + " " + n.target.id).toLowerCase();
      return q.every(function (w) { return text.indexOf(w) >= 0; });
    });
    $("note-list").innerHTML = xs.map(function (n) { return noteCard(ix, n, { edit: !!S.dev }); }).join("");
    fillTimes($("note-list"));
    var c = $("note-count"); if (c) c.textContent = xs.length === ix.notes.length ? plural(xs.length, "note") : cap1(listHeading(S, "note", xs.length, "", { f: { status: F.status && F.status.value ? [F.status.value] : [], kind: F.kind && F.kind.value ? [F.kind.value] : [] }, more: [F.target && F.target.value ? "on " + F.target.value + "s" : "", q.length ? "matching " + PROSE.quote(q.join(" ")) : ""] })) + ", of " + plural(ix.notes.length, "note");
    var none = $("note-none"); if (none) { none.hidden = xs.length !== 0 || !ix.notes.length; if (m) none.textContent = filteredNote(S, "note", 0, ix.notes.length); }
  }
  Object.keys(F).forEach(function (k) { if (F[k]) F[k].addEventListener(k === "text" ? "input" : "change", render); });
  var form = $("note-filters"); if (form) form.addEventListener("reset", function () { setTimeout(render, 0); });
  return {
    show: function (r) {
      render();
      $$(".note-card.sel", $("note-list")).forEach(function (x) { x.classList.remove("sel"); });
      if (r.id) { var el = document.getElementById("note-" + r.id); if (el) { el.classList.add("sel"); if (el.scrollIntoView) el.scrollIntoView({ block: "center" }); } }
    },
    render: render
  };
}

/** Fill the notes and claims slots in the static markup (gate panels, rule blocks, patches) inside root. */
function fillSlots(S, root) {
  var ix = S.ix;
  $$("[data-claims-for]", root).forEach(function (el) { var p = el.getAttribute("data-claims-for").split(":"); el.innerHTML = restsOnSection(ix, p[0], p.slice(1).join(":")); });
  $$("[data-notes-for]", root).forEach(function (el) {
    var v = el.getAttribute("data-notes-for"), i = v.indexOf(":"), kind = v.slice(0, i), id = v.slice(i + 1), targets;
    if (kind === "finding-rule") targets = arr(ix.b.findings).filter(function (f) { return f.pack + "/" + f.rule === id; }).map(function (f) {
      var e = ix.el.get(f.at), u = ix.unit.get(f.at); return { kind: "finding", id: f.pack + "/" + f.rule + "@" + f.at, label: (e ? e.name : u ? f.at + " " + u.title : f.at) };
    });
    else targets = [{ kind: kind, id: id }];
    el.innerHTML = targets.length ? notesBlock(ix, targets, { edit: !!S.dev, title: kind === "finding-rule" ? "Notes on these findings" : "Notes" }) : "";
  });
  fillTimes(root);
}
function fillTimes(root) { $$("time[datetime]", root).forEach(function (t) { if (!t.textContent || t.textContent === t.getAttribute("datetime")) t.textContent = humanTime(t.getAttribute("datetime")); }); }

/** The note actions and the add, answer and edit forms, wired once for the whole page. */
function wireNotes(S) {
  var ix = S.ix;
  var nowIso = function () { return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); };
  function send(payload, done) {
    if (!S.dev) return;
    payload.version = S.dev.version;
    S.toast("Saving…");
    // the request itself lives in the dev server's snippet (window.__deNotes), so the offline file holds no network code
    if (!window.__deNotes) { S.toast("Not saved: the dev server's connection is not ready yet."); return; }
    window.__deNotes(payload)
      .then(function (r) {
        if (r.status === 200) { S.dev.version = r.body.version; S.toast("Saved to notes.yaml. The page reloads with the change."); if (done) done(r.body); return; }
        if (r.status === 409) { S.toast(r.body.message || "The notes changed; reloading."); setTimeout(function () { if (window.__deReload) window.__deReload(); else location.reload(); }, 900); return; }
        S.toast("Not saved: " + (r.body.message || ("error " + r.status)));
      }, function () { S.toast("Not saved: the dev server did not answer."); });
  }
  document.addEventListener("submit", function (ev) {
    var f = ev.target.closest && ev.target.closest("form[data-note-form]");
    if (!f) return;
    ev.preventDefault();
    var kind = f.getAttribute("data-note-form"), text = (f.querySelector("textarea") || {}).value || "";
    text = text.trim();
    if (!text) { S.toast("Write the text first."); return; }
    if (kind === "add") {
      var targets = JSON.parse(f.getAttribute("data-targets") || "[]"), sel = f.querySelector("select[name=target]");
      var target = targets[sel ? Number(sel.value) : 0];
      var nk = (f.querySelector("input[name=kind]:checked") || {}).value || "note";
      if (S.dev) send({ op: "add", target: target, kind: nk, text: text }, function () { f.reset(); });
      else {
        var n = { id: nextNoteId(ix), target: target, kind: nk, text: text, status: "open", author: "person", created: nowIso(), updated: nowIso() };
        copyText(noteYaml(n), function (ok) { S.toast(ok ? "Copied the YAML. Paste it under notes: in notes.yaml." : "Copy is not available here"); });
      }
    } else if (kind === "answer") send({ op: "answer", id: f.getAttribute("data-note-id"), answer: text });
    else if (kind === "edit") send({ op: "edit", id: f.getAttribute("data-note-id"), text: text });
  });
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-note-act]");
    if (!b) return;
    var act = b.getAttribute("data-note-act"), id = b.getAttribute("data-note-id"), card = b.closest(".note-card");
    var n = ix.notes.filter(function (x) { return x.id === id; })[0];
    if (act === "answer" || act === "edit") {
      var old = card.querySelector("form[data-note-form]"); if (old) { old.remove(); return; }
      var fm = document.createElement("form");
      fm.className = "note-form inline"; fm.setAttribute("data-note-form", act); fm.setAttribute("data-note-id", id);
      fm.innerHTML = '<label class="field"><span class="sr-only">' + (act === "answer" ? "Answer" : "Text") + '</span><textarea rows="3" maxlength="10000" required>' + esc(act === "edit" && n ? n.text : "") + '</textarea></label><div class="note-acts"><button type="submit" class="btn primary sm">' + (act === "answer" ? "Save answer" : "Save") + '</button><button type="button" class="btn quiet sm" data-note-cancel>Cancel</button></div>';
      card.appendChild(fm); fm.querySelector("textarea").focus();
      return;
    }
    if (act === "delete") { if (!window.confirm || window.confirm("Delete " + id + " from notes.yaml?")) send({ op: "delete", id: id }); return; }
    send({ op: act, id: id });
  });
  document.addEventListener("click", function (ev) { var c = ev.target.closest && ev.target.closest("[data-note-cancel]"); if (c) c.closest("form").remove(); });
}
function copyText(text, cb) {
  var fallback = function () {
    var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; } ta.remove(); cb(ok);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { cb(true); }, fallback); else fallback();
}

/** "Since you last looked": compare the digest the reader last saw with this build, lead the Overview with it. */
function sinceLooked(S, store) {
  var b = S.bundle, key = "de-seen:" + ((b.instance && b.instance.name) || location.pathname);
  var cur = DIGEST.digest(b), prev = null;
  try { prev = JSON.parse(store.get(key) || "null"); } catch (e) { prev = null; }
  var save = function () { store.set(key, JSON.stringify({ at: new Date().toISOString(), d: cur })); };
  var box = $("since");
  var showing = false;
  if (prev && prev.d && prev.d.hash !== cur.hash && box) {
    var d = DIGEST.compare(prev.d, cur, DIGEST.names(b));
    if (!DIGEST.isEmpty(d)) {
      box.innerHTML = sinceHtml(S.ix, d, prev.at); box.hidden = false; showing = true;
      $("since-dismiss").addEventListener("click", function () { save(); box.hidden = true; showing = false; S.announce("Dismissed. The next visit compares with this build."); });
    }
  }
  if (!prev) save();
  window.addEventListener("pagehide", function () { if (!showing) save(); });
  // A reload from the dev server's live loop is not a return visit: its toast says what changed, so the panel steps aside.
  S.since = { showing: function () { return showing; }, absorb: function () { save(); if (box) box.hidden = true; showing = false; } };
}

api.exposureSentence = exposureSentence; api.claimDetail = claimDetail; api.notesBlock = notesBlock; api.noteCard = noteCard; api.noteYaml = noteYaml; api.sinceHtml = sinceHtml; api.sinceSentence = sinceSentence; api.sinceList = sinceList;
api.restsOnSection = restsOnSection; api.gradeHtml = gradeHtml;
