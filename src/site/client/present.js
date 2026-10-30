/* Plumb site client, part 3c: present mode. The deck (src/site/present.ts) is static markup in the page; this
   shows one slide at a time on #present/<n>, and takes the keys: arrows, Space, Page Up and Down, Home and End move;
   Esc leaves; N opens the speaker notes in a window of their own for the presenter's screen (Shift N, or a blocked
   pop-up, shows them under the slide instead); F asks the browser for full screen. Under the dev server a "Mark as
   presented" button saves a snapshot of this build as what the room saw (window.__deReport, from the dev snippet). */

function presentCtl(S) {
  var deck = $("present");
  if (!deck) return null;
  var slides = $$(".slide", deck), n = slides.length, cur = 1, notesWin = null, inline = false;
  var count = $("deck-count"), panel = $("deck-notes"), mark = $("deck-mark"), end = $("deck-end");
  function notesHtml(i, forWindow) {
    var sl = slides[Math.min(i, n) - 1], aside = sl && sl.querySelector(".notes");
    var next = slides[i] ? slides[i].querySelector("h2") : null;
    var html = aside ? aside.innerHTML : "<p>No notes.</p>";
    // the pop-up gets plain text: record chips are for the page, where hovering one shows its card
    if (forWindow) html = html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<a\b[^>]*>|<\/a>/g, "");
    return html + (forWindow ? '<p class="next">' + (next ? "Next: " + esc(next.textContent) : "Last slide") + "</p>" : "");
  }
  var markNow = function () {};
  function writeWindow() {
    if (!notesWin || notesWin.closed) { notesWin = null; return; }
    try {
      var d = notesWin.document;
      if (!d.getElementById("de-notes")) {
        var st = d.createElement("style");
        st.textContent = ":root{color-scheme:light dark}body{margin:0;padding:20px 24px;background:Canvas;color:CanvasText;font:18px/1.5 system-ui,-apple-system,sans-serif}h3{font-size:14px;font-weight:500;opacity:.7;margin:0 0 8px}ul{padding-left:1.2em;margin:0}li{margin:0 0 10px}.next{margin-top:18px;padding-top:12px;border-top:1px solid GrayText;font-size:15px;opacity:.8}";
        (d.head || d.documentElement).appendChild(st);
        var box = d.createElement("div"); box.id = "de-notes"; (d.body || d.documentElement).appendChild(box);
      }
      d.getElementById("de-notes").innerHTML = notesHtml(cur, true);
      if (mark && !mark.hidden && !d.getElementById("de-mark")) {
        var mb = d.createElement("button"); mb.id = "de-mark"; mb.type = "button"; mb.textContent = mark.textContent; mb.disabled = mark.disabled;
        mb.style.cssText = "margin-top:16px;font:inherit;font-size:15px;padding:6px 12px";
        mb.addEventListener("click", function () { markNow(); });
        (d.body || d.documentElement).appendChild(mb);
      }
      var mb2 = d.getElementById("de-mark"); if (mb2 && mark) { mb2.textContent = mark.textContent; mb2.disabled = mark.disabled; }
      d.title = "Notes · " + cur + " / " + n;
    } catch (e) { notesWin = null; }
  }
  function writeInline() {
    if (!panel) return;
    panel.hidden = !inline;
    if (inline) panel.innerHTML = notesHtml(cur, false) + (notesWin ? "" : S.notesBlocked ? '<p class="warn">The notes window was blocked, so the notes are here, in the shared window. Allow pop-ups for this page to keep them off the screen share.</p>' : "");
  }
  function show(i) {
    // n + 1 is the end screen after the last slide: where Mark as presented lives, off the slides the room reads
    cur = Math.max(1, Math.min(end ? n + 1 : n, i || 1));
    deck.hidden = false;
    document.documentElement.classList.add("deck-on");
    slides.forEach(function (s, j) { s.hidden = j !== cur - 1; });
    if (end) end.hidden = cur !== n + 1;
    if (count) count.textContent = cur > n ? "End" : cur + " / " + n;
    var h2 = cur > n ? end.querySelector("h2") : slides[cur - 1].querySelector("h2");
    document.title = cur > n ? "End of the deck" : "Slide " + cur + " of " + n + " · " + (h2 ? h2.textContent : "");
    if (h2 && !S.tour.on) h2.focus({ preventScroll: true });
    writeInline(); writeWindow();
    S.announce(cur > n ? "End of the deck" : "Slide " + cur + " of " + n + (h2 ? ": " + h2.textContent : ""));
  }
  function hide() {
    deck.hidden = true;
    document.documentElement.classList.remove("deck-on");
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () { /* already out */ });
  }
  function go(i) { S.go(R.present(Math.max(1, Math.min(end ? n + 1 : n, i)))); }
  function toggleNotes(inlineOnly) {
    if (inlineOnly) { inline = !inline; writeInline(); return; }
    if (notesWin && !notesWin.closed) { notesWin.close(); notesWin = null; return; }
    var w = null;
    try { w = window.open("", "de-deck-notes", "popup=yes,width=640,height=760"); } catch (e) { w = null; }
    if (w) { notesWin = w; S.notesBlocked = false; writeWindow(); }
    else { S.notesBlocked = true; inline = !inline; writeInline(); }
  }
  function key(ev) {
    var k = ev.key;
    if (k === "ArrowRight" || k === "ArrowDown" || k === " " || k === "PageDown") { ev.preventDefault(); go(cur + 1); return true; }
    if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") { ev.preventDefault(); go(cur - 1); return true; }
    if (k === "Home") { ev.preventDefault(); go(1); return true; }
    if (k === "End") { ev.preventDefault(); go(n); return true; }
    if (k === "Escape") { ev.preventDefault(); S.go(S.beforePresent || "#overview"); return true; }
    if (k === "n" || k === "N") { ev.preventDefault(); toggleNotes(ev.shiftKey); return true; }
    if (k === "f" || k === "F") {
      ev.preventDefault();
      if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen().catch(function () {}); }
      else if (deck.requestFullscreen) deck.requestFullscreen().catch(function () { S.announce("Full screen is not available here"); });
      return true;
    }
    return false;
  }
  // the dev snippet defines window.__deReport after this script runs, so the button keys off the injected config
  if (mark && S.dev && S.dev.report) {
    mark.hidden = false;
    var done = function (file, when, already) {
      mark.disabled = true;
      var at = when ? humanTime(when).replace(/^.*, /, "") : "";
      mark.textContent = already ? "Already marked as presented" + (at ? " at " + at : "") : "Marked as presented" + (at ? " at " + at : "");
      mark.title = "Saved " + (when ? humanTime(when) + " " : "") + "in " + file;
      var msg = already ? "Already saved as presented, in " + file + "; nothing new was written." : "Saved as presented, in " + file + ". The next deck compares with this build.";
      if (S.toast) S.toast(msg); else S.announce(msg);
    };
    var prior = presentedReport(S.bundle || (S.ix && S.ix.b));
    if (prior) { mark.disabled = true; mark.textContent = "Marked as presented" + (prior.presented ? " at " + humanTime(prior.presented).replace(/^.*, /, "") : ""); mark.title = "Saved in " + prior.file; }
    // after a reload the page may predate the snapshot (the build is not redone for reports/): the server says so too
    if (!prior && S.dev.presented) { mark.disabled = true; mark.textContent = "Marked as presented" + (S.dev.presented.presented ? " at " + humanTime(S.dev.presented.presented).replace(/^.*, /, "") : ""); mark.title = "Saved in " + S.dev.presented.file; }
    markNow = function () {
      if (mark.disabled) return;
      if (typeof window.__deReport !== "function") { S.announce("Not saved: this page was not served by bun plumb.ts dev."); return; }
      mark.disabled = true; mark.textContent = "Saving"; writeWindow();
      window.__deReport().then(function (r) {
        if (r.status === 200) done((r.body && r.body.file) || "reports/", r.body && r.body.presented, !!(r.body && r.body.already));
        else { mark.disabled = false; mark.textContent = "Mark as presented"; S.announce((r.body && r.body.message) || "Not saved."); }
        writeWindow();
      }, function () { mark.disabled = false; mark.textContent = "Mark as presented"; S.announce("Not saved: the dev server did not answer."); writeWindow(); });
    };
    mark.addEventListener("click", markNow);
  }
  deck.addEventListener("click", function (ev) {
    // a click on the slide moves on, as most decks do; links and buttons keep their own job
    if (ev.target.closest && (ev.target.closest("a, button, .deck-bar, .deck-notes"))) return;
    go(cur + 1);
  });
  return { show: show, hide: hide, key: key, count: n, current: function () { return cur; }, notes: function () { return { window: !!(notesWin && !notesWin.closed), inline: inline }; } };
}

api.presentCtl = presentCtl;
/** The presented snapshot of this very build, if there is one: the button then says so, even after a reload. */
function presentedReport(b) {
  var hash = b && b.engine && b.engine.hash;
  var xs = ((b && b.reports) || []).filter(function (r) { return r && r.presented && r.hash === hash; });
  return xs.length ? xs[xs.length - 1] : undefined;
}
api.presentedReport = presentedReport;
