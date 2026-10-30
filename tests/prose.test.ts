// Every computed sentence, checked for broken constructions: the prose helpers on their
// own, then every sentence the site computes for both instances and the sample, then the same sentences over synthetic
// data shapes (zero, one, many; long names; names that start with a capital or carry punctuation), then every visible
// text node of the rendered pages. lint() flags ", The", doubled spaces and punctuation, "1 units" and "3 unit",
// leaked undefined or NaN, and, for sentences, a lowercase or numeral start, a missing end mark and over 32 words.
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { renderSite, briefSentences, planBrief, designSentence, verdict, changeCaption, index, gateProgress } from "../src/site/render";
import { count, list, quote, sentence, para, lint, fmt, pluralOf } from "../src/site/prose";
import { buildBundle } from "../src/core/bundle";
import type { Bundle } from "../src/types";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const sample: Bundle = await Bun.file(import.meta.dir + "/fixtures/sample-bundle.json").json();
const ds = (await buildBundle(DS_DIR, { built: "2026-10-21T10:00:00.000Z" })).bundle;
const clone = (b: Bundle): Bundle => JSON.parse(JSON.stringify(b));

const DATA_OPEN = '<script type="application/json" id="de-bundle">';
const clientOf = (doc: string): any => { const i = doc.indexOf("</script>", doc.indexOf(DATA_OPEN)); const open = doc.indexOf("<script>", i); return new Function(doc.slice(open + 8, doc.indexOf("</script>", open)) + "\n;return DE;")(); };

/** Sentences must pass the sentence rules; tokens and labels only the basic ones. */
const clean = (texts: string[], sentenceMode = true) => {
  const bad = texts.flatMap((t) => lint(t, { sentence: sentenceMode }).map((p) => `${p}  <<${t}>>`));
  expect(bad).toEqual([]);
};

/** Every sentence the site computes from a bundle, server side and client side. */
function computed(b: Bundle): { sentences: string[]; tokens: string[] } {
  const ix = index(b);
  const split = (x: string) => x.split(/(?<=[.!?”])\s+(?=[A-Z“])/);
  const sentences = [...briefSentences(ix), ...split(planBrief(ix)), designSentence(ix)];
  const tokens: string[] = [];
  for (const p of b.patches) {
    const v = verdict(p);
    tokens.push(v.lead, v.short, ...v.tokens.map((t) => t.text));
    const c = changeCaption(ix, p);
    if (c) sentences.push(...c.split(/(?<=[.!?])\s+(?=[A-Z])/));
  }
  const DE = clientOf(renderSite(b));
  const cix = DE.buildIndex(b);
  for (const e of b.model.elements.slice(0, 60)) for (const depth of [1, 2]) {
    const D = DE.focusDiagram(cix, e.id, depth, {});
    if (D) sentences.push(...DE.focusScope(cix, D).split(/(?<=[.!?])\s+(?=[A-Z])/));
  }
  return { sentences: sentences.filter(Boolean), tokens };
}

