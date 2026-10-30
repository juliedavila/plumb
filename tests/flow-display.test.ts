// Flow display. The stream drawn in reading order and fitted to width, wait and WIP badges
// with their source word, handoffs drawn apart and labelled with both teams, owner teams on boxes, the Flow lens, the
// stream's table in stream order, the flow panel (totals, handoffs ranked, measured beside declared), a patch's
// lead-time effect, Teams' "Handoffs in the stream" apart from "Waits in the improvement plan", the Overview's flow
// tile, and flow in the deck only where it explains a status. On premerge (no stream) none of it appears.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle.ts";
import { renderSite } from "../src/site/render.ts";
import { FLOWUI } from "../src/site/flow.ts";
import type { Bundle } from "../src/types.ts";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = join(import.meta.dir, "..");
const BUILT = "2026-10-22T12:00:00Z";
const ds = (await buildBundle(DS_DIR, { built: BUILT })).bundle;
const dsHtml = renderSite(ds);
function clientScript(doc: string) { const D = '<script type="application/json" id="de-bundle">'; const i = doc.indexOf("</script>", doc.indexOf(D)); const o = doc.indexOf("<script>", i); return doc.slice(o + 8, doc.indexOf("</script>", o)); }
const DE = new Function(clientScript(dsHtml) + "\n;return DE;")();
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const SOURCE = /(measured|estimated|declared|in the tracker|source not given)/;
/** Every "N days" or "N day" in a text has a source word within the next 60 characters, or the sentence it sits in names one. */
function unsourced(t: string): string[] {
  const out: string[] = [];
  for (const sent of t.split(/(?<=[.;])\s+|\s{2 }/)) {
    const re = /\b\d+(\.\d+)? days?\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sent))) if (!/target is[^.;]*$/.test(sent.slice(0, m.index)) && !SOURCE.test(sent.slice(m.index, m.index + 70)) && !SOURCE.test(sent)) out.push(sent.slice(Math.max(0, m.index - 30), m.index + 40));
  }
  return out;
}

describe("the stream drawn", () => {
  const L = ds.layouts.find((l) => l.view === "stream")!;
  test("the path in reading order, four steps to a row, fitted to a width the canvas can show at a readable scale", () => {
    expect(L.stream!.path).toEqual(ds.flow!.streams[0].path);
    expect(L.stream!.perRow).toBe(4);
    const at = new Map(L.nodes.map((n) => [n.id, n]));
    const path = L.stream!.path;
    for (let i = 1; i < path.length; i++) {
      const a = at.get(path[i - 1])!, b = at.get(path[i])!;
      if (i % 4) { expect(b.y).toBe(a.y); expect(b.x).toBeGreaterThan(a.x); } // same row, left to right
      else expect(b.y).toBeGreaterThan(a.y); // the next row starts below
    }
    expect(L.width).toBeLessThanOrEqual(800);
  });
  test("no line crosses a box: every segment stays out of every box's inside", () => {
    const hits: string[] = [];
    for (const e of L.edges) for (let i = 1; i < e.points.length; i++) {
      const [x1, y1] = e.points[i - 1], [x2, y2] = e.points[i];
      for (const n of L.nodes) {
        const l = n.x + 1.5, r = n.x + n.w - 1.5, t = n.y + 1.5, b = n.y + n.h - 1.5;
        const inX = Math.max(x1, x2) > l && Math.min(x1, x2) < r, inY = Math.max(y1, y2) > t && Math.min(y1, y2) < b;
        if (inX && inY) hits.push(`${e.id} through ${n.id}`);
      }
    }
    expect(hits).toEqual([]);
  });
  test("the other views keep their layered drawing", () => {
    expect(ds.layouts.find((l) => l.view === "release")!.stream).toBeUndefined();
  });
});

