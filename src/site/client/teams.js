/* Plumb site client, part 3e: the Teams page. A team clicked anywhere (any [data-team-open]: a name on this
   page, a box in the drawing, a team in a path to green) goes to #teams with the owner filter set to it and opens its
   card on top, so the team's open work lists here with titles, status and milestone, and Follow carries on from that
   set. An arrow in the drawing, a number in the matrix or a pair in the list shows the dependencies behind it as
   sentences, titles first. */

function teamsPageCtl(S) {
  var page = $("teams");
  if (!page) return null;
  var ix = S.ix;
  function work() {
    var sec = $("team-work"), owners = arr(S.st && S.st.f && S.st.f.owner).filter(function (t) { return ix.team.has(t); });
    // no owner chip: the focus's team (or the teams its lead runs) opens the same section on top
    var ff = focusNow(S); if (!owners.length && ff) owners = ff.teams.slice();
    if (!sec) return;
    $$("tr[data-team-row]", page).forEach(function (tr) { tr.classList.toggle("fz-row", !!ff && ff.teams.indexOf(tr.getAttribute("data-team-row")) >= 0); });
    if (!owners.length) { sec.hidden = true; return; }
    var m = matchFor(S, "unit");
    var ids = (m ? Array.from(m) : recordsOf(ix, "unit")).filter(function (id) {
      var u = ix.unit.get(id); return u && u.status !== "done" && unitRolesOf(ix, id).owners.some(function (t) { return owners.indexOf(t) >= 0; });
    });
    var rank = { doing: 0, ready: 1, blocked: 2, noprov: 3 };
    ids.sort(function (a, b) { var ua = ix.unit.get(a), ub = ix.unit.get(b); return milestoneIndex(ix, ua.phase) - milestoneIndex(ix, ub.phase) || (rank[unitState(ix, ua)] - rank[unitState(ix, ub)]) || natural(a, b); });
    var names = owners.map(function (t) { return teamName(ix, t); });
    $("h-team-work").textContent = owners.length === 1 ? names[0] + "’s open work" : "Open work of " + PROSE.list(names, { conj: "or" });
    // who runs the team, said once above its work: its lead, or that none is named (never a finding)
    var ld = owners.length === 1 ? ((ix.team.get(owners[0]) || {}).lead ? "Lead: " + (ix.team.get(owners[0]) || {}).lead + ". " : "No lead named. ") : "";
    $("team-work-sub").textContent = ld + (ids.length ? PROSE.sentence(PROSE.count(ids.length, "open unit") + " by milestone; Follow, above, goes on from this set") : "");
    $("team-work-list").innerHTML = ids.length ? '<ul class="rows team-work-rows">' + ids.map(function (id) {
      var u = ix.unit.get(id), s = unitState(ix, u);
      return '<li>' + statusHtml(s, UNIT_WORD[s], "sm") + '<a href="' + R.unit(id) + '" data-unit="' + esc(id) + '">' + esc(u.title) + '</a> <span class="id small">' + esc(id) + '</span><span class="tag">' + esc(milestoneLabel(ix, u.phase)) + "</span></li>";
    }).join("") + "</ul>" : '<p class="empty">' + esc(owners.length === 1 ? names[0] + " owns no open work" + (hasFilters(S.st.f) && Object.keys(S.st.f).length > 1 ? " that matches the other filters" : "") + "." : "None of these teams owns open work.") + "</p>";
    sec.hidden = false;
  }
  function showWait(key, focus) {
    var found = null;
    $$("[data-wait-list]", page).forEach(function (d) { var on = d.getAttribute("data-wait-list") === key; d.hidden = !on; if (on) found = d; });
    $$("[data-wait]", page).forEach(function (g) { g.classList.toggle("on", g.getAttribute("data-wait") === key); });
    var box = found && found.closest ? found.closest(".wait-detail") : null;
    $$(".wait-hint", page).forEach(function (h) { h.hidden = !!(box && box.contains(h)); });
    if (found) {
      linkifyAll(S, found);
      if (found.scrollIntoView && !isInView(found)) found.scrollIntoView({ block: "nearest" });
      if (focus) { var h = found.querySelector("h3"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
      S.announce(found.querySelector("h3").textContent.replace(/\s+/g, " ").trim());
    }
  }
  function isInView(el) { var r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }
  page.addEventListener("click", function (ev) {
    var w = ev.target.closest && ev.target.closest("[data-wait]");
    if (w && !ev.target.closest("a")) { ev.preventDefault(); showWait(w.getAttribute("data-wait"), false); }
  });
  page.addEventListener("keydown", function (ev) {
    var w = ev.target.closest && ev.target.closest("g[data-wait]");
    if (w && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); showWait(w.getAttribute("data-wait"), true); }
  });
  return { show: function () { work(); }, showWait: showWait };
}

/** Open a team from anywhere: the Teams page with its owner filter set, and its card on top. */
function openTeam(S, id, trigger) {
  var f = {}; Object.keys((S.st && S.st.f) || {}).forEach(function (k) { if (k !== "owner") f[k] = S.st.f[k]; });
  f.owner = [id];
  S.pendingTeam = { id: id, trigger: trigger };
  S.go(withState("#teams", { f: f, sel: S.st && S.st.sel }));
}
api.teamsPageCtl = teamsPageCtl;
