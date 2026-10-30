// Focus and grouped blockers.
// Focus: a reader picks a team or a lead (a person: one lead string) and every page narrows to what they own or co-own,
// verify, decide or lead, plus the open units waiting on that work, each labelled with its relation. A lead's focus is
// what they lead directly plus what they inherit through a team they lead, marked inherited. The hash never carries it.
// Grouped blockers: a unit waits on capabilities, so what it waits on is one row per capability with its provider or
// providers; several providers are alternatives ("either one" for two, "any one of" for more); capabilities already met
// sit under a collapsed "Already met" line. The mirror list groups by the capability the unit provides.
// The fixture is a copy of the mini repair shop with a capability two units provide and one three units provide; the
// shipped instances' plans are left alone.
import { test, expect, describe } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle";
import { renderSite, waitsWhy, index } from "../src/site/render";
import { MINI } from "./core-helpers";
import { DS_DIR } from "./instance-dirs.ts";

const BUILT = { built: "2026-10-22T10:00:00.000Z" };
const DATA_OPEN = '<script type="application/json" id="de-bundle">';
const clientOf = (doc: string): any => { const i = doc.indexOf("</script>", doc.indexOf(DATA_OPEN)); const open = doc.indexOf("<script>", i); return new Function(doc.slice(open + 8, doc.indexOf("</script>", open)) + "\n;return DE;")(); };
const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ ([,;:])/g, "$1").trim();

/** The mini shop, with leads, a verifier, a decider, a co-owner, and capabilities with two and three providers. */
function shopWithAlternatives(): string {
  const d = mkdtempSync(join(tmpdir(), "plumb-focus-"));
  cpSync(MINI, d, { recursive: true });
  rmSync(join(d, "patches"), { recursive: true, force: true });
  const m = readFileSync(join(d, "model.yaml"), "utf8")
    .replace("{ id: counter, name: Front counter }", "{ id: counter, name: Front counter, lead: the counter lead }")
    .replace("{ id: shop, name: Workshop }", "{ id: shop, name: Workshop, lead: The Workshop Lead }")
    .replace("kind: queue, owner: shop, wip_limit: 5 }", "kind: queue, owner: shop, verifier: counter, wip_limit: 5 }")
    .replace("kind: person, owner: shop, wait_days: 2 }", "kind: person, owner: shop, decider: counter, wait_days: 2 }")
    .replace("kind: store, owner: counter, end: true }", "kind: store, owner: counter, owner_teams: [shop], end: true }");
  writeFileSync(join(d, "model.yaml"), m);
  const p = readFileSync(join(d, "plan.yaml"), "utf8")
    .replace("{ id: ph1, name: Open the counter,", "{ id: ph1, name: Open the counter, lead: the workshop lead,")
    + `  - id: u4
    title: Set up a second queue
    kind: agreement
    phase: ph2
    elements: [{ id: queue1, from: none, to: stand-in }]
    requires: [tickets]
    provides: [queue]
    check: The second queue takes bikes.
  - id: u5
    title: Time repairs by hand
    kind: measurement
    phase: ph2
    elements: [{ id: mechanic, from: none, to: stand-in }]
    requires: [queue]
    provides: [timing]
    check: A week of times is written down.
  - id: u6
    title: Time repairs with a tool
    kind: measurement
    phase: ph2
    requires: [queue]
    provides: [timing]
    check: The tool records a week of times.
    owner: shop
  - id: u7
    title: Publish repair times
    kind: code
    phase: ph2
    requires: [timing, tickets]
    check: Customers see the repair times.
    owner: counter
    lead: the workshop lead
`;
  writeFileSync(join(d, "plan.yaml"), p);
  return d;
}

const shop = (await buildBundle(shopWithAlternatives(), BUILT)).bundle;
const shopHtml = renderSite(shop);
const DE = clientOf(shopHtml);
const ix = DE.buildIndex(shop);

describe("the fixture", () => {
  test("queue has two providers, timing three, and tickets is met by a done unit", () => {
    const prov = (c: string) => shop.plan.units.filter((u) => u.provides?.includes(c)).map((u) => u.id).sort();
    expect(prov("queue")).toEqual(["u2", "u4"]);
    expect(prov("timing")).toEqual(["u3", "u5", "u6"]);
    expect(shop.plan.units.find((u) => u.id === "u1")!.status).toBe("done");
  });
});

