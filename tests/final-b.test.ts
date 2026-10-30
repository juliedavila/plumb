// Decision support: team workloads, tracker disagreements, patch effects, notes and change summaries.
import { test, expect, describe } from "bun:test";
import { buildBundle } from "../src/core/bundle";
import { renderSite, attentionRows, index, teamPlan } from "../src/site/render";
import type { Bundle } from "../src/types";
import { DS_DIR } from "./instance-dirs.ts";

const BUILT = "2026-10-21T10:00:00.000Z";
const ds = (await buildBundle(DS_DIR, { built: BUILT })).bundle;
const dsHtml = renderSite(ds);
const between = (s: string, a: string, b: string) => { const i = s.indexOf(a); return i < 0 ? "" : s.slice(i, s.indexOf(b, i + a.length) < 0 ? undefined : s.indexOf(b, i + a.length)); };

describe("needs attention: the path to green first, then questions, patches, rules", () => {
  const groups = (h: string) => [...h.matchAll(/data-att="([a-z]+)"/g)].map((m) => m[1]);
  test("delivery stream: the slipped export that makes the plan red leads, with its owner team and the stale-record note", () => {
    const h = attentionRows(index(ds)).html;
    const first = between(h, 'class="list-row att-step"', "</a>");
    expect(first).toContain("Finish “Export stage timestamps to flow metrics”, due 9 Oct 2026.");
    expect(first).toContain(">Platform<");
    expect(first).toContain("Jira says In Review; settle first");
    expect(first).toContain('data-unit="U-06"');
    // one row per piece of work: the export's amber steps do not repeat it
    expect(h.split("Export stage timestamps to flow metrics").length - 1).toBe(1);
  });
  test("open questions and proposed changes are rows with their verdict; rules come last, at most three", () => {
    const h = attentionRows(index(ds)).html;
    expect(between(h, 'data-att="questions"', 'data-att="patches"')).toContain("#notes/N-1");
    expect(between(h, 'data-att="patches"', 'data-att="rules"')).toContain("#changes/P-001");
    const rules = h.slice(h.indexOf('data-att="rules"'));
    expect((rules.match(/#checks\/rule\//g) ?? []).length).toBeLessThanOrEqual(3);
    expect(rules).toContain("more rules with findings, on Checks");
  });
});

describe("per-team milestone planning", () => {
  test("a milestone page shows each owner team's ready, in-progress and blocked work, the gating unit, and tracker states", () => {
    const h = teamPlan(index(ds), "SHORTEN");
    expect(h).toContain('data-team-plan="platform"');
    expect(h).toMatch(/“Agree the lead-time target”<\/a> holds up \d+ of the \d+ open units here directly \(Product, in “See the stream”\)/);
    expect(h).toMatch(/waits on <span class="blk-cap" title="cap\.[^"]+">“[^”]+”<\/span> from <a href="#plan\/unit\/U-\d+" data-unit="U-\d+">[^<]+<\/a> \([A-Z][a-z]+\)/);
    expect(h).toContain("Jira: ");
    const see = teamPlan(index(ds), "SEE");
    expect(see).toContain("Ready to start");
    expect(see).toContain("In progress");
    expect(see).toMatch(/1 unit in this milestone can start now\./);
    expect(see).toMatch(/Export stage timestamps to flow metrics<\/a> <span class="small fg2">due 9 Oct 2026, \d+ days overdue/);
  });
  test("the page carries it in every milestone panel; the tracker's chip that is not applied fades nothing", () => {
    expect(dsHtml).toContain('data-team-plans="SEE"');
    expect(dsHtml).toContain("fadeRefs(S, $(pg.name), pg.name)");
    expect(dsHtml).toContain("a chip the page says it does not apply fades nothing here either");
  });
});

const loadDE = (doc: string): any => { const i = doc.indexOf("</script>", doc.indexOf('id="de-bundle"')), o = doc.indexOf("<script>", i); return new Function(doc.slice(o + 8, doc.indexOf("</script>", o)) + "\n;return DE;")(); };
const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("premises", () => {
  const DE = loadDE(dsHtml);
  const scenario = structuredClone(ds);
  const claimId = "PR-2";
  const phase = scenario.premises![claimId].atStake[0];
  const milestone = scenario.status!.milestones.find(m=>m.phase === phase)!;
  milestone.computed = "red"; milestone.status = "red";
  const ix = DE.buildIndex(scenario);
  test("a red milestone is not blamed on an untested premise", () => {
    const t = strip(DE.claimDetail(ix, claimId, {}));
    expect(t).not.toMatch(/Red[^.]{0,40}partly because this is untested/);
    expect(t).toContain("red for other reasons; this alone would make it amber");
  });
});

describe("teams", () => {
  const page = dsHtml.slice(dsHtml.indexOf('data-page="teams"'), dsHtml.indexOf('<section class="page"', dsHtml.indexOf('data-page="teams"') + 10));
  test("the brief names a tie instead of picking one team", () => {
    const top = ds.teams!.load.filter((l) => l.open === ds.teams!.load[0].open);
    expect(top.length).toBeGreaterThan(1);
    expect(page).toMatch(/“Platform” and “Product” each own the most open work: 5 of 17 units/);
  });
  test("an Owner versus tracker section lists the units whose owner differs", () => {
    expect(page).toContain('id="h-owner-tracker">Owner: plan versus tracker');
    const d = ds.tracker!.reconcile!.ownerDisagreements!;
    expect(d.length).toBeGreaterThan(0);
    for (const x of d) expect(page).toContain(`data-unit="${x.unit}"`);
    expect(page).toContain("The plan: Engineering · Jira: Product");
  });
  test("stream handoff arrows carry the wait behind them, and the list is ranked by it", () => {
    const sec = page.slice(page.indexOf('id="handoffs"'), page.indexOf('id="owner-tracker"'));
    const labels = [...sec.matchAll(/<g class="wcount">[\s\S]*?<text[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]);
    expect(labels.some((l) => /\d days?$/.test(l))).toBe(true);
    const waits = [...sec.matchAll(/class="rv">([\d.]+) days? of wait behind/g)].map((m) => Number(m[1]));
    expect(waits.length).toBeGreaterThan(1);
    expect(waits).toEqual([...waits].sort((a, b) => b - a));
  });
});

describe("patches", () => {
  test("units affected are titled rows with owner team and milestone", () => {
    const p = dsHtml.slice(dsHtml.indexOf('data-patch="P-001"'));
    const sec = p.slice(p.indexOf("Work affected"), p.indexOf("</section>", p.indexOf("Work affected")));
    const u = ds.patches[0].impact.unitsAffected[0];
    expect(sec).toContain(`>${ds.plan.units.find((x) => x.id === u)!.title}</a>`);
    expect(sec).toMatch(/work-meta">[A-Z][^<]* · [^<]+</);
    expect(sec).not.toContain('class="id"');
  });
  test("P-001 counts the work it removes as well as the wait", () => {
    expect(ds.patches[0].impact.flow![0].text).toMatch(/^Removes 4 days of estimated wait and 0\.5 days of work \(lead time 30\.5 to 26 days/);
  });
  test("a value the patch sets itself is called its own estimate, apart from the structure", async () => {
    const { cpSync, mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const d = mkdtempSync(join(tmpdir(), "plumb-b6-"));
    cpSync(DS_DIR, d, { recursive: true });
    writeFileSync(join(d, "patches/P-009-shorter-review.yaml"), "id: P-009\ntitle: Shorten the review wait\nstatus: proposed\nwhy: Review starts within a day.\nops:\n  - { op: modify, kind: element, id: code-review, set: { attrs: { wait_days: 1, flow_source: estimated, flow_as_of: \"2026-10-20\" } } }\n");
    const b = (await buildBundle(d, { built: BUILT })).bundle;
    const fx = b.patches.find((p) => p.id === "P-009")!.impact.flow![0];
    expect(fx.own).toEqual([{ element: "code-review", key: "wait", before: expect.any(Number), after: 1 }]);
    expect(fx.text).toContain("This patch sets the wait at Code review from");
    expect(fx.text).toContain("itself: its own estimate, with no measurement behind it");
  });
});

describe("flow", () => {
  test("a queue's current WIP from the tracker sits beside its limit, on the box and in the table", async () => {
    const { FLOWUI } = await import("../src/site/flow.ts");
    expect(FLOWUI.badges(ds, "sprint-backlog").map((x: any) => x.text)).toEqual(["now 1 of 12 · tracker", "WIP limit 12 · declared"]);
    expect(FLOWUI.wipNowWords(ds, "sprint-backlog")).toBe("1 change waits in it now, measured in the tracker (before Build the change), within its limit of 12");
    expect(FLOWUI.badges(ds, "roadmap-backlog").map((x: any) => x.text)).toEqual(["no WIP limit"]); // no tracker status stands for its next step
    expect(dsHtml).toContain("var now = FLOWUI.wipNowWords(ix.b, id);");
  });
  test("every badge has a short form, and the drawing uses it when the long one would not fit; text is 12.5px", async () => {
    const { FLOWUI } = await import("../src/site/flow.ts");
    for (const e of ds.model.elements) for (const bd of FLOWUI.badges(ds, e.id)) expect(bd.short).toBeTruthy();
    expect(dsHtml).toContain('.dg [class*="fbadge"] text { font-size: 12.5px;');
  });
  test("a claim may name the flow metric that can regrade it; the engine says whether it holds and never regrades it", () => {
    const f = ds.premises!["PR-1"].flow!;
    expect(f).toMatchObject({ metric: "wait-share", source: "tracker", holds: true });
    expect(f.text).toMatch(/^The flow measure that can regrade it: \d+% of lead time is waiting, measured in the tracker over the 4 steps its statuses cover, against a bar of more than 50%\. The measure supports it: a person may regrade it to evidence\.$/);
    expect(ds.model.claims!.find((c) => c.id === "PR-1")!.grade).toBe("inference");
    expect(dsHtml).toMatch(/The tracker(&#39;|')s flow measure supports it/);
  });
});

describe("the Claude loop", () => {
  test("the element tool carries the tracker-measured values beside the declared ones", async () => {
    const { call } = await import("../src/mcp/tools.ts");
    const t = call(ds, "element", { id: "release-approval" }).text;
    expect(t).toMatch(/## Flow \(\d\)\n- Wait before it: 4 days, estimated/);
    expect(t).toContain("- Tracker wait: 4.8 days, measured in the tracker (median of 4 changes)");
  });
  test("a note's answer shows verbatim, with who answered and when; the question says who asked and when", () => {
    const DE = loadDE(dsHtml), ix = DE.buildIndex(ds);
    const n = { id: "N-9", target: { kind: "element", id: "code-review" }, kind: "question", text: "What is wait_days at code-review?", status: "answered", answer: "wait_days is 2 there (attrs.wait_days).", answered_by: "agent", author: "person", created: "2026-10-20T09:00:00Z", updated: "2026-10-21T16:40:00Z" };
    const h = strip(DE.noteCard(ix, n, {}));
    expect(h).toContain("wait_days is 2 there (attrs.wait_days).");
    expect(h).not.toContain("wait in days");
    expect(h).toMatch(/Asked by a person · /);
    expect(h).toMatch(/Answered by Claude · /);
  });
  test("the live toast links to the note that changed", () => {
    expect(dsHtml).toContain('<a id="toast-link" href="#notes" hidden></a>');
    expect(dsHtml).toContain('label: nn.length === 1 ? "Open the note" : "Open the first note"');
  });
});

describe("since panel and edition diff", () => {
  const { DIGEST } = require("../src/core/digest.ts");
  const clone = (b: Bundle): Bundle => JSON.parse(JSON.stringify(b));
  test("a gone finding is named by title from the old digest, never by its id", () => {
    const old = DIGEST.digest(ds);
    const now = clone(ds);
    const gone = now.findings.find((f) => f.atKind === "unit")!;
    now.findings = now.findings.filter((f) => f !== gone);
    now.plan.units = now.plan.units.filter((u) => u.id !== gone.at); // the record is gone too: only the old digest names it
    const d = DIGEST.compare(old, DIGEST.digest(now), DIGEST.names(now));
    const g = d.findings.gone.find((x: any) => x.id.endsWith("@" + gone.at));
    expect(g.name).toContain(ds.plan.units.find((u) => u.id === gone.at)!.title.slice(0, 30));
    expect(g.name).not.toMatch(new RegExp(`: ${gone.at}$`));
  });
  test("field-level changes: a due date, a milestone, an owner, in words", () => {
    const now = clone(ds);
    const u = now.plan.units.find((x) => x.id === "U-06")!;
    const was = u.due!;
    u.due = "2026-10-30";
    const d = DIGEST.compare(DIGEST.digest(ds), DIGEST.digest(now), DIGEST.names(now));
    expect(d.fields).toEqual([{ kind: "unit", id: "U-06", name: "Export stage timestamps to flow metrics", field: "due", from: was, to: "2026-10-30" }]);
    expect(DIGEST.fieldText(d.fields[0], DIGEST.names(now))).toBe("due 9 Oct to 30 Oct");
    const DE = loadDE(dsHtml);
    expect(DE.sinceList(d, DIGEST.names(now))).toContain("“Export stage timestamps to flow metrics”: due 9 Oct to 30 Oct");
    expect(strip(DE.sinceHtml(DE.buildIndex(now), d, ""))).toContain("Dates, milestones and owners");
  });
  test("new risks: a claim that became load-bearing and untested is its own section", async () => {
    const now = clone(ds), old = clone(ds);
    old.findings = old.findings.filter((f) => f.rule !== "load-bearing-untested");
    const { diffBundles, diffMd } = await import("../src/core/diff.ts");
    const d = diffBundles(old, now, { from: "bundle.json", to: "the instance now" });
    expect(d.risks!.map((r) => r.id)).toEqual(now.findings.filter((f) => f.rule === "load-bearing-untested").map((f) => f.at));
    const md = diffMd(d, "x", DIGEST.names(now));
    expect(md).toContain("## New risks: claims now load-bearing and untested (1)");
    expect(md).toContain("From **bundle.json, built 21 Oct 2026** to **the instance now, built 21 Oct 2026**.");
  });
  test("the Changes page's saved comparison names its sides with dates and shows status moves, fields and risks", async () => {
    const { comparisonsSection } = await import("../src/site/strategy.ts");
    const now = clone(ds), old = clone(ds);
    old.findings = old.findings.filter((f) => f.rule !== "load-bearing-untested");
    old.plan.units.find((x) => x.id === "U-06")!.due = "2026-10-30";
    old.status!.milestones[0].status = "amber";
    const { diffBundles } = await import("../src/core/diff.ts");
    now.comparisons = [diffBundles(old, now, { from: "edition 4.0.0 of 2026-09-01", to: "the instance now" })];
    const h = strip(comparisonsSection(now));
    expect(h).toContain("edition 4.0.0 of 2026-09-01 &#8594; the instance now, built 21 Oct 2026");
    expect(h).toContain("Status moves");
    expect(h).toContain("“See the stream” went amber to red");
    expect(h).toContain("New risks");
    expect(h).toContain("Export stage timestamps to flow metrics : due 30 Oct to 9 Oct");
  });
});

describe("deck polish", () => {
  const slide = (b: Bundle, t: string) => b.deck!.slides.find((s) => s.template === t)!;
  test("candidate decisions name open questions by their words", () => {
    const notes = slide(ds, "decisions").notes.join(" ");
    expect(notes).toContain("Answer 1 open question: “Has anyone compared what the automated suite catches");
    expect(notes).not.toMatch(/open questions?: N-\d/);
  });
  test("Mark as presented lives on the end screen after the last slide and in the notes window, never on the shared footer", () => {
    const h = dsHtml.slice(dsHtml.indexOf('<section class="deck"'));
    const bar = h.slice(h.indexOf('<div class="deck-bar">'), h.indexOf("</div>", h.indexOf('<div class="deck-bar">')));
    expect(bar).not.toContain("deck-mark");
    expect(h).toMatch(/<div class="deck-end" id="deck-end" hidden><h2 tabindex="-1">End of the deck<\/h2>[\s\S]*id="deck-mark" hidden>Mark as presented<\/button><\/div>/);
    expect(dsHtml).toContain('mb.id = "de-mark"');
  });
  test("after a reload the dev server says which presented snapshot holds this build", () => {
    expect(dsHtml).toContain("if (!prior && S.dev.presented)");
  });
});

describe("drill-downs", () => {
  test("a zone or depth-2 neighbourhood opens framed on its parts at no less than 0.7, centred on the busiest part", () => {
    const DE = loadDE(dsHtml);
    const cam = new DE.Camera({ clientWidth: 660, clientHeight: 560 }, { querySelector: () => null, classList: { contains: () => true, remove() {}, add() {} } }, 5400, 1600);
    const nodes = [{ x: 0, y: 0, w: 120, h: 40 }, { x: 5200, y: 1500, w: 120, h: 40 }, { x: 2600, y: 700, w: 120, h: 40 }];
    cam.frame(nodes, nodes[2], 0.7);
    expect(cam.k).toBe(0.7);
    // the hub sits in the middle of the canvas
    expect(Math.round(cam.tx + (2600 + 60) * cam.k)).toBe(330);
    const small = new DE.Camera({ clientWidth: 660, clientHeight: 560 }, { querySelector: () => null, classList: { contains: () => true, remove() {}, add() {} } }, 400, 200);
    small.frame([{ x: 0, y: 0, w: 120, h: 40 }, { x: 280, y: 160, w: 120, h: 40 }], null, 0.7);
    expect(small.k).toBe(1.25);
  });
  test("the header Follow names its set and is left out when a record is open", () => {
    expect(dsHtml).toContain('(m ? "Follow these " : "Follow all ")');
    expect(dsHtml).toContain("var recOpen = !!(S.route && S.route.id && S.route.page !== \"tracker\");");
  });
});

describe("leaks and cosmetics", () => {
  test("rule explanations are plain words; config keys and files live in How this is checked", () => {
    for (const b of [ds]) for (const p of b.instance.packs) for (const r of p.rules) expect(r.why).not.toMatch(/attrs\.|\.yaml|\b[a-z]+_[a-z_]+\b|`/);
    const flow = ds.instance.packs.find((p) => p.name === "flow")!.rules.find((r) => r.id === "path-handoff-limit")!;
    expect(flow.how).toContain("flow.max_handoffs");
    expect(dsHtml).toContain('How this is checked</summary><p class="small fg2">Rule <code>flow/path-handoff-limit</code> in the flow pack, severity warning. The limit is engine.yaml flow.max_handoffs (default 4)');
  });
  test("the revise line is one clause for every unmet precondition", () => {
    expect(ds.patches[0].impact.verdict!.revise).toContain("so that it waits until ‘Automate the release checklist’ and ‘Gate deploys on the automated suite’ are done, or no longer depends on them;");
  });
  test("a deep link to a milestone lands below the sticky bars", () => {
    expect(dsHtml).toContain("[id], [data-gate-panel], [data-team-plans], .rule { scroll-margin-top:");
  });
});

describe("skill: what the draft-a-patch workflow says about attrs is what the engine does", () => {
  test("modify with set: { attrs } merges one level: the other attrs stay", async () => {
    const { cpSync, mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const d = mkdtempSync(join(tmpdir(), "plumb-attrs-"));
    cpSync(DS_DIR, d, { recursive: true });
    writeFileSync(join(d, "patches/P-003-lower-limit.yaml"), "id: P-003\ntitle: Lower the sprint backlog limit\nstatus: accepted\ndecision: { by: the delivery lead, at: \"2026-10-21\" }\nwhy: A smaller sprint backlog.\nops:\n  - { op: modify, kind: element, id: sprint-backlog, set: { attrs: { wip_limit: 8 } } }\n");
    const b = (await buildBundle(d, { built: BUILT })).bundle;
    const e = b.model.elements.find((x) => x.id === "sprint-backlog")!;
    expect(e.attrs).toMatchObject({ wip_limit: 8, flow_source: "declared", flow_as_of: "2026-10-06" });
    expect(b.findings.some((f) => f.rule === "flow-values" && f.at === "sprint-backlog")).toBe(false);
  });
});