describe("prose helpers", () => {
  test("count agrees the noun with the number, groups thousands and says no for zero on request", () => {
    expect(count(1, "unit")).toBe("1 unit");
    expect(count(0, "unit")).toBe("0 units");
    expect(count(0, "unit", { zero: "no" })).toBe("no units");
    expect(count(12345, "part")).toBe("12,345 parts");
    expect(count(2, "patch")).toBe("2 patches");
    expect(count(3, "capability")).toBe("3 capabilities");
    expect(count(2, "error check")).toBe("2 error checks");
    expect(count(2, "day")).toBe("2 days");
    expect(count(2, "person")).toBe("2 people");
    expect(fmt(999)).toBe("999");
    expect(fmt(1000)).toBe("1,000");
    expect(pluralOf("knock-on change")).toBe("knock-on changes");
  });
  test("list joins with commas and and, caps with and N more", () => {
    expect(list([])).toBe("");
    expect(list(["a"])).toBe("a");
    expect(list(["a", "b"])).toBe("a and b");
    expect(list(["a", "b", "c"])).toBe("a, b and c");
    expect(list(["a", "", "b"])).toBe("a and b");
    expect(list(["a", "b", "c", "d", "e"], { max: 2 })).toBe("a, b and 3 more");
    expect(list(["a", "b"], "or")).toBe("a or b");
  });
  test("quote sets a title off and drops its trailing punctuation", () => {
    expect(quote("The loop closes once")).toBe("“The loop closes once”");
    expect(quote("  Ship it.  ")).toBe("“Ship it”");
    expect(quote("Measure; then decide;")).toBe("“Measure; then decide”");
    expect(quote('Every "owner" has a team')).toBe("“Every ‘owner’ has a team”");
    expect(quote("")).toBe("");
    expect(quote(undefined as unknown as string)).toBe("");
  });
  test("sentence capitalises, single-spaces and ends exactly once", () => {
    expect(sentence("  the plan  has 3 units ")).toBe("The plan has 3 units.");
    expect(sentence("It ends here.")).toBe("It ends here.");
    expect(sentence("Done , and dusted ;")).toBe("Done, and dusted.");
    expect(sentence("It is “Why now?”")).toBe("It is “Why now?”");
    expect(para(["one", "", undefined as unknown as string, "two."])).toBe("One. Two.");
  });
  test("lint catches each broken construction it names", () => {
    const has = (t: string, what: RegExp, s = false) => expect(lint(t, { sentence: s }).some((p) => what.test(p))).toBe(true);
    has("gate 1, The loop closes once, is done", /bare title/);
    has("two  spaces", /doubled space/);
    has("stacked,, commas", /stacked/);
    has("ends twice..", /full stop/);
    has("space before , comma", /space before/);
    has("1 units are done", /plural noun after one/);
    has("3 unit is done", /singular noun after/);
    has("has undefined parts", /leaked/);
    has("“”", /empty quotes/);
    has("lowercase start.", /starts lowercase/, true);
    has("11 units start a sentence.", /starts with a digit/, true);
    has("No end mark", /closing punctuation/, true);
    expect(lint("Gate 1, “The loop closes once”, has 5 of its 26 units done.", { sentence: true })).toEqual([]);
    expect(lint("1 of 5 rules reports findings; 2,000 parts")).toEqual([]);
  });
});

describe("gate progress", () => {
  test("reads at zero, one, part and all", () => {
    expect(gateProgress(0, 0)).toBe("has no units");
    expect(gateProgress(0, 1)).toBe("has 1 unit, not done yet");
    expect(gateProgress(1, 1)).toBe("has its one unit done");
    expect(gateProgress(0, 26)).toBe("has 26 units, none done yet");
    expect(gateProgress(5, 26)).toBe("has 5 of its 26 units done");
    expect(gateProgress(26, 26)).toBe("has all 26 of its units done");
  });
});

describe("every computed sentence in both instances and the sample", () => {
  for (const [name, b] of [["delivery-stream", ds], ["sample", sample]] as const) {
    test(`${name}: sentences read as sentences, tokens have no broken constructions`, () => {
      const c = computed(b);
      expect(c.sentences.length).toBeGreaterThan(5);
      clean(c.sentences);
      clean(c.tokens, false);
    });
  }
  test("P-001's caption names the relationships it adds as well as the ones it removes", () => {
    expect(changeCaption(index(ds), ds.patches.find((p) => p.id === "P-001")!)).toBe("It shows Release approval (removed) and the 3 parts it connects to. The 3 relationships the patch removes are dashed red, and the 2 relationships it adds are green.");
    const ch = ds.patches.find((p) => p.id === "P-001")!.impact.drawing!.change!;
    expect(ch.addedRelationships.length).toBe(2);
  });
});

