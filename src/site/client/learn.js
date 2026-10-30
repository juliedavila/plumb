/* Plumb site client, part 3f: "Learn the interface", the second tour. Generic: it works on any instance and
   picks its targets from whatever bundle is open (the unit that unblocks the most, its owner team or its zone, the
   largest zone, the deck). One step per move: hover for a card, click for a drawer, stack a second, Escape back, set
   a filter chip and watch it carry to another page, Follow a link and climb the crumbs, open a zone from the
   Overview, switch the Overview's work area with a tile, start present mode and leave it. A step names a route
   (hash) and, where the move is not a route, an act the tour performs on screen (hover, drawer, stack). Pure: the
   tests call learnTour without a DOM. */

function learnTour(ix) {
  var steps = [];
  var ranked = rankedFrontier(ix);
  var uid = ranked.length ? ranked[0].id : recordsOf(ix, "unit")[0];
  var u = uid ? ix.unit.get(uid) : null;
  var ut = u ? PROSE.quote(u.title) : "";
  if (u) {
    // the second record to stack: a part it changes, else its milestone
    var parts = linkSet(ix, "unit", [uid], "parts"), second = parts.length ? "element:" + parts[0] : ix.phase.has(u.phase) ? "phase:" + u.phase : null;
    var secondName = second ? PROSE.quote(recordTitle(ix, splitKey(second).kind, splitKey(second).id)) : "";
    steps.push({ title: "Hover over a reference for its card", say: "Rest the pointer on any reference, here the unit " + ut + ", and its card appears: what it is, its title and a few fields. Nothing on the page moves.", hash: "#plan", act: "hover", ref: "unit:" + uid });
    steps.push({ title: "Click it for a drawer", say: "Click the reference and a drawer opens on the right, over the dimmed page, with the same fields and everything the record links to, as counts that open in place.", hash: "#plan", act: "drawer", ref: "unit:" + uid });
    if (second) steps.push({ title: "Open a second drawer on top", say: "A record inside a drawer opens another drawer on top of it: here " + secondName + ", which " + (parts.length ? "the unit changes" : "the unit belongs to") + ".", hash: "#plan", act: "stack", ref: "unit:" + uid, ref2: second });
    steps.push({ title: "Escape steps back", say: "Escape, or Back in the drawer, closes the top drawer and leaves the one under it and the page exactly as they were. Escape again closes the last.", hash: "#plan", act: "drawer", ref: "unit:" + uid });
  }
  // a filter chip, from the unit: its owner team, else the zone of a part it changes, else its milestone
  var f = null, chip = "";
  var owners = u ? unitRolesOf(ix, uid).owners : [];
  if (owners.length) { f = { owner: [owners[0]] }; chip = "Owner team: " + teamName(ix, owners[0]); }
  else {
    var zp = u ? arr(u.elements).map(function (m) { var e = ix.el.get(m && m.id); return e && e.zone; }).filter(Boolean)[0] : null;
    if (zp) { f = { zone: [zp] }; chip = "Zone: " + facetLabel(ix, "zone", zp); }
    else if (u && ix.phase.has(u.phase)) { f = { milestone: [u.phase] }; chip = "Milestone: " + milestoneLabel(ix, u.phase); }
  }
  if (f) {
    steps.push({ title: "Set a filter chip", say: "Filter adds a chip under the header, and the page keeps what matches: the chip " + PROSE.quote(chip) + " leaves only its units. The filter lives in the address, so Back undoes it and a link shares it.", hash: withState("#plan/units", { f: f }) });
    steps.push({ title: "The chip carries to another page", say: "Go to another page and the same chip still applies: here the parts that match it. One filter, honoured by every page, and drawings fade what it leaves out.", hash: withState("#model/elements", { f: f }) });
    var key = linkSet(ix, "unit", Array.from(matchingSet(ix, "unit", f, null) || []), "parts").length ? "parts" : "rests-on";
    var fh = followHash({ kind: "unit", f: f }, key);
    var trail = stateOf(parseRoute(fh)).trail;
    steps.push({ title: "Follow a link", say: "Follow lists where you can go from the set on screen, with the counts first. Choosing one lists the linked records on their own page, with a crumb trail above that says how you got there.", hash: fh });
    if (trail && trail.length > 1) steps.push({ title: "Climb the crumbs", say: "Each crumb in the trail climbs back to that step, with its filter live again. The trail, too, is in the address.", hash: crumbHash(trail, 0) });
  }
  // a zone from the Overview: the largest
  var scenes = arr(ix.b.zoneScenes).filter(function (z) { return z && z.zone != null; }).sort(function (a, b) { return arr(b.layout && b.layout.nodes).length - arr(a.layout && a.layout.nodes).length; });
  if (scenes.length) {
    steps.push({ title: "Open a zone from the Overview", say: "The system tile on the Overview draws one box per zone; selecting a box opens that zone.", hash: "#overview/system" });
    steps.push({ title: "A zone's own drawing", say: "The zone " + PROSE.quote(scenes[0].name) + " drawn from the model: its parts, the lines between them, and a doorway on the edge for every zone that lines cross to, with the count. A doorway opens that zone.", hash: R.zone(scenes[0].zone) });
  }
  steps.push({ title: "Switch the work area with a tile", say: "Each tile on the Overview answers one question with a number and a line. Selecting a tile switches the work area below it to that tile's lists, and selecting a bar there sets its chip.", hash: "#overview/plan" });
  if (arr(ix.b.deck && ix.b.deck.slides).length) {
    var n = arr(ix.b.deck.slides).length > 1 ? 2 : 1;
    steps.push({ title: "Present mode", say: "Present, or P, turns this build into a deck for the room: where the plan stands, what is in the way, the path to green. Arrows move; N opens the speaker notes.", hash: R.present(n) });
    steps.push({ title: "Leave it", say: "Esc leaves the deck where you were. Press ? at any time for every key and move on one screen.", hash: "#overview" });
  } else steps.push({ title: "Every key and move", say: "Press ? at any time for every key and move on one screen.", hash: "#overview" });
  return { title: "Learn the interface", steps: steps };
}
api.learnTour = learnTour;
