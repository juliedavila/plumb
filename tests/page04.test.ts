import { EX_DIR } from "./example-dirs.ts";
// The portfolio page, focus across designs, the mode labels, design pages built
// inside the portfolio, `de portfolio brief`, the dev loop and publish; namespace labels and root team counts.
// The example portfolio is built as of 16 Nov 2026, the date its README's expectations assume.
import { describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portfolioPages } from "../src/site/portfolio-build.ts";
import { PORTFOLIO_SECTIONS, renderPortfolio, clientData } from "../src/site/portfolio.ts";
import { portfolioFocusFacts, portfolioFocusOptions, designLabel, modeWords, designModeLine } from "../src/site/portfolio-facts.ts";
import { renderSite } from "../src/site/render.ts";
import { CSS, PORTFOLIO_CSS } from "../src/site/styles.ts";
import { buildBundle } from "../src/core/bundle.ts";
import { GLOSSARY_04 } from "../src/core/glossary.ts";
import { portfolioBriefMd } from "../src/core/portfolio-brief.ts";
import { startDev } from "../src/dev/server.ts";
import { publish } from "../src/dev/publish.ts";
import { leaks, surfaceText, visibleText as rawText } from "./reader-surfaces.ts";
/** The visible text with runs of space made one, so a glossary term's span never splits a phrase. */
const visibleText = (h: string) => rawText(h.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")).replace(/\s+/g, " ");
import { DS_DIR } from "./instance-dirs.ts";
import { MINI } from "./core-helpers.ts";

const DE = join(import.meta.dir, "..");
const EX = EX_DIR;
const BUILT = "2026-11-16T10:00:00.000Z";
const HAVE_EX = existsSync(join(EX, "portfolio/portfolio.yaml"));
const working = HAVE_EX ? await portfolioPages(join(EX, "portfolio"), { built: BUILT }) : (undefined as unknown as Awaited<ReturnType<typeof portfolioPages>>);
const presenting = HAVE_EX ? await portfolioPages(join(EX, "portfolio"), { built: BUILT, mode: "presenting" }) : working;
const page = HAVE_EX ? working.data.page! : (undefined as unknown as NonNullable<typeof working.data.page>);
/** A copy of the examples, so a build that writes its lock never touches the repository's. */
const copy = () => { const d = mkdtempSync(join(tmpdir(), "plumb-page04-")); cpSync(EX, d, { recursive: true }); rmSync(join(d, "portfolio/portfolio.lock"), { force: true }); return d; };
const loadClient = (html: string): any => { const i = html.lastIndexOf("<script>"); return new Function(html.slice(i + 8, html.indexOf("</script>", i)) + "\n;return typeof PF !== 'undefined' ? PF : DE;")(); };
const designPage = (p: typeof working, ns: string) => p.designs.find((d) => d.namespace === ns)!;

describe.skipIf(!HAVE_EX)("the page", () => {
  test("renders without a DOM, and the same portfolio.json renders the same page", () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
    expect(working.html.startsWith("<!doctype html>")).toBe(true);
    expect(renderPortfolio(working.data)).toBe(working.html);
    expect(working.html.match(/<h1\b/g)?.length).toBe(1);
    expect(working.html).toContain("<title>Findings to fixes</title>");
    expect(presenting.html).toContain("<title>Findings to fixes (presenting)</title>");
  });

  test("the opening sentence: each clause holds on the example, numbers said as words where they start a sentence", () => {
    expect(page.sentence).toBe("Three designs share six teams. Vulnerability management is the most contended: 4 open units on the paths to the next milestones, against an allowance of 2.7 after keeping the lights on and other streams. Two teams are over capacity. Two crossings are undeclared and security-relevant; an exception makes one of them a warning for now. One slowdown bet is running.");
    expect(working.html).toContain(`<p class="brief" id="pf-sentence">${page.sentence}</p>`);
  });

  test("every section is present on the example, each with its heading and a link in the nav", () => {
    for (const [id, label] of PORTFOLIO_SECTIONS) {
      expect(working.html).toContain(`id="${id}" aria-labelledby="h-${id}"`);
      expect(working.html).toContain(`<a href="#${id}" data-nav="${id}">${label}</a>`);
    }
    for (const h of ["Roadmap across designs", "Load by team", "The most contended team", "Slowdown bets", "Flow distribution", "Changes to the root", "Checks across the portfolio"])
      expect(visibleText(working.html)).toContain(h);
  });

  test("names, not ids, on its decision surfaces", () => {
    const ids = new Set<string>(), keys = new Set<string>();
    const g = working.run.graph!;
    for (const x of [...g.model.elements, ...g.model.relationships, ...g.plan.units, ...g.plan.phases]) { ids.add(x.id); const i = x.id.indexOf(":"); if (i > 0 && /[-.\d]/.test(x.id.slice(i + 1))) ids.add(x.id.slice(i + 1)); }
    for (const p of working.run.root.patches ?? []) ids.add(p.id);
    for (const a of working.run.root.org?.activities ?? []) { ids.add(a.id); ids.add(`org:${a.id}`); }
    for (const s of working.run.root.org?.slowdowns ?? []) ids.add(String(s.id));
    for (const t of working.run.root.org?.teams ?? []) { ids.add(t.id); ids.add(`org:${t.id}`); }
    for (const f of working.data.findings) keys.add(`${f.pack}/${f.rule}`);
    for (const u of g.plan.units) for (const c of [...(u.provides ?? []), ...(u.requires ?? [])]) keys.add(c);
    keys.add("stale_after_days");
    // an id with no digit, dot or hyphen reads as a word ("dedup"): the reader-surfaces scan leaves those, as for an instance
    for (const id of [...ids]) if (!/[-.\d:]/.test(id)) ids.delete(id);
    expect(leaks(surfaceText(working.html), { ids, keys })).toEqual([]);
    expect(leaks(surfaceText(presenting.html), { ids, keys })).toEqual([]);
  });
});