describe("grouped blockers", () => {
  test("one group per required capability, with its providers and whether it is already met", () => {
    expect(DE.blockerGroups(ix, "u7").map((g: any) => [g.cap, g.providers, g.met])).toEqual([["timing", ["u3", "u5", "u6"], false], ["tickets", ["u1"], true]]);
    expect(DE.blockerGroups(ix, "u3").map((g: any) => [g.cap, g.open])).toEqual([["queue", ["u2", "u4"]]]);
  });
  test("two providers read as alternatives, either one", () => {
    const h = DE.blockersHtml(ix, "u3");
    expect((h.match(/class="blk-row"/g) ?? []).length).toBe(1);
    expect(strip(h)).toMatch(/^“queue” from either one: Set up the repair queue Ready or Set up a second queue Ready$/);
    expect(h).toContain('data-alternatives="2"');
  });
  test("three providers read as any one of; a met capability sits under a collapsed Already met line", () => {
    const h = DE.blockersHtml(ix, "u7");
    expect(strip(h)).toContain("“timing” from any one of Measure repair time Blocked, Time repairs by hand Blocked or Time repairs with a tool Blocked");
    expect(h).toMatch(/<details class="disc blk-met"><summary>Already met <span class="count">1<\/span><\/summary>[\s\S]*“tickets”[\s\S]*Write the ticket form/);
    expect(h.indexOf("“timing”")).toBeLessThan(h.indexOf("Already met"));
  });
  test("the hover card groups too, and gives the met ones as a count", () => {
    const more = DE.cardMore(ix, "unit", "u7");
    const w = more.find((f: any) => f.label === "Blocked by").html;
    expect(strip(w)).toContain("“timing” from any one of");
    expect(strip(w)).toContain("Already met: 1");
  });
  test("the drawer's Linked groups for a unit are grouped by capability both ways", () => {
    const d = DE.cardHtml(ix, "unit", "u3", "drawer");
    expect(d).toMatch(/data-link="depends-on"[\s\S]*?either one:/);
    const d2 = DE.cardHtml(ix, "unit", "u2", "drawer");
    expect(d2).toMatch(/data-link="unblocks"[\s\S]*?“queue”[\s\S]*?also provided by[\s\S]*?either one will do/);
  });
  test("the mirror list groups by the capability this unit provides; a done unit's lists everything that depended on it", () => {
    expect(DE.mirrorGroups(ix, "u2").map((g: any) => [g.cap, g.waiters, g.others])).toEqual([["queue", ["u3", "u5", "u6", "u10"], ["u4"]]]);
    expect(DE.mirrorGroups(ix, "u1").map((g: any) => [g.cap, g.waiters])).toEqual([["tickets", ["u2", "u4", "u7"]]]);
    const page = DE.unitDetail(ix, "u2");
    expect(page).toContain("Blocking");
    expect(strip(page)).toMatch(/“queue” also provided by “Set up a second queue”; either one will do/);
  });
  test("the unit page's Blocked by: one row per unmet capability, the met ones collapsed", () => {
    const page = DE.unitDetail(ix, "u7");
    const blocked = page.slice(page.indexOf("Blocked by"), page.indexOf("</section>", page.indexOf("Blocked by")));
    expect(blocked).toContain('<span class="count">1</span>');
    expect(blocked).toContain("any one of");
    expect(blocked).toContain("Already met");
  });
});

