// Present mode: deck.yaml read and checked, slides computed from the bundle (counts before percentages, one "as of"
// line, decisions written by hand with candidates in the notes only), the static deck markup, the route, and the prose.
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle.ts";
import { buildDeck, candidateDecisions, loadDeckConfig, share } from "../src/core/deck.ts";
import { makeSnapshot, saveSnapshot } from "../src/core/snapshot.ts";
import { CLIENT_JS, renderSite } from "../src/site/render.ts";
import { lint } from "../src/site/prose.ts";
import { normTarget } from "../src/core/tour.ts";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = join(import.meta.dir, "..");
const DS = DS_DIR;
const DE = new Function(`${CLIENT_JS}; return DE;`)();
const copy = (src: string) => { const d = mkdtempSync(join(tmpdir(), "plumb-present-")); cpSync(src, d, { recursive: true }); rmSync(join(d, "reports"), { recursive: true, force: true }); return d; };
const ds = (await buildBundle(DS)).bundle;
const slide = (b: typeof ds, t: string) => b.deck!.slides.find((s) => s.template === t)!;

describe("deck.yaml", () => {
  test("a query that names something missing still renders, and the build warns", () => {
    const { deck, warnings } = buildDeck(ds, { slides: [
      { template: "thesis", claim: "PR-404" }, { template: "status", gates: ["SEE", "NOPE"] },
      { template: "decisions", items: [{ decision: "Do it", refs: ["U-999", "P-001", "flow/queue-has-wip-limit"] }, { why: "no text" }] },
      { template: "chart" },
    ] });
    expect(deck.slides.map((s) => s.template)).toEqual(["thesis", "status", "decisions"]);
    expect(warnings).toEqual([
      "deck.yaml slide 1 (thesis): claim PR-404 is not in the model",
      "deck.yaml slide 2 (status): milestone NOPE is not in the plan",
      "deck.yaml slide 3 (decisions): item 1 refers to U-999, which is not in the build",
      "deck.yaml slide 3 (decisions): item 2 has no decision text",
      'deck.yaml slide 4: template "chart" is not one of title, status, milestones, challenges, path, risks, changes, decisions, thesis; skipped',
    ]);
    expect(deck.slides[1].milestones!.map((m) => m.phase)).toEqual(["SEE"]);
  });
  test("the build prints those warnings; a broken deck.yaml is a warning too", async () => {
    const d = copy(DS);
    writeFileSync(join(d, "deck.yaml"), "slides:\n  - template: thesis\n    claim: GONE\n");
    expect((await buildBundle(d)).warnings).toContain("warning: deck.yaml slide 1 (thesis): claim GONE is not in the model");
    writeFileSync(join(d, "deck.yaml"), "slides: [\n");
    expect((await buildBundle(d)).warnings.some((w) => w.startsWith("warning: deck.yaml: YAML parse error"))).toBe(true);
    expect(loadDeckConfig(join(ROOT, "tests/fixtures/mini")).config).toBeUndefined();
  });
});

describe("slides", () => {
  test("what each milestone means: the value it delivers and what reaching it lets us do, for every milestone", () => {
    for (const b of [ds]) for (const m of slide(b, "milestones").milestones!) { expect(m.delivers!.length).toBeGreaterThan(20); expect(m.means!.length).toBeGreaterThan(20); }
  });
  test("challenges: three to five, as sentences an executive reads, red first", () => {
    const s = slide(ds, "challenges");
    expect(s.items!.map((i) => i.rag)).toEqual(["red", "amber", "amber"]);
    expect(s.items![0].text).toBe("“Export stage timestamps to flow metrics” was due 9 Oct 2026 and is not done, and “Put lead time on the team dashboard” and “Measure review time per pull request” wait on it. Platform owns it.");
  });
  test("path to green: every milestone that is not green has its steps, each naming its owner or that it needs one", () => {
    for (const b of [ds]) {
      const groups = b.deck!.slides.filter((x) => x.template === "path").flatMap((x) => x.groups ?? []);
      const non = b.status!.milestones.filter((m) => !m.reached && m.status !== "green").map((m) => b.plan.phases.find((p) => p.id === m.phase)!.name);
      expect(groups.map((g) => g.title)).toEqual(non);
      for (const g of groups) { expect(g.items.length).toBeGreaterThan(0); for (const it of g.items.filter((x) => !x.more)) expect(it.sub).toMatch(/^(Needs an owner|[A-Z])/); } // the "not the whole path" line names no owner
    }
    const see = slide(ds, "path").groups![0];
    expect(see.items[0]).toEqual({ text: "Finish “Export stage timestamps to flow metrics”, due 9 Oct 2026.", rag: "red", tone: "fail", sub: "Platform · unblocks “Put lead time on the team dashboard” and the work after it" });
    expect(see.items.some((i) => i.sub === "Needs an owner: the delivery lead names one")).toBe(true); // the milestone's accountable role
    // the overridden green milestone is not on the slide; its computed path is in the notes
    expect(slide(ds, "path").notes.join(" ")).toContain("“Shorten it” shows green by the delivery lead's override; computed amber");
  });
  test("decisions: only what deck.yaml says; the engine's candidates go in the notes, never on the slide", () => {
    const s = slide(ds, "decisions");
    expect(s.items!.map((i) => i.text)).toEqual([
      "Keep a sampled manual test before deploy until the suite's escaped-defect rate has been measured for a quarter",
      "Settle which team owns the work-in-progress limit on the sprint backlog",
      "Accept or reject folding release approval into the deploy gate",
    ]);
    const cands = candidateDecisions(ds);
    expect(cands.length).toBeGreaterThan(0);
    expect(s.notes).toContain("Candidates the engine sees, for you, not for the slide:");
    const empty = buildDeck(ds, { slides: [{ template: "decisions" }] }).deck.slides[0];
    expect(empty.items).toEqual([]);
    expect(empty.lead).toBe("No decisions are written for this deck yet: they go in deck.yaml, by hand.");
  });
  test("every computed sentence on every slide reads cleanly", () => {
    for (const b of [ds]) for (const s of b.deck!.slides) {
      const texts = [s.lead ?? "", ...(s.items ?? []).map((i) => i.text), ...(s.items ?? []).map((i) => i.sub ?? ""), ...s.notes, ...(s.rows ?? []).flatMap((r) => r.cells), ...(s.milestones ?? []).map((m) => m.reason), ...(s.groups ?? []).flatMap((g) => [g.lead ?? "", ...g.items.map((i) => i.text)])].filter(Boolean);
      for (const t of texts) expect(lint(t)).toEqual([]);
      if (s.lead) expect(lint(s.lead, { sentence: true, maxWords: 40 })).toEqual([]);
    }
  });
});

