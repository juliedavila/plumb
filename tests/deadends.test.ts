// No dead ends: every click on the Overview lands somewhere that answers it. A bar about a kind of record sets its
// chip AND goes to the page that lists that kind, at its list; tracker rows open their group; a milestone's "show its
// units" is a route Back can undo. The lists say what they show, and a blocked unit says what it waits on.
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { renderSite, messageDiffs, waitsWhy, index } from "../src/site/render";
import { buildBundle } from "../src/core/bundle";
import { buildDeck } from "../src/core/deck";
import type { Bundle, Finding } from "../src/types";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const ds = (await buildBundle(DS_DIR, { built: "2026-10-21T10:00:00.000Z" })).bundle;
const DATA_OPEN = '<script type="application/json" id="de-bundle">';
const clientOf = (doc: string): any => { const i = doc.indexOf("</script>", doc.indexOf(DATA_OPEN)); const open = doc.indexOf("<script>", i); return new Function(doc.slice(open + 8, doc.indexOf("</script>", open)) + "\n;return DE;")(); };
const dsHtml = renderSite(ds);
const DE = clientOf(dsHtml);
const unesc = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Every bar on one tile's work area: its href, the chip it sets (facet=value) or none. */
function bars(b: Bundle, key: string, f: Record<string, string[]> = {}) {
  const ix = DE.buildIndex(b);
  const S = { ix, st: { f, trail: null, sel: null }, _match: {}, trailEval: null, route: { page: "overview", sub: key }, overviewKind: ({ design: "finding", plan: "unit", system: "element", premises: "claim", changes: "patch", tracker: "unit", owners: "unit" } as any)[key] };
  (globalThis as any).location = { hash: "#overview/" + key };
  const html: string = DE.barsFor(S, key);
  delete (globalThis as any).location;
  return [...html.matchAll(/<a class="bar-row[^>]*>/g)].map((m) => { const href = /href="([^"]*)"/.exec(m[0])!, bar = /data-bar="([^"]*)"/.exec(m[0]); return { href: unesc(href[1]), bar: bar ? unesc(bar[1]) : null }; });
}

const WHERE: Record<string, { page: string; sub?: string; kind: string }> = {
  plan: { page: "plan", sub: "units", kind: "unit" },
  owners: { page: "plan", sub: "units", kind: "unit" },
  system: { page: "model", sub: "elements", kind: "element" },
  premises: { page: "strategy", kind: "claim" },
  changes: { page: "changes", kind: "patch" },
  design: { page: "checks", sub: "rule", kind: "finding" } };

describe("the Overview's bars land on the list of their kind, with the chip set", () => {
  for (const [name, b] of [["delivery-stream", ds]] as const) {
    for (const key of ["design", "plan", "owners", "system", "premises", "changes"]) {
      test(`${name}: ${key}`, () => {
        if (key === "owners" && !b.teams) return;
        const bs = bars(b, key).filter((x) => x.bar);
        if (key === "premises" && !b.model.claims?.length) return;
        if (key === "changes" && !b.patches.length) return;
        if (key === "design" && !b.findings.length) return;
        expect(bs.length).toBeGreaterThan(0);
        for (const x of bs) {
          const r = DE.parseRoute(x.href), st = DE.stateOf(r);
          expect(x.href.startsWith("#overview")).toBe(false); // never a chip that stays put
          expect(r.page).toBe(WHERE[key].page);
          if (WHERE[key].sub) expect(r.sub).toBe(WHERE[key].sub);
          const [facet, value] = x.bar!.split("=");
          expect(st.f[facet]).toEqual([decodeURIComponent(value)]);
          // the chip means something on the page it lands on: some record of that kind matches it
          const m = DE.matchingSet(DE.buildIndex(b), WHERE[key].kind, st.f, null);
          expect(m === null || m.size > 0).toBe(true);
        }
      });
    }
  }
  test("tracker rows open their own group on the Match step, and that group exists", () => {
    const rows = bars(ds, "tracker");
    expect(rows.length).toBeGreaterThan(0);
    for (const x of rows) {
      const r = DE.parseRoute(x.href);
      expect(r.page).toBe("tracker"); expect(r.sub).toBe("match"); expect(r.id).toBeTruthy();
      expect(dsHtml).toContain(`id="tracker-${r.id}"`);
    }
  });
  test("a followed set and a crumb land on the list too, not the top of its page", () => {
    expect(DE.kindHash("unit")).toBe("#plan/units");
    expect(DE.kindHash("element")).toBe("#model/elements");
    expect(DE.followHash({ kind: "element", f: {} }, "changed-by").startsWith("#plan/units?")).toBe(true);
  });
});

describe("the lists answer the click", () => {
  test("a counted heading reads cleanly over every bar's chip", () => {
    const { lint } = require("../src/site/prose");
    for (const b of [ds]) {
      const ix = DE.buildIndex(b);
      for (const key of ["plan", "owners", "system", "premises", "changes", "design"]) for (const x of bars(b, key).filter((y) => y.bar)) {
        const kind = WHERE[key].kind, f = DE.stateOf(DE.parseRoute(x.href)).f, m = DE.matchingSet(ix, kind, f, null);
        const t = DE.describeSet(ix, kind, DE.appliedFilters(ix, kind, f).applied, m ? m.size : 0);
        expect(lint(t, { sentence: false })).toEqual([]);
        expect(t).toMatch(/^\d[\d,]* /);
      }
    }
  });
});

describe("two small fixes", () => {
  test("Checks keeps a closing parenthesis when several messages share their last word", () => {
    const f = (at: string, message: string): Finding => ({ pack: "p", rule: "r", severity: "warning", at, atKind: "unit", message });
    const fs = [f("U-1", "U-1 waits on cap.a (owned by platform team)"), f("U-2", "U-2 waits on cap.b (owned by data team)")];
    const d = messageDiffs(fs, () => undefined);
    expect(d).toEqual(["waits on cap.a (owned by platform team)", "waits on cap.b (owned by data team)"]);
    for (const x of d) expect(x.split("(").length).toBe(x.split(")").length);
    // shared words outside the parentheses still drop
    expect(messageDiffs([f("a", "queue a (x) has no limit"), f("b", "queue b (y) has no limit")], () => undefined)).toEqual(["(x)", "(y)"]);
  });
  test("the deck's changes slide says what changed and why it matters; rule titles go to the speaker notes", () => {
    for (const b of [ds]) {
      const fs = b.findings.slice(0, 4);
      if (!fs.length) continue;
      const titles = new Map(b.instance.packs.flatMap((p) => p.rules.map((r) => [`${p.name}/${r.id}`, r.title] as const)));
      const rec = (x: Finding) => ({ kind: "finding", id: `${x.pack}/${x.rule}@${x.at}`, name: `${titles.get(`${x.pack}/${x.rule}`) ?? x.rule}: ${x.at}` });
      const since = { basis: "presented", against: { presented: "2026-10-01T10:00:00Z", saved: "2026-10-01T10:00:00Z", phases: [], findings: { errors: 0, warnings: 0, byRule: {} } },
        diff: { from: { label: "x" }, to: { label: "y" }, findings: { added: fs.map(rec), gone: fs.slice(0, 1).map(rec) }, units: { ready: [], done: [] }, added: [], removed: [], changed: [], notes: { added: [], answered: [], resolved: [] }, patches: { added: [], decided: [] }, claims: { regraded: [] }, counts: {} } };
      const s = buildDeck({ ...b, sinceReport: since } as any, { slides: [{ template: "changes" }] }).deck.slides[0];
      const onSlide = (s.items ?? []).map((i) => i.text).join(" \n ");
      expect(onSlide).toMatch(/(^|\n )New problems in [^:]+: (the design does not pass until they are fixed|none stops the design passing, but each is work to plan for)/);
      expect(onSlide).toMatch(/Problems fixed in .+, so less now stands in the way/);
      for (const t of titles.values()) expect(onSlide).not.toContain(t);
      for (const x of fs) { const t = titles.get(`${x.pack}/${x.rule}`)!; if (!/team-level proxy/.test(t)) expect(s.notes.join(" ")).toContain(t); } // separation of duties stays off the deck
    }
  });
});