describe("focus on a team", () => {
  const ff = DE.focusFacts(ix, { kind: "team", id: "counter" });
  const rel = (id: string) => DE.focusUnitWords(ix, ff, id);
  test("each relation, per kind: owns, verifies, decides; open units waiting on their work", () => {
    expect(rel("u1")).toBe("owns");
    expect(rel("u7")).toBe("owns");
    expect(rel("u4")).toBe("verifies");
    expect(rel("u5")).toBe("decides");
    expect([...ff.waiting.keys()].sort()).toEqual(["u10", "u3", "u6"]);
    expect(rel("u3")).toBe("blocked by them");
    expect(rel("u2")).toBe("");
  });
  test("its parts: owned, verified, decided and co-owned", () => {
    expect(DE.focusRelWords(ix, ff.parts.get("queue1"))).toBe("verifies");
    expect(DE.focusRelWords(ix, ff.parts.get("mechanic"))).toBe("decides");
    const shopF = DE.focusFacts(ix, { kind: "team", id: "shop" });
    expect(DE.focusRelWords(ix, shopF.parts.get("pickup"))).toBe("co-owns");
  });
  test("milestones with their work, with their share of the open path to green", () => {
    expect([...ff.phases.keys()]).toEqual(["ph1", "ph2"]);
    for (const id of ff.phases.keys()) expect(DE.focusShareWords(ff, id)).toMatch(/^(None|\d+) of the \d+ steps? on its open path to green (is|are) theirs\.$|^Its path to green has no open steps\.$/);
  });
  test("on the delivery stream: Platform's units are owned, verified, decided or led by it; everything else waits on it", async () => {
    const ds = (await buildBundle(DS_DIR, BUILT)).bundle;
    const D2 = clientOf(renderSite(ds)), dx = D2.buildIndex(ds);
    const f = D2.focusFacts(dx, { kind: "team", id: "platform" });
    expect(f.units.size).toBeGreaterThan(0);
    for (const [id, rels] of f.units) {
      const r = D2.unitRolesOf(dx, id);
      const ok = (rels as any[]).every((x) => x.rel === "leads" || (x.rel === "verifies" ? r.verifiers.includes("platform") : x.rel === "decides" ? true : r.owners.includes("platform") || x.rel === "co-owns"));
      expect(ok).toBe(true);
    }
    for (const [id, on] of f.waiting) { expect(f.units.has(id)).toBe(false); expect((on as string[]).every((u) => f.units.has(u))).toBe(true); }
    // findings, patches and notes are those touching their parts or units
    for (const k of f.findings) { const fd = ds.findings.find((x) => `${x.pack}/${x.rule}@${x.at}` === k)!; expect(fd.atKind === "team" || f.parts.has(fd.at) || f.units.has(fd.at) || fd.atKind === "relationship").toBe(true); }
    expect(f.trackerUnits.size).toBe(f.units.size);
  });
});

describe("focus on a lead", () => {
  const ff = DE.focusFacts(ix, { kind: "lead", id: "the workshop lead" });
  test("a lead is one string, wherever it is named, case and spacing aside", () => {
    const leads = DE.focusOptions(ix).leads.map((l: any) => l.id);
    expect(leads).toEqual(["the counter lead", "the workshop lead"]);
    expect(DE.focusValid(ix, { kind: "lead", id: "the workshop lead" })).toBe(true);
    expect(DE.focusValid(ix, { kind: "lead", id: "nobody" })).toBe(false);
  });
  test("what they lead directly, and what they inherit through the team they lead, marked inherited", () => {
    expect(ff.teams).toEqual(["shop"]);
    expect(DE.focusUnitWords(ix, ff, "u7")).toBe("leads");
    expect(DE.focusUnitWords(ix, ff, "u2")).toBe("leads, owns, inherited from Workshop");
    expect(DE.focusUnitWords(ix, ff, "u6")).toBe("leads, owns, inherited from Workshop");
    expect(ff.phases.get("ph1").rels).toEqual([{ rel: "leads" }]);
    expect(DE.focusRelWords(ix, ff.parts.get("queue1"))).toBe("owns, inherited from Workshop");
    expect(DE.focusRelWords(ix, ff.parts.get("pickup"))).toBe("co-owns, inherited from Workshop");
    // a unit the counter owns, which they do not lead, is not theirs
    expect(ff.units.has("u1")).toBe(false);
  });
  test("a lead of no team keeps only what they lead directly", () => {
    const c = DE.focusFacts(ix, { kind: "lead", id: "the counter lead" });
    expect(c.teams).toEqual(["counter"]);
    expect(DE.focusUnitWords(ix, c, "u1")).toBe("leads, owns, inherited from Front counter");
  });
});

describe("the page", () => {
  test("the header has a Focus control; the hash never carries focus", () => {
    expect(shopHtml).toContain('id="focus-btn" aria-haspopup="true" aria-expanded="false" aria-pressed="false" hidden>');
    expect(DE.withState("#plan", { f: { owner: ["shop"] } })).toBe("#plan?owner=shop");
    const src = readFileSync(new URL("../src/site/client/focus.js", import.meta.url).pathname, "utf8");
    expect(src).not.toMatch(/withState\(|location\.hash\s*=/);
    expect(src).toMatch(/try \{ var saved = JSON\.parse\(store\.get\(key\)/);
  });
});