// ---------- synthetic shapes ----------
const LONG = "The Very Long Gate: Ship It, Then Measure; Again And Again Until The Numbers Hold.";
function shapes(): [string, Bundle][] {
  const out: [string, Bundle][] = [];
  const base = clone(ds);
  const empty = clone(base); empty.plan.units = []; empty.plan.phases = []; empty.findings = []; empty.patches = []; empty.model.teams = []; delete (empty as any).analysis; out.push(["nothing at all", empty]);
  const noParts = clone(empty); noParts.model.elements = []; noParts.model.relationships = []; out.push(["no parts", noParts]);
  const one = clone(base);
  one.plan.phases = [{ ...one.plan.phases[0], name: LONG }];
  one.plan.units = [{ ...one.plan.units[0], phase: one.plan.phases[0].id, status: "todo", requires: [], provides: [] }];
  one.model.teams = one.model.teams.slice(0, 1);
  one.findings = one.findings.filter((f) => f.severity === "warning").slice(0, 1);
  one.analysis = { ...(one.analysis as any), frontier: [one.plan.units[0].id], critical_path: [one.plan.units[0].id], blocked: {}, phases: undefined } as any;
  out.push(["one of everything, a long gate name", one]);
  const oneDone = clone(one); oneDone.plan.units[0].status = "done"; oneDone.analysis = { ...(oneDone.analysis as any), frontier: [], critical_path: [] } as any; out.push(["one unit, done", oneDone]);
  const errs = clone(base);
  errs.findings = [...errs.findings, ...errs.findings.slice(0, 3).map((f) => ({ ...f, severity: "error" as const, rule: "made-up-error", pack: f.pack }))];
  for (const p of errs.instance.packs) p.rules = [...p.rules, { id: "made-up-error", title: 'Every "thing" Has A Name, Always.', why: "", severity: "error" } as any];
  out.push(["errors and a punctuated rule title", errs]);
  const tied = clone(base); tied.findings = tied.findings.filter((f, i, a) => a.findIndex((g) => g.rule === f.rule) === i); out.push(["one warning per rule", tied]);
  const capName = clone(base); capName.plan.phases = capName.plan.phases.map((p) => ({ ...p, name: "A Gate Named Like A Title" })); out.push(["capitalised gate names", capName]);
  const noName = clone(base); noName.plan.phases = noName.plan.phases.map((p) => ({ ...p, name: "" })); out.push(["gates with no name", noName]);
  const big = clone(ds); big.model.elements = [...big.model.elements, ...Array.from({ length: 2000 }, (_, i) => ({ id: "x" + i, name: "Extra " + i, kind: "service" } as any))]; out.push(["thousands of parts", big]);
  return out;
}

describe("synthetic data shapes", () => {
  for (const [name, b] of shapes()) {
    test(`${name}`, () => {
      const ix = index(b);
      const s = [...briefSentences(ix), planBrief(ix), designSentence(ix)].flatMap((x) => x.split(/(?<=[.!?”])\s+(?=[A-Z“])/));
      clean(s);
      for (const p of b.patches) clean(verdict(p).tokens.map((t) => t.text), false);
    });
  }
  test("the shapes say what they should", () => {
    const by = new Map(shapes());
    expect(briefSentences(index(by.get("nothing at all")!))).toEqual(["The model has 22 parts and 31 relationships.", "The plan has no units yet.", "The design passes every check."]);
    expect(briefSentences(index(by.get("no parts")!))[0]).toBe("The model has no parts yet.");
    const one = briefSentences(index(by.get("one of everything, a long gate name")!));
    expect(one[0]).toMatch(/^Overall (red|amber|green)[.:] /); // the plan's status opens the brief
    expect(one[1]).toBe("The plan has 1 unit in 1 milestone, and it can start now.");
    expect(one[2]).toBe("The current milestone, “The Very Long Gate: Ship It, Then Measure; Again And Again Until The Numbers Hold”, has 1 unit, not done yet.");
    expect(one[3]).toMatch(/^The design passes every error check, with 1 warning, from “.+”\.$/);
    expect(briefSentences(index(by.get("one unit, done")!))[1]).toBe("The plan has 1 unit in 1 milestone, and every one is done.");
    expect(briefSentences(index(by.get("one unit, done")!))[2]).toBe("Its one milestone is reached.");
    expect(designSentence(index(by.get("errors and a punctuated rule title")!))).toMatch(/^The design fails \d error rules? in 3 places, and has \d+ warnings from \d+ rules; the most common is “.+” \(\d+\)\.$/);
    expect(designSentence(index(by.get("one warning per rule")!))).toMatch(/^The design passes every error check, with \d+ warnings, one from each of \d+ rules\.$/);
    expect(briefSentences(index(by.get("gates with no name")!))[2]).toBe("The current milestone has 4 of its 7 units done.");
    expect(briefSentences(index(by.get("thousands of parts")!))[0]).toMatch(/^Overall /);
  });
});

describe("every visible text node of the rendered pages", () => {
  const textNodes = (doc: string) => doc
    .replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "")
    .split(/<[^>]+>/).map((t) => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#8594;/g, "→").replace(/&#8722;/g, "−").replace(/\s+/g, " ").trim())
    .filter((t) => t && !/^[?·]$/.test(t));
  for (const [name, b] of [["delivery-stream", ds], ["sample", sample]] as const) {
    test(`${name}: no broken constructions in any text the page prints`, () => {
      const nodes = textNodes(renderSite(b));
      expect(nodes.length).toBeGreaterThan(200);
      // the model's own authored text (descriptions, rule whys, tour copy) is checked too: the engine prints it as is
      clean(nodes, false);
    });
  }
});
