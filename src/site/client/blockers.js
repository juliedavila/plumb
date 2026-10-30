/* Plumb site client, part 1c: what a unit waits on, grouped by capability. A unit waits on capabilities, not
   on units: one row per capability it still needs, naming the capability (in words; its key is the tooltip) and the
   unit or units that provide it. Several providers are alternatives, and the row says so ("either one" for two, "any
   one of" for more): finishing any of them is enough. Capabilities already met (a done unit provides them) sit under a
   collapsed "Already met" line in the same section. The mirror list, the units that wait on this one, groups by the
   capability this unit provides, and says when another unit provides it too. Pure: the tests call it without a DOM. */

/** A capability key in words: "cap.stage-timestamps" reads “stage timestamps”. */
function capWords(c, ix) {
  var bare = str(c).replace(/^[a-z][a-z0-9-]*:/, "");
  var declared = arr(ix && ix.b.plan.capabilities).find(function (x) { return x.id === c || str(x.id).replace(/^[a-z][a-z0-9-]*:/, "") === bare; });
  return PROSE.quote(declared && declared.name || bare.replace(/^cap\./, "").replace(/[-_.]+/g, " ").trim());
}

/**
 * Each capability a unit requires: { cap, words, providers (the other units that provide it, in plan order), open (those
 * not done), met (a done unit provides it) }.
 */
function blockerGroups(ix, id) {
  var u = ix.unit.get(id); if (!u) return [];
  return uniq(arr(u.requires)).map(function (c) {
    var prov = (ix.providers.get(c) || []).filter(function (p) { return p !== id && ix.unit.has(p); }).sort(natural);
    var open = prov.filter(function (p) { return ix.unit.get(p).status !== "done"; });
    return { cap: c, words: capWords(c, ix), providers: prov, open: open, met: open.length < prov.length };
  });
}

/**
 * The units that wait on this one, by the capability it provides: { cap, words, waiters (units that require it: open
 * ones, or every one for a done unit), others (other units that provide it too), met (a done unit provides it, so the
 * open waiters no longer wait on this one for it) }.
 */
function mirrorGroups(ix, id) {
  var u = ix.unit.get(id); if (!u) return [];
  var done = u.status === "done";
  return uniq(arr(u.provides)).map(function (c) {
    var waiters = (ix.requirers.get(c) || []).filter(function (r) { var x = ix.unit.get(r); return r !== id && x && (done || x.status !== "done"); }).sort(natural);
    var others = (ix.providers.get(c) || []).filter(function (p) { return p !== id && ix.unit.has(p); }).sort(natural);
    var met = done || others.some(function (p) { return ix.unit.get(p).status === "done"; });
    return { cap: c, words: capWords(c, ix), waiters: waiters, others: others, met: met };
  }).filter(function (g) { return g.waiters.length; });
}

/** Alternatives in words: "A", "either one: A or B", "any one of A, B or C". items are HTML. */
function altHtml(items) {
  if (items.length <= 1) return items.join("");
  var last = items[items.length - 1], head = items.slice(0, -1).join(", ");
  return items.length === 2 ? '<span class="alt">either one:</span> ' + head + " or " + last : '<span class="alt">any one of</span> ' + head + " or " + last;
}
/** A unit reference with its state, short in a card. */
function blkUnit(ix, p, compact) {
  var pu = ix.unit.get(p); if (!pu) return esc(p);
  var s = unitState(ix, pu);
  return compact ? refChip(ix, "unit", p, PROSE.quote(clip(pu.title, 44))) : '<a href="' + R.unit(p) + '" data-unit="' + esc(p) + '" title="' + esc(p) + '">' + esc(pu.title) + "</a> " + statusHtml(s, UNIT_WORD[s], "sm");
}
function capLabel(g) { return '<span class="blk-cap" title="' + esc(g.cap) + '">' + esc(g.words) + "</span>"; }

/** One blocking row: the capability, then the unit or units that provide it (alternatives said so), or that none does. */
function blockerRow(ix, g, compact) {
  var ac = acrossOf(ix, g.cap);
  if (!g.providers.length) return '<li class="blk-row" data-blk="' + esc(g.cap) + '">' + capLabel(g) + (ac ? ' <span class="fg2">from</span> ' + esc(ac) : ' <span class="st noprov sm">' + icon("noprov") + '<span class="w">No unit provides this</span></span>') + "</li>";
  var ps = g.met ? g.providers.filter(function (p) { return ix.unit.get(p).status === "done"; }) : g.open;
  return '<li class="blk-row" data-blk="' + esc(g.cap) + '"' + (ps.length > 1 ? ' data-alternatives="' + ps.length + '"' : "") + ">" + capLabel(g) + ' <span class="fg2">from</span> ' + altHtml(ps.map(function (p) { return blkUnit(ix, p, compact); })) + "</li>";
}

/**
 * What a unit waits on, grouped by capability, as HTML: the unmet capabilities as rows, then the met ones under a
 * collapsed "Already met (N)" line. o.compact: a card (short titles, three rows, the met ones as a count). "" when the
 * unit requires nothing.
 */
