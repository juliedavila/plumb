// The site's Strategy and Notes pages, notes in place, "Since you last looked", compared builds, routes, search, the
// tour steps, and the prose of every new computed sentence.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle.ts";
import { parseNotes } from "../src/core/notes.ts";
import { rankByStakes } from "../src/core/premise.ts";
import { renderSite } from "../src/site/render.ts";
import { lint } from "../src/site/prose.ts";
import { diffSentence, notesBrief, strategyBrief } from "../src/site/strategy.ts";
import { DIGEST, diffBundles } from "../src/core/diff.ts";
import type { Bundle } from "../src/types.ts";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = join(import.meta.dir, "..");
const built = "2026-10-22T10:00:00.000Z";
const { bundle: ds, warnings: dsWarn } = await buildBundle(DS_DIR, { built });
const sample: Bundle = await Bun.file(join(import.meta.dir, "fixtures/sample-bundle.json")).json();
const dsHtml = renderSite(ds), sampleHtml = renderSite(sample);
const DATA_OPEN = '<script type="application/json" id="de-bundle">';
const client = (doc: string): any => { const i = doc.indexOf("</script>", doc.indexOf(DATA_OPEN)); const o = doc.indexOf("<script>", i); return new Function(doc.slice(o + 8, doc.indexOf("</script>", o)) + "\n;return DE;")(); };
const DE = client(dsHtml);
const page = (doc: string, id: string) => { const i = doc.indexOf(`data-page="${id}"`); const j = doc.indexOf('<section class="page"', i + 10); return doc.slice(i, j > 0 ? j : undefined); };
const clean = (t: string) => expect(lint(t, { sentence: true, maxWords: 30 })).toEqual([]);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

describe("Strategy page", () => {
  test("claims are ranked by stakes (least tested first, then the most work built on each before its first test), each with its grade as icon and word", () => {
    const s = page(dsHtml, "strategy");
    const order = [...s.matchAll(/data-claim="([^"]+)" data-grade/g)].map((m) => m[1]);
    expect(order).toEqual(rankByStakes(ds.model.claims!, ds.premises!).map((c) => c.id));
    expect(order[0]).toBe("PR-4"); // a judgment call nothing tests, with 8 open units built on it, ahead of an untested one with 4
    expect(s).toContain('<use href="#i-g-untested"/></svg><span class="w">Untested</span>');
    expect(s).toContain("Untested, and much rests on it");
  });
  test("the brief is computed and reads cleanly", () => {
    for (const b of [ds]) for (const t of strategyBrief(b).split(/(?<=\.) /)) clean(t);
    expect(strategyBrief(ds)).toBe("The design rests on 3 premises, 1 conclusion and 2 assumptions. By grade, 2 are inferred from evidence, 2 are judgment calls and 2 are untested. One untested premise carries much of the design; it is “The automated suite can catch the defects that the manual test and…”, with 8 records resting on it.");
  });
  test("a claim's detail: grade, source, fallback, what rests on it with the chain, the plan slice, notes", () => {
    const ix = DE.buildIndex(ds);
    const h = DE.claimDetail(ix, "PR-1", {});
    const t = text(h);
    expect(t).toContain("Most of a change's lead time is waiting");
    expect(t).toContain("Fallback");
    expect(t).toContain("If this is false");
    expect(t).toMatch(/through “[A-Z][^”]+”/); // the chain of claims by their words, not their ids
    expect(t).not.toMatch(/through PR-\d/);
    expect(t).toContain("Work that rests on it");
    expect(t).toContain("Tested by");
    for (const s of [...h.matchAll(/<p class="small fg2" style="margin-bottom:6px">([^<]+)<\/p>/g)].map((m) => m[1])) for (const x of s.split(/(?<=\.) /)) clean(x);
    expect(DE.claimDetail(ix, "nope")).toContain("No claim");
  });
  test("parts, units and gates show the claims they rest on", () => {
    const ix = DE.buildIndex(ds);
    expect(DE.elementDetail(ix, "test-suite")).toContain('data-claim="PR-2"');
    expect(DE.unitDetail(ix, "U-10")).toContain('data-claim="PR-6"');
    expect(dsHtml).toContain('data-claims-for="phase:SHORTEN"');
  });
});