describe.skipIf(!HAVE_EX)("the mode: working copies or released editions with today's status", () => {
  test("the header, every design row and every design page built inside say which", () => {
    expect(modeWords("working", "2026-11-16").line).toBe("Working copy · each design as it stands now, accepted patches included · as of 16 Nov");
    expect(modeWords("presenting", "2026-11-16").line).toBe("Presenting released editions · each design's newest released edition, with today's status · status as of 16 Nov");
    expect(working.html).toContain(`<span class="tag pf-mode-tag">`);
    expect(presenting.html).toContain(`<span class="tag accent pf-mode-tag">`);
    expect(visibleText(working.html)).toContain("Working copy");
    expect(visibleText(presenting.html)).toContain("Presenting released editions");
    const label = (p: typeof working, ns: string) => p.data.page!.designs.find((d) => d.namespace === ns)!.label;
    expect(label(working, "premerge")).toBe("Pre-merge checks: working copy, no accepted patches since 1.0.0");
    expect(label(working, "intake")).toBe("Findings intake: working copy");
    expect(label(presenting, "premerge")).toBe("Pre-merge checks 1.0.0 (28 Oct)");
    expect(label(presenting, "intake")).toBe("Findings intake: no released edition; working copy shown");
    expect(designLabel({ title: "X", sinceRelease: { version: "1.0.0", accepted_patches: 2 } }, "working", "2026-11-02")).toBe("X: working copy, 2 accepted patches since 1.0.0");
    expect(designModeLine("presenting", "Findings intake 1.0.0 (30 Oct)", "2026-11-02")).toBe("Presenting released editions · Findings intake 1.0.0 (30 Oct) · status as of 2 Nov");
    for (const [p, head] of [[working, "Working copy"], [presenting, "Presenting released editions"]] as const) {
      for (const r of p.data.page!.roadmap.rows) expect(p.html).toContain(`<span class="rm-label">${r.label.replace(`${r.title}: `, "").replace(/^./, (c) => c.toUpperCase()).replace(new RegExp(`^${r.title} `), "Released ")}</span>`);
      for (const d of p.designs) {
        expect(d.html).toContain(`<div class="pf-ctx in-header${head === "Working copy" ? "" : " presenting"}"`);
        expect(d.html).toContain(`<html lang="en" class="in-pf">`);
        expect(d.html).toContain(`pf-mode-tag">${head}</span>`);
        expect(d.bundle.portfolio!.modeLine.startsWith(head)).toBe(true);
      }
    }
    expect(designPage(presenting, "premerge").html).toContain("Pre-merge checks 1.0.0 (28 Oct) · status as of 16 Nov");
    expect(designPage(presenting, "intake").html).toContain("Findings intake: no released edition; working copy shown · status as of 16 Nov");
  });

  test("presenting composes the released edition: intake's stale pin on premerge is gone", () => {
    expect(working.data.findings.some((f) => f.rule === "xref-pin-stale")).toBe(true);
    expect(presenting.data.findings.some((f) => f.rule === "xref-pin-stale")).toBe(false);
    expect(page.stalePins[0].text).toStartWith("Findings intake pins Pre-merge checks 1.0.0");
  });
});

