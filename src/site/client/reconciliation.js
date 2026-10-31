/* Read-only reconciliation detail. Included only when the bundle has reconciliation facts. */
function reconciliationDetail(ix, id, im, h) {
  var ex = im && im.exposure, settlers = ex && ex.settling;
  var outsideTests = settlers ? settlers.filter(function (u) { return !ix.unit.has(u.id); }) : [];
  if (outsideTests.length) h.push(sec("Settled in another design", outsideTests.length, '<ul class="rows">' + outsideTests.map(function (u) { return "<li>Settled in " + esc(u.design) + " by <code>" + esc(u.id) + "</code>: " + esc(u.status || "not in this workspace") + "</li>"; }).join("") + "</ul>"));
  var qualified = id.indexOf(":") >= 0 ? id : (ix.b.instance.namespace || ix.b.instance.name) + ":" + id;
  var links = arr(ix.b.premiseLinks && ix.b.premiseLinks.links).filter(function (l) { return l.from === qualified || l.to === qualified; });
  if (links.length) h.push(sec("Reconciliation links in and out", links.length, '<ul class="rows">' + links.map(function (l) {
    return "<li><code>" + esc(l.id) + "</code>: " + (l.from === qualified ? "Out to " : "In from ") + "<code>" + esc(l.from === qualified ? l.to : l.from) + "</code> · " + esc(l.type.replace(/-/g, " ")) + " · " + esc(l.status)
      + (l.confirmed ? "<br>Falsifier clause: “" + esc(l.confirmed.falsifier_clause) + "”<br>Moved clause: “" + esc(l.confirmed.moved_clause) + "”" : "<br>" + esc(l.found.reasoning)) + "</li>";
  }).join("") + "</ul>"));
  if (im && im.preview && (arr(im.preview.dependents).length || arr(im.preview.units).length)) h.push(sec("Would cascade if confirmed", null, '<ul class="rows">' + arr(im.preview.dependents).map(function (d) {
    return "<li>" + esc(d.kind) + " <code>" + esc(d.id) + "</code> · " + esc(d.status || "found") + " through " + arr(d.links).map(function (l) { return esc(l.id + " (" + l.status + ")"); }).join(", ") + "</li>";
  }).join("") + arr(im.preview.units).map(function (g) { return "<li>Work: <code>" + esc(arr(g.units).join(", ")) + "</code> · found</li>"; }).join("") + "</ul>"));
  return outsideTests;
}

function reconciliationExposure(ex) {
  return "It is settled in " + PROSE.list(ex.outsidePlanOrder) + ", outside this design's plan order. " + PROSE.count(ex.before, "open unit") + " in this design " + (ex.before === 1 ? "rests" : "rest") + " on it.";
}
function reconciliationRef(ix, d, link) {
  return d.id.indexOf(":") >= 0 && !ix.el.has(d.id) && !ix.unit.has(d.id) && !ix.claim.has(d.id) && !ix.phase.has(d.id) && !ix.rel.has(d.id) ? "<code>" + esc(d.id) + "</code>" : link;
}