describe("read as an executive", () => {
  /** What the room sees on a slide: everything but the speaker notes and the hand-written decisions. */
  const onSlide = (s: any) => [s.title, s.subtitle, s.lead, ...(s.items ?? []).flatMap((i: any) => [i.text, i.sub]), ...(s.milestones ?? []).flatMap((m: any) => [m.name, m.delivers, m.means, m.reason, m.override]), ...(s.groups ?? []).flatMap((g: any) => [g.title, g.lead, ...g.items.flatMap((i: any) => [i.text, i.sub])])].filter(Boolean).join(" \n ");
  test("no record ids and no record counts on any computed slide", () => {
    for (const b of [ds]) for (const s of b.deck!.slides) {
      if (s.template === "decisions" || s.template === "title") continue;
      const t = onSlide(s);
      expect(t).not.toMatch(/\b(U|PR|CL|PH|N|P|AS)-[\w-]+\b/);
      expect(t).not.toMatch(/\b\d[\d,]* (units?|parts?|records?|findings?|relationships?|claims?|premises|warnings?|places?|issues?)\b/);
      for (const p of b.instance.packs) for (const r of p.rules) { expect(t).not.toContain(`${p.name}/${r.id}`); expect(t).not.toContain(r.id + " "); } // no rule names
    }
  });
  test("every colour carries a reason: each milestone on the road has its status word and a one-line reason", () => {
    for (const b of [ds]) for (const m of slide(b, "status").milestones!) { expect(["red", "amber", "green"]).toContain(m.status); expect(m.reason.length).toBeGreaterThan(5); }
    const html = renderSite(ds);
    expect(html).toContain('<span class="rag st rag-red"><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-rag-red"/></svg><span class="w">Red</span></span><span class="marker blocked">');
  });
});

describe("the page", () => {
  const html = renderSite(ds);
  test("the deck is static markup outside main, one article per slide, the first shown", () => {
    const sec = html.slice(html.indexOf('<section class="deck" id="present"'), html.indexOf('<div class="deck-notes"', html.indexOf('<section class="deck" id="present"')) + 60);
    expect(html.indexOf('id="present"')).toBeGreaterThan(html.indexOf("</main>"));
    expect(sec.match(/<article class="slide/g)!.length).toBe(8);
    expect(sec.match(/<article class="slide[^>]*hidden>/g)!.length).toBe(7);
    expect(sec).toContain('<span class="deck-count" id="deck-count" aria-live="polite">1 / 8</span>');
    expect(sec).toMatch(/As of: model built <time datetime="[^"]+">[^<]+<\/time> · Jira export: newest issue change <time datetime="[^"]+" data-age>/);
    expect(sec).toContain('<aside class="notes" hidden aria-label="Speaker notes">');
    expect(sec).toContain('id="deck-mark" hidden>Mark as presented</button>');
    expect(html).toContain('id="present-btn" href="#present"');
  });
  test("no deck.yaml, no deck and no Present button", async () => {
    const b = (await buildBundle(join(ROOT, "tests/fixtures/mini"))).bundle;
    const h = renderSite(b);
    expect(h).not.toContain('id="present"');
    expect(h).not.toContain('id="present-btn"');
  });
  test("routes: #present and #present/<n>; tour steps may target the deck and the Teams page", () => {
    expect(DE.parseRoute("#present")).toMatchObject({ page: "present", n: 1 });
    expect(DE.parseRoute("#present/4")).toMatchObject({ page: "present", n: 4 });
    expect(DE.parseRoute("#teams")).toMatchObject({ page: "teams" });
    expect(DE.tourHash({ present: 3 })).toBe("#present/3");
    expect(DE.tourHash("present")).toBe("#present");
    expect(normTarget({ present: "2" })).toEqual({ present: 2 });
    expect(normTarget("teams")).toBe("teams");
  });
});