function blockersHtml(ix, id, o) {
  o = o || {};
  var gs = blockerGroups(ix, id);
  if (!gs.length) return "";
  var unmet = gs.filter(function (g) { return !g.met; }), met = gs.filter(function (g) { return g.met; });
  var max = o.compact ? 3 : 1e9;
  var rows = unmet.slice(0, max).map(function (g) { return blockerRow(ix, g, o.compact); }).join("")
    + (unmet.length > max ? '<li class="small muted">' + esc("and " + PROSE.count(unmet.length - max, "more capability", "more capabilities")) + "</li>" : "");
  var metHtml = !met.length ? "" : o.compact
    ? '<p class="small muted blk-met">' + esc("Already met: " + PROSE.fmt(met.length)) + "</p>"
    : '<details class="disc blk-met"><summary>Already met <span class="count">' + PROSE.fmt(met.length) + '</span></summary><div class="body"><ul class="rows blk-list">' + met.map(function (g) { return blockerRow(ix, g, o.compact); }).join("") + "</ul></div></details>";
  return (rows ? '<ul class="rows blk-list">' + rows + "</ul>" : "") + metHtml;
}

/** One mirror row: the capability this unit provides, the units that need it, and whether another unit provides it too. */
function mirrorRow(ix, g, compact, o) {
  o = o || {};
  var max = compact ? 2 : 1e9;
  var us = g.waiters.slice(0, max).map(function (w) { return (compact ? refChip(ix, "unit", w, PROSE.quote(clip((ix.unit.get(w) || {}).title || w, 44))) : unitLink(ix, w)) + (o.readies && o.readies.indexOf(w) >= 0 ? ' <span class="tag accent">Ready when this is done</span>' : ""); });
  var more = g.waiters.length > max ? esc(", and " + PROSE.count(g.waiters.length - max, "more")) : "";
  var also = g.others.length ? ' <span class="small fg2 alt">' + esc(g.others.length === 1 ? "also provided by " : "also provided by any one of ") + g.others.map(function (p) { return refChip(ix, "unit", p, PROSE.quote(clip((ix.unit.get(p) || {}).title || p, 44))); }).join(", ") + esc(g.others.length === 1 ? "; either one will do" : "; any one will do") + "</span>" : "";
  return '<li class="blk-row" data-blk="' + esc(g.cap) + '">' + capLabel(g) + also + '<span class="blk-us">' + us.join(compact ? ", " : "") + more + "</span></li>";
}

/**
 * The units that wait on this one (or, for a done unit, depended on it), grouped by the capability this unit provides.
 * For an open unit, capabilities a done unit already provides go under a collapsed "Already met (N)" line.
 */
function mirrorHtml(ix, id, o) {
  o = o || {};
  var u = ix.unit.get(id); if (!u) return "";
  var gs = mirrorGroups(ix, id);
  if (!gs.length) return "";
  var done = u.status === "done";
  var wait = done ? gs : gs.filter(function (g) { return !g.met; }), met = done ? [] : gs.filter(function (g) { return g.met; });
  var max = o.compact ? 3 : 1e9;
  var rows = wait.slice(0, max).map(function (g) { return mirrorRow(ix, g, o.compact, o); }).join("")
    + (wait.length > max ? '<li class="small muted">' + esc("and " + PROSE.count(wait.length - max, "more capability", "more capabilities")) + "</li>" : "");
  var metHtml = !met.length ? "" : o.compact
    ? '<p class="small muted blk-met">' + esc("Already met: " + PROSE.fmt(met.length)) + "</p>"
    : '<details class="disc blk-met"><summary>Already met <span class="count">' + PROSE.fmt(met.length) + '</span></summary><div class="body"><ul class="rows blk-list">' + met.map(function (g) { return mirrorRow(ix, g, o.compact, o); }).join("") + "</ul></div></details>";
  return (rows ? '<ul class="rows blk-list">' + rows + "</ul>" : "") + metHtml;
}

/** A blocked unit in a list row, in words: its first unmet capability and who provides it (alternatives said so), and how many more. */
function waitsOnGrouped(ix, id) {
  var gs = blockerGroups(ix, id).filter(function (g) { return !g.met; });
  if (!gs.length) return "";
  var g = gs[0];
  var who = !g.providers.length ? " (no unit provides it)" : " from " + altHtml(g.open.map(function (p) { var pu = ix.unit.get(p); return '<a href="' + R.unit(p) + '" data-unit="' + esc(p) + '">' + esc(pu.title) + "</a> (" + esc(ownerWords(ix, p)) + ")"; }));
  return "waits on " + capLabel(g) + who + (gs.length > 1 ? " and " + esc(PROSE.count(gs.length - 1, "more capability", "more capabilities")) : "");
}

api.blockerGroups = blockerGroups; api.mirrorGroups = mirrorGroups; api.blockersHtml = blockersHtml; api.mirrorHtml = mirrorHtml; api.capWords = capWords; api.waitsOnGrouped = waitsOnGrouped;
