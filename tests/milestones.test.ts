// Milestones: a phase is shown as a milestone, a checkpoint where a complete unit of value is delivered. Every
// user-facing surface says "milestone" and names it ("See the stream"), never "gate 2"; the data key stays `phase`, and
// an older link or tour that says gate still lands. A phase may say what it delivers and what reaching it means, in
// plan.yaml or, beside a generated plan, in milestones.yaml.
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { renderSite } from "../src/site/render";
import { buildBundle } from "../src/core/bundle";
import { loadInstance } from "../src/core/load";
import type { Bundle } from "../src/types";
import CLIENT_FILES from "./fixtures/client-files";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const built = "2026-10-21T10:00:00.000Z";
const ds = (await buildBundle(DS_DIR, { built })).bundle;

/** Every string an instance's own files put on the page: names, titles, exit tests, notes, tours, the deck's hand-written words. */
function dataStrings(b: Bundle, dir: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => { if (typeof v === "string") out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  const { deck: _d, status: _s, ...rest } = b;
  walk(rest);
  walk(Bun.YAML.parse(require("node:fs").readFileSync(join(dir, "deck.yaml"), "utf8")));
  return out;
}
const words = (t: string) => t.toLowerCase().replace(/[“”"'’‘.,;:()!?]/g, " ").split(/\s+/).filter(Boolean);
/** The "gate" words in a text that no instance string accounts for (a domain word such as "deploy gate" is the instance's own). */
function strayGates(text: string, data: string[]): string[] {
  const allowed = new Set<string>();
  for (const s of data) { const w = words(s); w.forEach((x, i) => { if (/^gat(e|es|ed|ing)$/.test(x)) { if (i) allowed.add(w[i - 1] + " " + x); if (i < w.length - 1) allowed.add(x + " " + w[i + 1]); } }); }
  const w = words(text), out: string[] = [];
  w.forEach((x, i) => { if (/^gates?$/.test(x) && !(i && allowed.has(w[i - 1] + " " + x)) && !(i < w.length - 1 && allowed.has(x + " " + w[i + 1]))) out.push(w.slice(Math.max(0, i - 4), i + 5).join(" ")); });
  return out;
}
/** The page's visible text and the attributes a reader hears or hovers (aria-label, title, placeholder), scripts removed. */
function readable(html: string): string {
  const noScript = html.replace(/<script\b[\s\S]*?<\/script>/g, " ").replace(/<style\b[\s\S]*?<\/style>/g, " ");
  const attrs = [...noScript.matchAll(/\s(?:aria-label|title|placeholder)="([^"]*)"/g)].map((m) => m[1]);
  const text = noScript.replace(/<[^>]+>/g, " ");
  const un = (t: string) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return un(text + " " + attrs.join(" "));
}

describe("the rename: gate becomes milestone", () => {
  for (const [name, b] of [["delivery-stream", ds]] as const) {
  }
  test("the client's own strings say milestone: gate survives only as an alias for older links and tours", () => {
    const lits = CLIENT_FILES.flatMap((src) => [...src.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1] ?? m[2]));
    // markup hooks (data-gate, --gate, f-gate, gate-panel) are attribute and style names, never read by anyone
    const markup = /(?:data-|--|f-|filter-)gate\b|gate-panel/g;
    const withGate = [...new Set(lits.filter((s) => /\bgates?\b/i.test(s.replace(markup, ""))))].sort();
    expect(withGate).toEqual(["gate"]); // the alias key: gate= in an older link reads as milestone=
  });
  test("milestones are named, never numbered, on the road, the panels, the table and the filters", () => {
    const html = renderSite(ds);
    expect(html).toContain('aria-label="Milestones"');
    expect(html).toMatch(/<h2 id="h-gate-[^"]+">See the stream<\/h2>/);
    expect(html).toContain('<label class="field">Milestone<select id="f-gate"><option value="">All</option><option value="SEE">See the stream</option>');
    expect(html).not.toMatch(/Milestone \d/);
  });
});

describe("milestone fields", () => {
  test("a phase in plan.yaml may say what it delivers, what it means, its target date and a status override", () => {
    const see = ds.plan.phases.find((p) => p.id === "SEE")!;
    expect(see.delivers).toMatch(/^A map of the stream/);
    expect(see.means).toMatch(/^We can say where/);
    expect(see.target).toBe("2026-10-30");
    expect(ds.plan.phases.find((p) => p.id === "SHORTEN")!.override).toEqual({ status: "green", reason: expect.stringMatching(/^On course\. Platform has committed/), date: "2026-10-20", by: "the delivery lead", review_by: "2026-11-06" });
  });
  test("milestones.yaml: an unknown phase is a problem and a bad override an error (it fails loudly); good fields still apply", () => {
    const dir = mkdtempSync(join(tmpdir(), "plumb-ms-"));
    cpSync(join(ROOT, "tests/fixtures/mini"), dir, { recursive: true });
    const inst0 = loadInstance(dir);
    const id = inst0.plan.phases[0].id;
    writeFileSync(join(dir, "milestones.yaml"), `milestones:\n  ${id}:\n    delivers: The thing.\n    override: { status: purple, reason: x }\n  NOPE:\n    delivers: x\n`);
    const inst = loadInstance(dir);
    expect(inst.plan.phases[0].delivers).toBe("The thing.");
    expect(inst.plan.phases[0].override).toBeUndefined();
    expect(inst.milestoneProblems).toEqual(["milestones.yaml: NOPE is not a phase in the plan"]);
    expect(inst.loadFindings!.find((f) => f.rule === "override-valid")).toMatchObject({ pack: "core", severity: "error", at: id, atKind: "phase" });
  });
  test("an older link (#plan/gate/<id>, gate=) and an older tour target ({ gate }) still land on the milestone", () => {
    const DE = new Function(clientScript(renderSite(ds)) + "\n;return DE;")();
    expect(DE.parseRoute("#plan/gate/SEE")).toMatchObject({ page: "plan", sub: "milestone", id: "SEE" });
    expect(DE.stateOf(DE.parseRoute("#plan?gate=SEE")).f).toEqual({ milestone: ["SEE"] });
    expect(DE.tourHash({ gate: "SEE" })).toBe("#plan/milestone/SEE");
  });
});

function clientScript(doc: string) { const D = '<script type="application/json" id="de-bundle">'; const i = doc.indexOf("</script>", doc.indexOf(D)); const o = doc.indexOf("<script>", i); return doc.slice(o + 8, doc.indexOf("</script>", o)); }

describe("progress.yaml and dated overrides", () => {
  const mini = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "plumb-prog-"));
    cpSync(join(ROOT, "tests/fixtures/mini"), dir, { recursive: true });
    for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);
    return dir;
  };
  test("a unit's status set by a person, with when and by whom, goes onto the unit", async () => {
    const id = loadInstance(join(ROOT, "tests/fixtures/mini")).plan.units[0].id;
    const { bundle } = await buildBundle(mini({ "progress.yaml": `units:\n  ${id}: { status: doing, date: "2026-10-22", by: the platform lead, reason: Started this sprint. }\n` }), { built: "test" });
    const u = bundle.plan.units.find((x) => x.id === id)!;
    expect(u.status).toBe("doing");
    expect(u.attrs!.status_set).toEqual({ status: "doing", date: "2026-10-22", by: "the platform lead", reason: "Started this sprint." });
    expect(bundle.findings.filter((f) => f.rule === "progress-valid")).toEqual([]);
  });
  test("an entry with no date or no by is an error at the unit and is not applied; an unknown unit is a warning", async () => {
    const inst0 = loadInstance(join(ROOT, "tests/fixtures/mini"));
    const [a, b] = inst0.plan.units.map((u) => u.id);
    const { bundle, warnings } = await buildBundle(mini({ "progress.yaml": `units:\n  ${a}: { status: done, by: someone }\n  ${b}: { status: finished, date: "2026-10-22" }\n  U-NOPE: { status: done, date: "2026-10-22", by: x }\n` }), { built: "test" });
    const fs = bundle.findings.filter((f) => f.rule === "progress-valid");
    expect(fs.map((f) => [f.at, f.severity])).toEqual([[a, "error"], [b, "error"]]);
    expect(fs[0].message).toContain("gives no date");
    expect(fs[1].message).toContain('has status "finished", which is not todo, doing or done');
    expect(fs[1].message).toContain("does not say who set it (by)");
    expect(bundle.plan.units.find((u) => u.id === a)!.status).toBe(inst0.plan.units[0].status ?? "todo");
    expect(warnings.join(" ")).toContain("progress.yaml: U-NOPE is not a unit in the plan");
  });
  test("a milestone override without a date is an error and is not applied", async () => {
    const id = loadInstance(join(ROOT, "tests/fixtures/mini")).plan.phases[0].id;
    const { bundle } = await buildBundle(mini({ "milestones.yaml": `milestones:\n  ${id}:\n    override: { status: green, reason: On course., by: the lead }\n` }), { built: "test" });
    expect(bundle.findings.find((f) => f.rule === "override-valid" && f.at === id)?.message).toContain("gives no date (date: YYYY-MM-DD)");
    expect(bundle.plan.phases[0].override).toBeUndefined();
  });
});