describe("badges, handoffs, teams and the Flow lens on the map", () => {
  test("badges say the number and its source; a queue with no limit says so", () => {
    expect(FLOWUI.badges(ds, "release-approval").map((b: { text: string }) => b.text)).toEqual(["wait 4 d · estimated", "tracker 4.8 d"]);
    expect(FLOWUI.badges(ds, "test-queue").map((b: { text: string }) => b.text)).toEqual(["now 0 of 6 · tracker", "WIP limit 6 · declared"]); // the tracker says how many wait in it now
    expect(FLOWUI.badges(ds, "roadmap-backlog").map((b: { text: string; cls: string }) => [b.text, b.cls])).toEqual([["no WIP limit", "fbadge none"]]);
    expect(FLOWUI.badges(ds, "support-desk")[0].text).toBe("wait 1 d · estimated, old");
    expect(FLOWUI.badges(ds, "release-approval")[1].title).toBe("The tracker measured 4.8 days, measured in the tracker (median of 4 changes).");
  });
  const ix = DE.buildIndex(ds);
  const D = DE.fromLayout(ix, ix.layout.get("stream"));
  const svg = DE.renderDiagram(ix, D, { prefix: "t" }).svg as string;
  test("handoff relationships drawn in their own style and labelled with both teams", () => {
    expect((svg.match(/class="edge ek-handoff/g) ?? []).length).toBe(7);
    expect(svg).toContain('<tspan x="');
    expect(text(svg)).toContain("Quality → Release");
    expect(text(svg)).toContain("Engineering → Platform");
  });
  test("each box shows its owner team, and its badges inside it", () => {
    expect(svg).toMatch(/<text class="nt"[^>]*>Release<\/text>/);
    expect((svg.match(/class="fbadge/g) ?? []).length).toBeGreaterThanOrEqual(14);
  });
  test("the Flow lens fills by the declared wait, with a legend that names the source", () => {
    const out = DE.renderDiagram(ix, D, { prefix: "t", lens: "flow" });
    expect(out.svg).toMatch(/data-id="product-triage"/);
    expect(out.svg).toMatch(/class="node k-person l-w4[^"]*" data-id="product-triage"/); // 5 days
    expect(out.svg).toMatch(/class="node k-person l-w2[^"]*" data-id="build-change"/);  // 1 day
    expect(out.legend).toContain("5 days or more");
    expect(out.legend).toContain("the badges say its source");
  });
  test("a part's inspector lists its flow numbers with source and date, and the tracker's beside them with the gap", () => {
    const h = text(DE.elementDetail(ix, "release-approval"));
    expect(h).toContain("Wait before it 4 days, estimated, as of 1 Oct");
    expect(h).toContain("Tracker wait 4.8 days, measured in the tracker (median of 4 changes), 0.8 days more than declared");
    expect(text(DE.elementDetail(ix, "roadmap-backlog"))).toContain("WIP limit none: nothing stops this queue growing");
  });
});

describe("the flow panel", () => {
  const panel = FLOWUI.panel(ds, "stream");
  const t = text(panel);
  test("totals: lead time, flow efficiency, handoffs against the limit with the hops named, the tracker's lead time beside the declared", () => {
    expect(t).toContain("A change takes about 30.5 days from Customers to Production: 21 days (15 estimated, 6 measured) waiting and 9.5 days (5 estimated, 4.5 measured) of work, so flow efficiency is 31%.");
    expect(t).toContain("It crosses 7 team handoffs, over the limit of 6: Product to Design, Design to Product, Product to Engineering, Engineering to Platform, Platform to Quality, Quality to Release, Release to Platform.");
    expect(t).toContain("The tracker measured a lead time of 17.3 days over the 4 steps its statuses cover, Build the change to Release approval (median of 4 changes, 14 Sep to 19 Oct), against 15 days declared for them: 2.3 days more than declared.");
  });
  test("handoffs ranked by the wait behind them, with why the work waits there", () => {
    const rows = [...panel.matchAll(/<tr data-hop="([^"]+)">/g)].map((m) => m[1]);
    expect(rows).toEqual(["h13", "h04", "h11", "h05", "h06", "h09", "h14"]);
    expect(t).toContain("Quality to Release Release approval 4.8 days measured in the tracker 4 days, estimated, as of 1 Oct The weekly release meeting reads the test report and approves the release.");
  });
  test("every number of days in the panel names its source", () => {
    expect(unsourced(t)).toEqual([]);
  });
  test("the steps the tracker does not cover are named", () => {
    expect(t).toContain("No tracker status stands for Product triage, Design exploration or Write the change request, so they keep their declared values only.");
  });
  test("an export without status history says so instead of a table", () => {
    const b = structuredClone(ds) as Bundle;
    b.flow!.measured = { ...b.flow!.measured!, available: false, reason: "The tracker export has no status history, so waits cannot be measured; export the issues with their changelog (Jira: expand=changelog).", steps: {} };
    delete b.flow!.streams[0].measured;
    const p = text(FLOWUI.panel(b, "stream"));
    expect(p).toContain("The tracker export has no status history");
    expect(p).not.toContain("Measured beside declared");
  });
  test("the stream's table version keeps stream order and carries the flow columns", () => {
    expect(dsHtml).toContain("flow-panel"); // the Overview's flow work area holds the same panel
  });
});

describe("a patch states its lead-time effect", () => {
  test("on the Changes page, the sentence with its source words, then before and after with the hops", () => {
    const sec = dsHtml.slice(dsHtml.indexOf('data-flow-effect="stream"'), dsHtml.indexOf("</section>", dsHtml.indexOf('data-flow-effect="stream"')));
    const t = text(sec);
    expect(t).toContain("Lead-time effect on “The stream, idea to production”");
    expect(t).toContain("Removes 4 days of estimated wait");
    expect(t).toContain("team handoffs 7 to 6, at the limit of 6");
    expect(t).toContain("New handoff: Quality to Platform");
    expect(t).toContain("Team handoffs (limit 6) 7 6, at the limit of 6");
    expect(t).toContain("new: Quality to Platform");
  });
});

describe("Teams: handoffs in the stream, apart from waits in the improvement plan", () => {
  const teams = dsHtml.slice(dsHtml.indexOf('id="teams"'), dsHtml.indexOf("</section>\n</section>", dsHtml.indexOf('id="h-sep"')));
  test("two sections, each titled so they are not confused, handoffs first", () => {
    const a = teams.indexOf(">Handoffs in the stream<"), b = teams.indexOf(">Waits in the improvement plan<");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(teams).not.toContain(">Who waits on whom<");
  });
  test("the handoff drawing is derived from handoff relationships between owner teams; an arrow lists its steps and the wait behind", () => {
    expect((teams.match(/<g class="wedge handoffs" data-wait="h\|/g) ?? []).length).toBe(7);
    const list = teams.slice(teams.indexOf('data-wait-list="h|quality|release"'), teams.indexOf("</div>", teams.indexOf('data-wait-list="h|quality|release"')));
    expect(text(list)).toContain("Manual regression test (Quality) hands “Test report” to Release approval (Release) Wait behind it: 4.8 days measured in the tracker, at Release approval");
  });
});

describe("the Overview and the deck", () => {
  test("a flow tile on the delivery stream: lead time, wait share, handoffs against the limit, with the source; its work area opens the stream map", () => {
    const tile = dsHtml.slice(dsHtml.indexOf('data-tile="flow"'), dsHtml.indexOf("</a>", dsHtml.indexOf('data-tile="flow"')));
    expect(text(tile)).toContain("How does work flow? 30.5 days lead time, measured and estimated · 69% waiting · 7 handoffs, limit 6");
    const panel = dsHtml.slice(dsHtml.indexOf('id="work-flow"'), dsHtml.indexOf('id="work-system"'));
    expect(panel).toContain('href="#model/view/stream">Open the stream map');
  });
  test("in the deck, flow appears where it explains a status: the milestone with a flow target, in plain words", () => {
    const st = ds.deck!.slides.find((s) => s.template === "status")!;
    const withFlow = st.milestones!.filter((m) => m.flow);
    expect(withFlow.map((m) => m.phase)).toEqual(["SHORTEN"]);
    expect(withFlow[0].flow).toBe("Today a change takes about 30.5 days and crosses 7 team handoffs (from measured and estimated values, as of 30 Sep); its target is 15 days and at most 5 handoffs.");
    for (const s of ds.deck!.slides) for (const t of [s.lead ?? "", ...(s.milestones ?? []).map((m) => m.flow ?? ""), ...(s.groups ?? []).map((g) => g.lead ?? "")]) expect(unsourced(t)).toEqual([]);
  });
});