describe.skipIf(!HAVE_EX)("the sections", () => {
  test("the roadmap: months to the horizon, milestones in their target month, capacity returns, waits across designs", () => {
    expect(page.roadmap.months[0]).toBe("2026-11");
    expect(page.roadmap.months).toHaveLength(12);
    const intake = page.roadmap.rows.find((r) => r.design === "intake")!;
    expect(intake.milestones.map((m) => [m.name, m.month, m.status])).toEqual([["Every scanner reports into intake", "2026-12", "green"], ["Findings flow into one queue", "2027-01", "green"], ["Proven classes stop repeats", "2027-04", "green"]]);
    const m2 = intake.milestones[1];
    // each relief against the share as written: triage 34% to 12% of 3 slots, scanner upkeep 17% to 8% of 5
    expect(m2.reliefs.map((r) => [r.teamName, r.slots])).toEqual([["Vulnerability management", 0.66], ["AppSec platform", 0.45]]);
    expect(visibleText(working.html)).toContain("Capacity returns: Vulnerability management +0.7 slots and AppSec platform +0.5 slots");
    expect(page.roadmap.rows.find((r) => r.design === "inventory")!.milestones[0].reached).toBe(true);
    expect(page.roadmap.rows.find((r) => r.design === "premerge")!.waits.map((w) => w.text)).toEqual([
      "Pre-merge checks' “Compile proven classes into checks” waits on Findings intake's “Publish proven classes to pre-merge checks”.",
      "Pre-merge checks' “Sign a stamp on every merge” waits on Findings intake's “Record signed merge stamps”.",
    ]);
    expect(working.html).toContain('data-hover="Findings flow into one queue, target 29 Jan 2027.\nDelivers: Findings routed to their owners');
  });

  test("load by team: the most contended first, the overrun past the limit, provenance under every number, the timeline", () => {
    const L = working.data.load!;
    expect(L.teams[0].name).toBe("Vulnerability management");
    const sec = working.html.slice(working.html.indexOf('id="load"'), working.html.indexOf('id="contended"'));
    expect(sec.indexOf('data-team="org:vuln-mgmt"')).toBeLessThan(sec.indexOf('data-team="org:governance-risk"'));
    expect(sec).toContain('class="lb-seg unit z1 over"');
    expect(visibleText(sec)).toContain("Over by 0.3 slots");
    expect(visibleText(sec)).toContain("Capacity: 3 slots · stated by the vulnerability management lead, 2 Nov, medium");
    expect(visibleText(sec)).toContain("Stated 25%, measured 38%: 13 points apart.");
    expect(visibleText(sec)).toContain("Not stated by the row's owner, the governance and risk lead");
    expect(visibleText(sec)).toContain("Unclassified 10%");
    expect(sec).toContain('class="tl-cols"');
    expect(visibleText(sec)).toContain("The slowdown of “Manual vulnerability triage and validation” from 15 Nov 2026 ends with Findings intake's “Findings flow into one queue” (target 29 Jan 2027), if on target");
  });

  test("the payoff beside the measure, and every unit that relieves a kind of manual work, with its premise's grade", () => {
    const audit = page.estimates.find((e) => e.record === "org:audit-evidence" && e.field === "share")!;
    expect(audit.payoff).toEqual({ landed: false, text: "Projected 10% after Asset inventory cleanup's “Know what we have” (reached 28 Oct 2026); measured 24%: the payoff has not landed." });
    const sec = visibleText(working.html.slice(working.html.indexOf('id="load"'), working.html.indexOf('id="contended"')));
    expect(sec).toContain("Projected 10% after Asset inventory cleanup's “Know what we have” (reached 28 Oct 2026); measured 24%: the payoff has not landed.");
    expect(sec).toContain("Manual work and the units that relieve it");
    expect(sec).toContain("Close repeat findings the checks prove fixed Pre-merge checks, reduces it, resting on a premise graded judgment Not linked");
    expect(sec).toContain("Manual retest after a fix No standing activity links it yet");
  });

  test("the root's notes and questions, read-only, each on its record by name", () => {
    expect(page.notes.map((n) => [n.kind, n.targetName])).toEqual([["question", "Manual vulnerability triage and validation"], ["note", "CheckYield"]]);
    expect(visibleText(working.html)).toContain("Question, open Manual vulnerability triage and validation: Does the measured triage share count");
  });

  test("the most contended team: the rule in one line, the units by title, design and milestone", () => {
    const sec = visibleText(working.html.slice(working.html.indexOf('id="contended"'), working.html.indexOf('id="seams"')));
    expect(sec).toContain("The most contended team is the one whose open units on the paths to every design's next milestone, divided by its allowance, is highest.");
    for (const t of ["Stand up the finding queue", "Move open findings from the old trackers", "Agree severity rules for the queue", "Give each team a view of its queue"]) expect(sec).toContain(t);
    expect(sec).toContain("Findings intake, toward “Every scanner reports into intake”");
  });

  test("seams: owner team, marks with what derives them, the exception in force, the undeclared crossings, worst first", () => {
    const s = (k: string) => page.seams.find((x) => x.key === k)!;
    expect(s("intake-premerge").ownerTeams.map((t) => t.name)).toEqual(["AppSec platform"]);
    expect(s("intake-premerge").crossings.map((c) => c.why)).toContain("Security-relevant: raised by the shared layer's authors: A fall in yield is how intake learns that teams are switching a check off, so losing this feed hides a control that has stopped working.");
    expect(s("intake-premerge").exceptions[0].text).toBe("The shipped exception flags CheckYield as a warning until Findings intake's “Findings flow into one queue” (target 29 Jan 2027). Accepted by the security risk owner.");
    expect(s("intake:autotriage").undeclared[0]).toMatchObject({ severity: "warning", relevant: true, excepted: "An exception accepted by the head of vulnerability management until 29 Jan 2027 makes it a warning." });
    const host = s("shared:code-host");
    expect(host.ownerTeams.map((t) => t.name)).toEqual(["Developer platform"]);
    expect(host.undeclared.map((c) => [c.severity, c.text])).toEqual([
      ["error", "Code hosting and CI (shared) sends “Repository settings and readme text” to Asset inventory cleanup's Repository crawler, and nothing declares it."],
      ["warning", "Pre-merge checks' Yield reporter sends “Weekly check badge per repository” to Code hosting and CI (shared), and nothing declares it."],
    ]);
  });

  test("the slowdown bet names its dates, capacity relief and risk on its card", () => {
    const sec = visibleText(working.html.slice(working.html.indexOf('id="slowdowns"'), working.html.indexOf('id="flow"')));
    expect(sec).toContain("We are slowing “Manual vulnerability triage and validation” from 15 Nov 2026 until Findings intake's “Findings flow into one queue” (target 29 Jan 2027)");
    expect(sec).toContain("That frees 0.72 of a slot for Vulnerability management");
    expect(sec).toContain("Running");
  });

  test("estimates: provenance, trend, measured, gap and pending proposal, by team", () => {
    const triage = page.estimates.find((e) => e.record === "org:vuln-triage" && e.field === "share")!;
    expect(triage.gap).toEqual({ over: true, text: "Stated 25%, measured 38%: 13 points apart." });
    expect(triage.pending[0].text).toBe("Proposed 38% by org-scout on 2 Nov · caution: Detection and response goes over capacity");
    expect(new Set(triage.trend.map((p) => p.kind))).toEqual(new Set(["value", "stated", "measured"]));
    const stale = page.estimates.find((e) => e.record === "org:dev-platform" && e.field === "capacity")!;
    expect(stale.stale).toBe(true);
    const sd = page.estimates.find((e) => e.field === "share_during")!;
    expect(sd.what).toBe("During the slowdown: Manual vulnerability triage and validation");
    expect(working.html.match(/<svg class="trend"/g)?.length).toBe(page.estimates.filter((e) => e.trend.length).length);
    expect(working.html).toContain('<select id="est-team">');
  });

  test("changes: the proposed refresh with its verdict on the portfolio, in names; then the accepted ones", () => {
    const p5 = page.patches[0];
    expect(p5).toMatchObject({ id: "P-005", status: "proposed", agent: true, by: "org-scout" });
    expect(p5.verdict!.level).toBe("caution");
    expect(p5.effect).toStartWith("Accepting it adds 1 finding (“No team carries more work in doing than its allowance” on Detection and response).");
    expect(p5.effect).toContain("Detection and response's allowance falls from 2.4 to 1.92");
    expect(page.patches.slice(1).every((p) => p.status === "accepted")).toBe(true);
  });

  test("checks: every finding once, failing rules first, laid out as an instance's Checks page", () => {
    const sec = working.html.slice(working.html.indexOf('id="checks"'));
    expect(sec).toContain('<span class="st fail">');
    expect(sec.match(/<details class="rule failing/g)?.length).toBe(new Set(working.data.findings.map((f) => `${f.pack}/${f.rule}`)).size);
    expect(sec.indexOf('data-rule="plan/retire-before-replace"')).toBeLessThan(sec.indexOf('data-rule="core/xref-pin-stale"'));
    expect(page.findings.find((f) => f.rule === "estimate-stale")!.text).toContain("older than the 90 days an estimate stays current");
  });
});

describe.skipIf(!HAVE_EX)("focus across designs", () => {
  const designs = HAVE_EX ? working.designs.map((d) => ({ ns: d.namespace, bundle: d.bundle })) : [];
  const orgTeams = HAVE_EX ? working.run.root.org!.teams : [];
  test("the options: every org team, and every lead across the org layer and every design, one person however it is written", () => {
    const o = portfolioFocusOptions(designs, orgTeams);
    expect(o.teams.map((t) => t.id)).toEqual(orgTeams.map((t) => `org:${t.id}`));
    expect(o.leads.filter((l) => l.id === "the vulnerability management lead")).toHaveLength(1); // "The vulnerability management lead" on intake's M2 is the same person
    expect(Object.keys(page.focus.facts)).toHaveLength(o.teams.length + o.leads.length);
  });

  test("a team: their units in every design with their relation, their milestones' shares, their team first", () => {
    const f = portfolioFocusFacts({ kind: "team", id: "org:vuln-mgmt", name: "Vulnerability management" }, designs, { orgTeams });
    expect(f.teams).toEqual(["org:vuln-mgmt"]);
    expect(f.units["intake:U-04"]).toBe("owns");
    expect(Object.keys(f.designs)).toEqual(["intake"]);
    expect(f.milestones["intake:M1"]).toBe("All 6 of its open units are theirs.");
    // the page holds the same facts, with the findings on their records
    expect({ ...page.focus.facts["team:org:vuln-mgmt"], findings: [] }).toEqual(f);
    expect(page.focus.facts["team:org:vuln-mgmt"].findings).toEqual(["portfolio/team-over-capacity@org:vuln-mgmt", "portfolio/seam-crossing-declared@intake:r08"]);
  });

  test("a lead: what they lead in any design, and what they inherit through the team they lead in the org layer", () => {
    const f = page.focus.facts["lead:the governance and risk lead"];
    expect(f.teams).toEqual(["org:governance-risk"]);
    expect(Object.keys(f.designs).sort()).toEqual(["intake", "inventory", "premerge"].filter((ns) => f.designs[ns]));
    expect(f.milestones["inventory:M2"]).toBeTruthy(); // they lead it
    expect(Object.values(f.units).some((w) => w.includes("inherited from Governance and risk"))).toBe(true);
  });

  test("a finding is theirs through its record: a crossing by its ends, an org record by its team", () => {
    expect(page.focus.facts["team:org:vuln-mgmt"].findings.some((k) => k.startsWith("portfolio/seam-crossing-declared@intake:r08"))).toBe(true);
    expect(page.focus.facts["team:org:dev-platform"].findings.some((k) => k.startsWith("portfolio/seam-crossing-declared@inventory:v01"))).toBe(true);
    expect(page.focus.facts["team:org:dev-platform"].findings.some((k) => k.startsWith("org/estimate-stale@org:dev-platform"))).toBe(true);
    expect(page.focus.facts["team:org:product-eng"].findings.some((k) => k.includes("@intake:r08"))).toBe(false);
  });

  test("the client applies the facts: pure verdicts on what each marked element is", () => {
    const PF = loadClient(working.html);
    const ff = page.focus.facts["team:org:vuln-mgmt"];
    expect(PF.focusOf(clientData(working.data), { kind: "team", id: "org:vuln-mgmt" })).toEqual(ff);
    expect(PF.focusOf(clientData(working.data), { kind: "team", id: "org:nobody" })).toBeNull();
    expect(PF.focusVerdict(ff, { ms: "intake:M1" })).toBe("in");
    expect(PF.focusVerdict(ff, { ms: "premerge:M1" })).toBe("out");
    expect(PF.focusVerdict(ff, { team: "org:vuln-mgmt" })).toBe("in");
    expect(PF.focusVerdict(ff, { design: "inventory" })).toBe("out");
    expect(PF.focusVerdict(ff, { unit: "intake:U-11" })).toBe("in"); // waits on their work
    expect(PF.focusVerdict(ff, { seam: "x", teams: "org:appsec-platform" })).toBe("out");
    expect(PF.focusVerdict(null, { ms: "intake:M1" })).toBeNull();
    expect(PF.focusNote(ff)).toBe("Focus: Vulnerability management. Theirs: 11 units in 1 design. Their work is marked in every section and the rest is dimmed.");
  });

  test("one key for the portfolio and its design pages, read and written in try and catch; a design page offers the portfolio's options", () => {
    expect(page.focus.key).toBe("de-focus:portfolio:example");
    for (const d of working.designs) expect(d.bundle.portfolio!.focusKey).toBe(page.focus.key);
    const src = readFileSync(join(DE, "src/site/client/portfolio.js"), "utf8");
    expect(src).toMatch(/try \{ var saved = JSON\.parse\(store\.get\(key\)/);
    expect(src).toMatch(/get: function \(k\) \{ try \{ return localStorage\.getItem\(k\); \} catch/);
    expect(src).toMatch(/set: function \(k, v\) \{ try \{ localStorage\.setItem\(k, v\); \} catch/);
    const focus = readFileSync(join(DE, "src/site/client/focus.js"), "utf8");
    expect(focus).toContain("var key = pf && pf.focusKey ? pf.focusKey :");
    const D = loadClient(designPage(working, "premerge").html);
    const ix = D.buildIndex(designPage(working, "premerge").bundle);
    // Vulnerability management owns nothing in pre-merge checks, and the focus set on the portfolio stays valid there
    expect(D.focusValid(ix, { kind: "team", id: "org:vuln-mgmt" })).toBe(true);
    expect(D.focusFacts(ix, { kind: "team", id: "org:vuln-mgmt" }).units.size).toBe(0);
    expect(D.focusTeamThere(ix, "platform")).toBe("premerge:platform");
    expect(D.focusTeamHere(ix, "premerge:platform")).toBe("platform");
    // the design's own page, outside the portfolio, offers its own teams only
    const own = { ...designPage(working, "premerge").bundle, portfolio: undefined };
    expect(D.focusOptions(D.buildIndex(own)).teams.length).toBe(ix.team.size);
    expect(D.focusValid(D.buildIndex(own), { kind: "team", id: "org:vuln-mgmt" })).toBe(false);
  });
});

describe.skipIf(!HAVE_EX)("links between the pages", () => {
  test("the portfolio links each design's page; each design page links back, to the others, and its outside parts to their home", () => {
    for (const ns of ["intake", "premerge", "inventory"]) expect(working.html).toContain(`href="${ns}/index.html"`);
    expect(working.html).toContain('href="intake/index.html#plan/milestone/M1"');
    const intake = designPage(working, "intake");
    expect(intake.html).toContain('<a class="pf-back" href="../index.html">');
    expect(intake.html).toContain('<a href="../premerge/index.html">Pre-merge checks</a>');
    const D = loadClient(intake.html);
    const ix = D.buildIndex(intake.bundle);
    expect(D.homePage(ix, ix.el.get("premerge:check-runner"))).toBe('<a href="../premerge/index.html#model/element/check-runner" data-raw>Pre-merge checks</a>');
    expect(D.homePage(ix, ix.el.get("shared:code-host"))).toBe(""); // the shared layer has no page of its own
  });
});

describe.skipIf(!HAVE_EX)("the offline files", () => {
  test("no network code, no repeating timer, no live-reload code; the client data round-trips", () => {
    for (const doc of [working.html, presenting.html, ...working.designs.map((d) => d.html)]) {
      expect(doc).not.toContain("de-live-reload");
      expect(doc).not.toContain("EventSource");
      expect(doc).not.toContain("setInterval");
      expect(doc).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
      expect(/https?:\/\//i.test(doc.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ""))).toBe(false);
    }
    const j = working.html.indexOf('<script type="application/json" id="de-portfolio">');
    const json = working.html.slice(working.html.indexOf(">", j) + 1, working.html.indexOf("</script>", j));
    expect(json).not.toContain("<");
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(clientData(working.data))));
    // every link of the portfolio page stays inside the build: a section, a design page, or the tab icon
    for (const m of working.html.matchAll(/href="([^"]*)"/g)) expect(/^(#|data:image\/svg\+xml,|(intake|premerge|inventory)\/index\.html)/.test(m[1])).toBe(true);
  });
});

describe.skipIf(!HAVE_EX)("the commands", () => {
  test("bun plumb.ts portfolio build writes the page, the design pages and portfolio.json with the page's facts; --today sets the date", () => {
    const d = copy(), out = mkdtempSync(join(tmpdir(), "plumb-page04-out-"));
    const r = Bun.spawnSync(["bun", join(DE, "plumb.ts"), "portfolio", "build", join(d, "portfolio"), "--out", out, "--today", "2026-11-16"], { stdout: "pipe", stderr: "pipe" });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.stdout.toString()).toContain("- the portfolio page:");
    for (const f of ["index.html", "portfolio.json", "intake/index.html", "premerge/index.html", "inventory/index.html", "intake/bundle.json"]) expect(existsSync(join(out, f))).toBe(true);
    const data = JSON.parse(readFileSync(join(out, "portfolio.json"), "utf8"));
    expect(data.page.today).toBe("2026-11-16");
    expect(data.page.sentence).toBe(page.sentence);
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain('id="de-portfolio"');
    const bad = Bun.spawnSync(["bun", join(DE, "plumb.ts"), "portfolio", "build", join(d, "portfolio"), "--today", "soon"], { stdout: "pipe", stderr: "pipe" });
    expect(bad.exitCode).toBe(2);
  });

  test("bun plumb.ts portfolio brief says what needs a person across the designs, and writes nothing", async () => {
    const d = copy();
    const md = await portfolioBriefMd(join(d, "portfolio"), { built: BUILT });
    for (const h of ["### Teams over capacity (2)", "### Undeclared crossings (3)", "### Stale pins (1)", "### Proposed root patches (1)", "### Stated and measured apart", "### Discovered current-state records waiting for a person to confirm (4)"]) expect(md).toContain(h);
    expect(md).toContain("`P-005`");
    expect(existsSync(join(d, "portfolio/portfolio.lock"))).toBe(false);
  });

  test("publish writes a portfolio's pages beside the instances and lists it first on the index", async () => {
    const d = copy(), out = mkdtempSync(join(tmpdir(), "plumb-page04-pub-"));
    const r = await publish(out, [MINI, join(d, "portfolio")]);
    expect(r.portfolios?.map((p) => p.name)).toEqual(["example"]);
    for (const f of ["portfolio-example/index.html", "portfolio-example/intake/index.html", "mini/index.html", "index.html"]) expect(existsSync(join(out, f))).toBe(true);
    const index = readFileSync(join(out, "index.html"), "utf8");
    expect(index).toContain('href="portfolio-example/"');
    expect(index.indexOf("Portfolios")).toBeLessThan(index.indexOf('href="mini/"'));
    expect(existsSync(join(d, "portfolio/portfolio.lock"))).toBe(false);
  });

  test("the dev loop serves the portfolio and its design pages, and rebuilds when the root changes; a rooted design's own loop watches its root", async () => {
    const d = copy(), out = mkdtempSync(join(tmpdir(), "plumb-page04-dev-"));
    const dev = await startDev(join(d, "portfolio"), { port: 0, outDir: out, debounceMs: 40 });
    try {
      expect(dev.watching).toContain(join(d, "shared"));
      const home = await (await fetch(dev.url)).text();
      expect(home).toContain('id="de-live-reload"');
      expect(home).toContain('PKEY = "/"');
      const intake = await (await fetch(dev.url + "intake/")).text();
      expect(intake).toContain('"notes":"/intake/__de/notes"');
      expect(intake).toContain('PKEY = "/intake/"');
      expect((await fetch(dev.url + "nope/")).status).toBe(404);
      const b0 = dev.builds();
      appendFileSync(join(d, "shared/org.yaml"), "\n# a change to the root\n");
      const t0 = Date.now();
      while (Date.now() - t0 < 5000 && dev.builds() === b0) await Bun.sleep(50);
      expect(dev.builds()).toBeGreaterThan(b0);
      expect(existsSync(join(d, "portfolio/portfolio.lock"))).toBe(false); // the dev loop never writes the lock
    } finally { dev.close(); }
    const one = await startDev(join(d, "designs/intake"), { port: 0, outDir: mkdtempSync(join(tmpdir(), "plumb-page04-dev1-")), debounceMs: 40 });
    try { expect(one.watching).toContain(join(d, "shared")); } finally { one.close(); }
  });

  test("the dev loop never rebuilds for its own output, and a page reloads only when what it shows changed", async () => {
    const d = copy();
    // --out inside a watched folder: the build's own writes must not start another build
    const dev = await startDev(join(d, "portfolio"), { port: 0, outDir: join(d, "portfolio/site"), debounceMs: 40, pollMs: 100 });
    const hello = async () => { const r = await fetch(dev.url + "__de/events"); const rd = r.body!.getReader(); const v = new TextDecoder().decode((await rd.read()).value); await rd.cancel(); return JSON.parse(v.slice(v.indexOf("data: ") + 6, v.indexOf("\n", v.indexOf("data: ")))).pages as Record<string, string>; };
    try {
      await Bun.sleep(1200);
      expect(dev.builds()).toBe(1);
      const before = await hello();
      appendFileSync(join(d, "designs/premerge/progress.yaml"), "\n# a comment changes no page\n");
      const t0 = Date.now();
      while (Date.now() - t0 < 5000 && dev.builds() === 1) await Bun.sleep(50);
      expect(dev.builds()).toBe(2);
      await Bun.sleep(600);
      expect(dev.builds()).toBe(2);
      const after = await hello();
      expect(after["/intake/"]).toBe(before["/intake/"]); // the build time changed; what the page shows did not
      expect(after["/"]).toBe(before["/"]);
    } finally { dev.close(); }
  });
});

describe.skipIf(!HAVE_EX)("the handoffs", () => {
  test("the Teams page counts the registry's teams that own this design's own parts, never a shared part's role", () => {
    const html = designPage(working, "intake").html;
    expect(visibleText(html)).toContain("The registry declares 3 teams; 3 of them own parts");
    expect(visibleText(html)).not.toContain("4 of them own parts");
  });

  test("contracts read by name on a design's page; a lone page's names never change", () => {
    const b = designPage(working, "intake").bundle;
    const D = loadClient(designPage(working, "intake").html);
    const ix = D.buildIndex(b);
    expect(D.plainRef(ix, "shared:ProvenClass")).toBe("ProvenClass");
    expect(D.plainRef(ix, "premerge:YieldBadge")).toBe("YieldBadge");
    expect(D.plainRef(ix, "elsewhere:X")).toBe("elsewhere:X");
    expect(D.plainRef(D.buildIndex({ ...b, instance: { ...b.instance, homes: undefined } }), "shared:ProvenClass")).toBe("shared:ProvenClass");
  });

  test("a lone page carries no portfolio bar and exactly the stylesheet it always did; a rooted design gets 0.4's glossary terms", async () => {
    const { bundle } = await buildBundle(DS_DIR, { built: BUILT });
    const html = renderSite(bundle);
    expect(html).not.toContain("pf-ctx");
    expect(html).toContain(`<style>${CSS}</style>`);
    expect(designPage(working, "intake").html).toContain(`<style>${CSS}${PORTFOLIO_CSS}</style>`);
    const terms04 = GLOSSARY_04.map(([t]) => t);
    expect(bundle.glossary!.some((t) => terms04.includes(t.term))).toBe(false);
    for (const t of terms04) expect(designPage(working, "intake").bundle.glossary!.some((g) => g.term === t)).toBe(true);
  });

  test("a rooted design's system tile counts its own parts and says how many sit outside it", () => {
    expect(visibleText(designPage(working, "premerge").html)).toMatch(/9 parts\s+in 3 zones · 4 outside it/);
  });
});