// The decision owner decides and the independent reviewer confirms, said
// on every milestone card; the lines claim no more than premerge's exit tests.
describe("decides and confirms", () => {
  const mini = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "plumb-conf-"));
    cpSync(join(ROOT, "tests/fixtures/mini"), dir, { recursive: true });
    for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);
    return dir;
  };
  test("confirmed_by in milestones.yaml reaches the status and the card reads Decides · Confirms; it leaves the model hash alone", async () => {
    const { statusBlock } = await import("../src/site/status");
    const { modelHash } = await import("../src/core/bundle");
    const id = loadInstance(join(ROOT, "tests/fixtures/mini")).plan.phases[0].id;
    const plain = await buildBundle(mini({ "milestones.yaml": `milestones:\n  ${id}:\n    accountable: the program lead\n` }), { built: "test" });
    const both = await buildBundle(mini({ "milestones.yaml": `milestones:\n  ${id}:\n    accountable: the program lead\n    confirmed_by: the independent reviewer\n` }), { built: "test" });
    expect(both.bundle.status!.milestones[0].confirmed_by).toBe("the independent reviewer");
    expect(statusBlock(both.bundle, id)).toContain("Status set by: the program lead · Confirmed by: the independent reviewer");
    expect(statusBlock(plain.bundle, id)).toContain("Accountable: the program lead");
    expect(both.bundle.engine.modelHash).toBe(plain.bundle.engine.modelHash);
    expect(typeof modelHash).toBe("function");
  });
});
