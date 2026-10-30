// The site: one self-contained document, answer-first pages, the inspectors, the diagrams, routes, the tour, and the
// escaping that keeps hostile strings inert. The sample fixture (hand-made, no core-only fields) checks the fallbacks;
// the two real instances check the computed facts the spec asks for.
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { renderSite, PAGES, messageDiffs, verdict, briefSentences, index } from "../src/site/render";
import { esc, inlineJson, inlineScript } from "../src/site/html";
import { buildBundle } from "../src/core/bundle";
import type { Bundle, Finding } from "../src/types";
import { makeBigBundle } from "./fixtures/big-bundle";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const sample: Bundle = await Bun.file(import.meta.dir + "/fixtures/sample-bundle.json").json();
const html = renderSite(sample);
const ds = (await buildBundle(DS_DIR, { built: "2026-10-21T10:00:00.000Z" })).bundle;
const dsHtml = renderSite(ds);

const DATA_OPEN = '<script type="application/json" id="de-bundle">';
const extractJson = (doc: string) => { const i = doc.indexOf(DATA_OPEN); return doc.slice(i + DATA_OPEN.length, doc.indexOf("</script>", i)); };
const extractClient = (doc: string) => { const i = doc.indexOf("</script>", doc.indexOf(DATA_OPEN)); const open = doc.indexOf("<script>", i); return doc.slice(open + 8, doc.indexOf("</script>", open)); };
const loadClient = (doc: string): any => new Function(extractClient(doc) + "\n;return DE;")(); // no document in bun: DE is defined, boot() is not run
const section = (doc: string, id: string) => { const i = doc.indexOf(`data-page="${id}"`); return doc.slice(i, doc.indexOf("</section>\n<section", i) > 0 ? doc.indexOf('<section class="page"', i + 10) : undefined); };

describe("document", () => {
  test("is one HTML document with a doctype and two scripts", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.match(/<html\b/g)?.length).toBe(1);
    expect(html.match(/<body\b/g)?.length).toBe(1);
    expect(html.match(/<script\b/g)?.length).toBe(2);
    expect(html).toContain(`<title>${sample.instance.title}</title>`);
    expect(html).toContain('name="viewport"');
  });
  test("pages and nav: one h1 each, tracker only with a tracker", () => {
    for (const p of PAGES) {
      expect(html).toContain(`id="${p.id}" data-page="${p.id}"`);
      expect(html).toContain(`href="#${p.id}" data-nav="${p.id}"`);
    }
    expect(html.match(/<h1\b/g)?.length).toBe(PAGES.length + 1); // and Notes, always
    expect(html).not.toContain('data-nav="strategy"');
    expect(dsHtml).toContain('data-nav="strategy"');
    expect(dsHtml).toContain('data-nav="notes"');
    expect(html).not.toContain('data-nav="tracker"');
    expect(dsHtml).toContain('data-nav="tracker"');
    expect(dsHtml.match(/<h1\b/g)?.length).toBe(PAGES.length + 4); // Tracker, Strategy, Teams, Notes
    expect(dsHtml).toContain('data-nav="teams"');
  });
  test("landmarks and the skip link", () => {
    expect(html.indexOf('class="skip" href="#main"')).toBeLessThan(html.indexOf("<header"));
    for (const t of ["<header", "<nav", '<main id="main"', "<aside"]) expect(html).toContain(t);
    expect(html).toContain('aria-live="polite"');
  });
  test("deep-link targets exist for units, elements, views, gates, patches, rules", () => {
    for (const u of sample.plan.units) expect(html).toContain(`id="unit-${u.id}"`);
    for (const e of sample.model.elements) expect(html).toContain(`id="element-${e.id}"`);
    for (const v of sample.model.views) expect(html).toContain(`id="view-${v.id}"`);
    for (const p of sample.plan.phases) expect(html).toContain(`id="phase-${p.id}"`);
    for (const p of sample.patches) expect(html).toContain(`id="patch-${p.id}"`);
    expect(html).toContain('id="rule-generic-element-owner"');
    expect(html).toContain('href="#plan/unit/u04"');
    expect(html).toContain('href="#model/element/registry"');
  });
  test("tokens with a dark scheme guarded two ways, reduced motion, forced colours", () => {
    expect(html).toContain('@media (prefers-color-scheme: dark) { :root:not([data-theme="light"])');
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).toContain("prefers-reduced-motion: reduce");
    expect(html).toContain("forced-colors: active");
    expect(html).toContain(":focus-visible");
    const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    const body = css.slice(css.indexOf("*, *::before"));
    expect(/#[0-9a-f]{3,8}\b/i.test(body)).toBe(false); // literal colours live only in the token blocks
    for (const t of ["--bg: #F7F7F5", "--accent: #2756C7", "--bg: #111214", "--accent: #86A8FF", "--z1: #4B9DCB", "--z6: #9D4A74"]) expect(css).toContain(t);
  });
});