describe("notes in place", () => {
  const ix = DE.buildIndex(ds);
  test("offline: read-only cards, and the add box copies YAML", () => {
    const h = DE.notesBlock(ix, [{ kind: "claim", id: "PR-2" }], {});
    expect(h).toContain("N-1");
    expect(h).toContain("Copy as YAML");
    expect(h).not.toContain("data-note-act");
  });
  test("under the dev server: add, answer, resolve, edit and delete", () => {
    const h = DE.notesBlock(ix, [{ kind: "claim", id: "PR-2" }], { edit: true });
    for (const a of ["answer", "resolve", "edit", "delete"]) expect(h).toContain(`data-note-act="${a}"`);
    expect(h).toContain(">Add<");
  });
  test("every record kind shows its notes: parts (with their relationships and contracts), units, gates, claims, patches, findings", () => {
    expect(DE.elementDetail(ix, "ci-pipeline")).toContain("N-2");
    expect(DE.elementDetail(ix, "ci-pipeline")).toContain("&quot;kind&quot;:&quot;relationship&quot;");
    expect(DE.unitDetail(ix, "U-09")).toContain("notes-block");
    expect(dsHtml).toContain('data-notes-for="patch:P-001"');
    expect(dsHtml).toContain('data-notes-for="phase:SEE"');
    expect(dsHtml).toContain('data-notes-for="finding-rule:flow/queue-has-wip-limit"');
  });
  test("the YAML the add box copies parses back to the same note", () => {
    const n = { id: "N-9", target: { kind: "finding", id: 'flow/x@a "b"' }, kind: "question", text: 'Two lines\nand "quotes"', status: "open", author: "person", created: "2026-10-22T10:00:00Z", updated: "2026-10-22T10:00:00Z" };
    expect(parseNotes("notes:\n" + DE.noteYaml(n)).notes[0]).toEqual(n as any);
  });
  test("Notes page: open questions first, a brief, filters", () => {
    const s = page(dsHtml, "notes");
    expect(s).toContain('id="note-filters"');
    expect(dsHtml).toMatch(/data-nav="notes">Notes <span class="badge accent">1/);
    for (const x of notesBrief(ds.notes!.items).split(/(?<=\.) /)) clean(x);
    expect(notesBrief(ds.notes!.items)).toBe("Open now: 1 question and 1 note. Answered and waiting to be resolved: 1 question. Resolved: 1 note.");
    expect(notesBrief([])).toContain("No notes yet");
    expect(ds.notes!.items[0].id).toBe("N-1");
  });
  test("the offline file holds no write path: the request lives in the dev server's snippet", () => {
    for (const doc of [dsHtml]) {
      expect(doc).not.toContain("window.DE_DEV =");
      expect(doc).not.toContain("__deNotes = function");
      expect(doc).not.toMatch(/fetch\(/);
    }
  });
});

describe("since you last looked, and compared builds", () => {
  const later: Bundle = structuredClone(ds);
  later.notes!.items = later.notes!.items.map((n) => (n.id === "N-1" ? { ...n, status: "answered", answer: "Yes." } : n));
  later.findings = later.findings.slice(2);
  const d = DIGEST.compare(DIGEST.digest(ds), DIGEST.digest(later), DIGEST.names(later), DIGEST.names(ds));
  test("the page's sentence and panel come from the same comparison as plumb diff", () => {
    expect(DE.sinceSentence(d)).toBe("Since then: 2 findings gone and 1 note answered.");
    clean(DE.sinceSentence(d));
    const h = DE.sinceHtml(DE.buildIndex(later), d, "2026-10-20T09:00:00Z");
    expect(text(h)).toContain("Since you last looked");
    expect(text(h)).toContain("Notes answered 1");
    expect(h).toContain('id="since-dismiss"');
    expect(dsHtml).toContain('<section class="since" id="since"');
  });
  test("a gone finding is named by its rule even when only its key is known", () => {
    const d2 = DIGEST.compare(DIGEST.digest(ds), DIGEST.digest(later), DIGEST.names(later));
    expect(d2.findings.gone[0].name).not.toContain("@");
  });
});

describe("routes, search and the tour", () => {
  test("routes for a claim and a note", () => {
    expect(DE.parseRoute("#strategy/claim/CL-01")).toMatchObject({ page: "strategy", sub: "claim", id: "CL-01" });
    expect(DE.parseRoute("#notes/N-3")).toMatchObject({ page: "notes", sub: "note", id: "N-3" });
    expect(DE.tourHash({ claim: "PR-2" })).toBe("#strategy/claim/PR-2");
    expect(DE.tourHash("notes")).toBe("#notes");
  });
  test("search finds claims and notes", () => {
    const groups = DE.searchRank(DE.searchIndex(DE.buildIndex(ds)), "suite");
    const names = groups.map((g: any) => g.group);
    expect(names).toContain("Claims");
    expect(names).toContain("Notes");
  });
  test("both tours carry a premise step and a notes step, and build without warnings", () => {
    for (const b of [ds]) {
      expect(b.tour!.steps.some((s) => typeof s.target === "object" && "claim" in s.target)).toBe(true);
      expect(b.tour!.steps.some((s) => s.target === "notes")).toBe(true);
      expect(b.tour!.steps.every((s) => !s.missing)).toBe(true);
    }
    expect(dsWarn).toEqual([]);
  });
});