describe("escaping", () => {
  test("esc covers the five characters", () => expect(esc(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"));
  test("inline JSON cannot end the script, and survives line separators", () => {
    const v = { a: "</script><!-- x", b: "line sep par" };
    const j = inlineJson(v);
    expect(j).not.toContain("<");
    expect(j).not.toContain(" ");
    expect(JSON.parse(j)).toEqual(v);
  });
  test("inline script text cannot close its element", () => {
    expect(inlineScript('x = "</script>"; y = "<!--"')).not.toMatch(/<\/script|<!--/i);
  });
  test("hostile strings in every field stay inert", () => {
    const evil = structuredClone(ds);
    evil.instance.description = "ends </script><script>alert(1)</script> <!-- here";
    evil.model.elements[0].name = '<img src=x onerror="alert(1)">';
    evil.plan.units[0].title = "</SCRIPT>";
    evil.patches[0].why = '"><svg onload=alert(1)>';
    evil.patches[0].title = "<b>bold</b>";
    evil.tour!.steps[0].say = "</script>";
    const doc = renderSite(evil);
    expect(doc.match(/<script\b/gi)?.length).toBe(2);
    expect(doc).not.toContain("<img");
    expect(doc).not.toContain("<svg onload");
    expect(doc).not.toContain("<b>bold</b>");
    expect(JSON.parse(extractJson(doc))).toEqual(JSON.parse(JSON.stringify(evil)));
    const DE = loadClient(doc);
    const ix = DE.buildIndex(evil);
    expect(DE.elementDetail(ix, evil.model.elements[0].id)).not.toContain("<img");
    expect(DE.unitDetail(ix, evil.plan.units[0].id)).not.toContain("</SCRIPT>");
  });
});

describe("overview", () => {
});

describe("plan", () => {
});

describe("checks", () => {
  test("message diffs keep only what differs per finding", () => {
    const f = (at: string, message: string): Finding => ({ pack: "p", rule: "r", severity: "warning", at, atKind: "element", message });
    const fs = [f("a", "element a (Alpha) has no owner team"), f("b", "element b (Beta) has no owner team")];
    expect(messageDiffs(fs, (x) => (x.at === "a" ? "Alpha" : "Beta"))).toEqual(["", ""]);
    const gs = [f("a", "queue a has no wip limit of 3"), f("b", "queue b has no wip limit of 5")];
    expect(messageDiffs(gs, () => undefined)).toEqual(["has no wip limit of 3", "has no wip limit of 5"]);
    expect(messageDiffs([fs[0]], () => "Alpha")).toEqual(["element a (Alpha) has no owner team"]);
  });
});

describe("changes", () => {
  const p = (b: Bundle, id: string) => b.patches.find((x) => x.id === id)!;
  test("a relationship a proposed patch adds is named and linked, never shown as missing", () => {
    const d = dsHtml.slice(dsHtml.indexOf('<article class="patch" id="patch-P-001"'), dsHtml.indexOf("</article>", dsHtml.indexOf('<article class="patch" id="patch-P-001"')));
    expect(d).toContain('Adds relationship <a href="#model/element/manual-test" data-element="manual-test">Manual regression test</a>');
    expect(d).toContain("Passing test report");
    expect(d).not.toContain("ref-missing");
    expect(d).not.toContain('title="Not in the model"');
  });
  test("provenance: Proposed by leads (an agent at someone's request, or a person), the model hash; and the fallback", () => {
    const art = (id: string) => dsHtml.slice(dsHtml.indexOf(`<article class="patch" id="patch-${id}"`), dsHtml.indexOf("</article>", dsHtml.indexOf(`<article class="patch" id="patch-${id}"`)));
    const d = art("P-001");
    expect(d).toContain("Agent-written");
    expect(d).toMatch(/<p class="proposer"><span class="pb-l">Proposed by<\/span> <span class="pb-who">an agent \(Claude Code\) at the request of <b>the delivery lead<\/b>/);
    // the proposer comes before the verdict
    expect(d.indexOf("Proposed by")).toBeLessThan(d.indexOf('class="verdict"'));
    expect(d).not.toContain("Written against an older model");
    const p2 = art("P-002");
    expect(p2).toMatch(/Proposed by<\/span> <span class="pb-who"><b>the product lead<\/b><\/span><span class="tag person">Written by a person<\/span>/);
    expect(p2).not.toContain("Agent-written");
    expect(html).toContain("Not recorded: give the patch a provenance");
  });
  test("field-level changes show list items removed and added", () => {
    const d = dsHtml.slice(dsHtml.indexOf('<article class="patch" id="patch-P-001"'), dsHtml.indexOf("</article>", dsHtml.indexOf('<article class="patch" id="patch-P-001"')));
    expect(d).toMatch(/<code>consumed_by<\/code>: <span class="sym rem"[^>]*>&#8722;<\/span><span class="sr-only">removed <\/span>release-approval <span class="sym add"/);
  });
  test("how to act names the file, and the page writes nothing", () => {
    expect(dsHtml).toContain("Accept by setting <code>status: accepted</code> in <code>patches/P-001-fold-release-approval.yaml</code>");
  });
});

describe("client", () => {
  const DE = loadClient(dsHtml);
  const ix = DE.buildIndex(ds);
  test("tour targets map to routes", () => {
    expect(DE.tourHash("overview")).toBe("#overview");
    expect(DE.tourHash({ view: "stream" })).toBe("#model/view/stream");
    expect(DE.tourHash({ focus: "x", depth: 2 })).toBe("#model/focus/x?depth=2");
    expect(DE.tourHash({ rule: "flow/path-handoff-limit" })).toBe("#checks/rule/flow/path-handoff-limit");
    expect(DE.tourHash({ finding: "flow/queue-has-wip-limit@roadmap-backlog" })).toBe("#checks/rule/flow/queue-has-wip-limit");
    expect(DE.tourHash({ tracker: "match" })).toBe("#tracker/match");
    expect(DE.tourHash({ gate: "SEE" })).toBe("#plan/milestone/SEE");
    expect(DE.tourHash({ milestone: "SEE" })).toBe("#plan/milestone/SEE");
  });
  test("unit detail: done-when, blocked by with the provider's own status, blocks, tracker", () => {
    const d = DE.unitDetail(ix, "U-07");
    expect(d.indexOf("Done when")).toBeLessThan(d.indexOf("Blocked by"));
    // one row per capability it waits on, named in words (its key only in a tooltip), then the unit that provides it by
    // titles appear in drawers without capability ids
    expect(d).toMatch(/<li class="blk-row" data-blk="cap\.[^"]+"><span class="blk-cap" title="cap\.[^"]+">“[a-z][^”<]+”<\/span> <span class="fg2">from<\/span> <a href="#plan\/unit\/U-0\d" data-unit="U-0\d" title="U-0\d">[A-Z][^<]+<\/a>/);
    expect(d.replace(/<details class="how">[\s\S]*?<\/details>/g, "")).not.toMatch(/>cap\.[a-z]/); // capability keys only inside How this is checked
    expect(d).toContain("Blocking");
    expect(d).not.toContain(">None<"); // empty sections are omitted
  });
  test("unit detail: a capability nobody provides says so", () => {
    const sIx = DE.buildIndex(sample);
    expect(DE.unitDetail(sIx, "u14")).toContain("No unit provides this");
    expect(DE.unitDetail(sIx, "nope")).toContain("No unit with id");
  });
  test("element detail: tags, relationships by kind, contracts, units, focus and views", () => {
    const d = DE.elementDetail(ix, "ci-pipeline");
    expect(d).toContain("Focus neighbourhood");
    expect(d).toContain("Show in views (3)");
    expect(d).toContain("Work that changes it");
    expect(d).toContain('href="#plan/unit/U-09"');
    expect(d).toContain("BuildArtifact");
    expect(DE.elementDetail(DE.buildIndex(sample), "registry")).toContain("No owner team");
  });
  test("the inspector with nothing selected describes the view", () => {
    const v = DE.viewIntro(ix, "stream");
    expect(v).toContain("Zones");
    expect(v).toContain("Parts by kind");
  });
  test("curated views draw every node, merge parallel edges, carry zone bands and edge styles", () => {
    for (const L of ds.layouts) {
      const D = DE.fromLayout(ix, L, {});
      const out = DE.renderDiagram(ix, D, { prefix: "t" });
      expect((out.svg.match(/class="node /g) ?? []).length).toBe(L.nodes.length);
      const pairs = new Set(L.edges.map((e: any) => e.from + ">" + e.to));
      expect((out.svg.match(/class="edge /g) ?? []).length).toBe(pairs.size);
      expect(out.svg).toContain('marker id="t-ah"');
      if (L.bands) expect((out.svg.match(/class="band"/g) ?? []).length).toBe(L.bands.length);
    }
    const s = DE.renderDiagram(ix, DE.fromLayout(ix, ds.layouts.find((l: any) => l.view === "stream"), {}), { prefix: "s" });
    expect(s.svg).toContain("ek-data");
    expect(s.legend).toContain("Data (solid)");
    expect(s.legend).not.toContain("Evidence (dotted)"); // the legend lists only what is drawn
  });
  test("lenses change the fill and the legend", () => {
    const L = ds.layouts.find((l: any) => l.view === "stream");
    const f = DE.renderDiagram(ix, DE.fromLayout(ix, L, {}), { prefix: "f", lens: "findings" });
    expect(f.svg).toContain("l-warn");
    expect(f.legend).toContain("Warning");
    const p = DE.renderDiagram(ix, DE.fromLayout(ix, L, {}), { prefix: "p", lens: "plan" });
    expect(p.legend).toMatch(/Done|Ready|Blocked/);
  });
  test("the summary diagram has one box per zone with counts", () => {
    const D = DE.summaryDiagram(ix);
    expect(D.nodes.length).toBe(ds.summary!.groups.length);
    expect(D.nodes[0].sub).toMatch(/\d+ parts?/);
  });
  test("ranked frontier agrees with the static lists: ready first, then the work already in progress", () => {
    const r = DE.rankedFrontier(ix).map((x: any) => x.id), doing = (id: string) => ds.plan.units.find((u) => u.id === id)!.status === "doing";
    expect([...r.filter((id: string) => !doing(id)), ...r.filter(doing)]).toEqual([...section(dsHtml, "plan").matchAll(/<li><a class="list-row" href="#plan\/unit\/([^"]+)"/g)].map((m) => m[1]));
  });
  test("search finds by id, name and issue key, grouped", () => {
    const e = DE.searchIndex(ix);
    expect(DE.searchRank(e, "U-07")[0].items[0].href).toBe("#plan/unit/U-07");
    expect(DE.searchRank(e, "ci pipe")[0].items[0].href).toBe("#model/element/ci-pipeline");
    expect(DE.searchRank(e, "NOTE-12").find((g: any) => g.group === "Tracker issues").items[0].href).toBe("#plan/unit/U-03");
    for (const g of DE.searchRank(e, "e")) expect(g.items.length).toBeLessThanOrEqual(8);
  });
  test("label wrapping fits the box", () => {
    expect(DE.wrapLabel("Public package registry", 22, 2)).toEqual(["Public package", "registry"]);
    const l = DE.wrapLabel("A very long element name that will not fit in two short lines", 12, 2);
    expect(l.length).toBe(2);
    expect(l[1].endsWith("…")).toBe(true);
  });
  test("survives a malformed bundle", () => {
    const bad = DE.buildIndex({ model: { elements: [null, { id: "x" }] }, layouts: [{ view: "v", nodes: [{ id: "x" }], edges: [{ id: "e", points: [[0, 0]] }] }] });
    expect(DE.unitDetail(bad, "u")).toContain("No unit");
    expect(DE.elementDetail(bad, "x")).toContain("Not drawn in any curated view");
    expect(DE.fromLayout(bad, bad.layout.get("v"), {}).nodes.length).toBe(1);
  });
});

describe("tour", () => {
  test("every page has a tour button: Learn the interface is generic, the story needs tour.yaml", () => {
    expect(dsHtml).toContain('id="tour-btn"');
    expect(html).toContain('id="tour-btn"');
  });
});

describe("empty bundle", () => {
  test("renders without throwing", () => {
    const empty: Bundle = {
      engine: { version: "0", built: "", hash: "" },
      instance: { name: "empty", title: "Empty", packs: [], ladder: [] },
      model: { teams: [], systems: [], zones: [], elements: [], relationships: [], contracts: [], views: [] },
      plan: { phases: [], units: [] },
      findings: [],
      analysis: { deps: {}, unblocks: {}, layers: [], frontier: [], blocked: {}, critical_path: [], phases: [], unprovided: [] },
      patches: [], layouts: [] };
    const doc = renderSite(empty);
    expect(doc).toContain("Passes");
    expect(doc).toContain("No patches.");
    expect(() => new Function(extractClient(doc))).not.toThrow();
  });
});

describe("scale", () => {
  const big = makeBigBundle();
  test("renders fast and stays within its size bound", () => {
    const t0 = performance.now();
    const doc = renderSite(big);
    const ms = performance.now() - t0;
    const markup = doc.length - extractJson(doc).length;
    // Markup is linear in records: rows per unit and element, a block per rule and patch, no SVG (views draw from the
    // JSON), on top of about 300 KB of fixed CSS and script (flow words in client/flow.js; the status-over-time strip, override flags and a
    // "Set a status by hand" disclosure per milestone; each milestone's open work by team, a row per open unit, and
    // about 20 KB more fixed client code; the glossary and the cards' context, about 6 KB; focus and grouped blockers, about 26 KB of
    // client code and styles, and each blocked row naming the capability it waits on; 0.3.1 added "Owner team"
    // on each unit and part row's narrow-screen label, about 3 KB; 0.4's namespaces, the digest's kinds for 0.4 designs
    // and outside parts on the drawing and their card, about 2 KB; 0.4's current state, the part page's Today block,
    // the today-only mark on the drawing and the card's Today line, about 6 KB; 0.4's portfolio: a focus shared with the
    // portfolio's pages, an outside part's link to its design's page and contracts named without their namespace, about 3 KB).
    const bound = 401_000 + 1700 * big.plan.units.length + 500 * (big.model.elements.length + big.model.relationships.length);
    console.log(`big bundle: ${(doc.length / 1024).toFixed(0)} KB, markup ${(markup / 1024).toFixed(0)} KB (bound ${(bound / 1024).toFixed(0)} KB), ${ms.toFixed(1)} ms`);
    expect(markup).toBeLessThan(bound);
    expect(doc.length).toBeLessThan(6 * 1024 * 1024);
    expect(ms).toBeLessThan(1500);
  });
  test("every view and every inspector draws quickly in the client", () => {
    const doc = renderSite(big);
    const DE = loadClient(doc);
    const t0 = performance.now();
    const ix = DE.buildIndex(big);
    let nodes = 0;
    for (const L of big.layouts) nodes += DE.renderDiagram(ix, DE.fromLayout(ix, L, {}), { prefix: "b" }).svg.match(/class="node /g)?.length ?? 0;
    for (const u of big.plan.units) DE.unitDetail(ix, u.id);
    for (const e of big.model.elements) { DE.elementDetail(ix, e.id); DE.focusDiagram(ix, e.id, 2, {}); }
    expect(nodes).toBe(50 * 18);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe("compared builds", () => {
});
