// Honesty checks: pages report the computed state without unsupported claims.
// Each describe block pins one guarantee.
import { describe, expect, test } from "bun:test";
import { computeImpact } from "../src/core/impact.ts";
import { loadInstance } from "../src/core/load.ts";
import { loadPacks } from "../src/core/rules.ts";
import { MINI } from "./core-helpers.ts";

describe("a patch's attrs changes show their values", () => {
  test("attrs diff: a modify of attrs.wait_days shows the value before and after, not (unset) to (unset)", async () => {
    const inst = loadInstance(MINI);
    const { packs } = await loadPacks(inst.config.packs);
    inst.patches.push({ id: "p30", title: "Shorten the wait", status: "proposed", why: "t", ops: [{ op: "modify", kind: "element", id: "mechanic", set: { attrs: { wait_days: 1, wip_limit: 3 } } }] });
    const im = computeImpact(inst, "p30", packs);
    const fc = (f: string) => im.fieldChanges!.find((x) => x.id === "mechanic" && x.field === f)!;
    expect(fc("attrs.wait_days")).toMatchObject({ before: "2", after: "1" });
    expect(fc("attrs.wip_limit").before).toBeUndefined(); // it was not set before
    expect(fc("attrs.wip_limit").after).toBe("3");
  });
});

describe("patch verdicts are never falsely green", () => {
  const setup = async () => {
    const inst = loadInstance(MINI);
    const { packs } = await loadPacks(inst.config.packs);
    return { inst, packs };
  };
  test("verdict: findings lost only with a removed record make it amber, never green", async () => {
    const { inst, packs } = await setup();
    inst.model.elements.push({ id: "orphan", name: "Orphan", kind: "service" }); // no owner: a warning that leaves with it
    inst.patches.push({ id: "p21", title: "Drop the orphan", status: "proposed", why: "Nobody uses it.", ops: [{ op: "remove", kind: "element", id: "orphan" }] });
    const im = computeImpact(inst, "p21", packs);
    expect(im.findingsGone!.length).toBe(1);
    expect(im.verdict!.level).toBe("caution");
    expect(im.verdict!.reasons.join(" ")).toMatch(/only because the patch removes/);
  });
  test("verdict: a unit the why names that is not done is an unmet precondition, so amber", async () => {
    const { inst, packs } = await setup();
    inst.patches.push({ id: "p22", title: "Label the pickup shelf", status: "proposed", why: "Once u3 has measured repair time, the shelf can show the wait.", ops: [{ op: "modify", kind: "element", id: "pickup", set: { description: "Shows the wait" } }] });
    const im = computeImpact(inst, "p22", packs);
    expect(im.verdict!.level).toBe("caution");
    expect(im.verdict!.reasons.join(" ")).toContain("“Measure repair time”");
    expect(im.verdict!.reasons.join(" ")).toMatch(/blocked|not done/);
  });
  test("verdict: a unit whose parts were all removed is an error finding, so red", async () => {
    const { inst, packs } = await setup();
    const im = computeImpact(inst, "p3", packs); // removes intake, the only part u1 moves
    const f = im.findingsIntroduced.find((x) => x.rule === "unit-keeps-a-part");
    expect(f).toMatchObject({ pack: "core", severity: "error", at: "u1", atKind: "unit" });
    expect(im.verdict!.level).toBe("fail");
  });
  test("unbacked check widened: parts and contracts named in the title or why, not ids only", async () => {
    const { inst, packs } = await setup();
    inst.model.contracts.push({ name: "RepairNote", produced_by: ["mechanic"], consumed_by: ["pickup"] });
    inst.patches.push({ id: "p23", title: "Keep repair notes in the Repair queue", status: "proposed", why: "Saves a trip.", ops: [{ op: "modify", kind: "element", id: "pickup", set: { description: "x" } }] });
    const im = computeImpact(inst, "p23", packs);
    expect(im.unbacked).toEqual(expect.arrayContaining([{ kind: "element", id: "queue1" }, { kind: "contract", id: "RepairNote" }]));
    expect(im.verdict!.level).toBe("caution");
  });
  test("a contract that only loses a producer or consumer by cascade is not backed by the patch", async () => {
    const { inst, packs } = await setup();
    inst.model.contracts.push({ name: "RepairNote", produced_by: ["mechanic"], consumed_by: ["pickup"] });
    inst.patches.push({ id: "p24", title: "Retire the pickup shelf and keep repair notes elsewhere", status: "proposed", why: "t", ops: [{ op: "remove", kind: "element", id: "pickup" }] });
    const im = computeImpact(inst, "p24", packs);
    expect(im.unbacked).toEqual(expect.arrayContaining([{ kind: "contract", id: "RepairNote" }]));
  });
  test("every verdict carries a reject line and a revise line: the file and field, and what to tell Claude", async () => {
    const { inst, packs } = await setup();
    const im = computeImpact(inst, "p3", packs);
    expect(im.verdict!.reject).toContain("patches/p3.yaml");
    expect(im.verdict!.reject).toContain("status: rejected");
    expect(im.verdict!.revise).toContain("patches/p3.yaml");
    expect(im.verdict!.revise).toMatch(/tell Claude: “Revise p3 so that/);
    expect(im.verdict!.revise).toContain("Write the ticket form");
  });
});

// A copy of the mini instance in a temp directory, with files rewritten.
import { cpSync, mkdtempSync, readFileSync as rf, writeFileSync as wf } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DS_DIR, HAVE_MCP_SERVER } from "./instance-dirs.ts";
function miniCopy(edit: (dir: string) => void = () => {}): string {
  const d = mkdtempSync(join(tmpdir(), "plumb-honest-"));
  cpSync(MINI, d, { recursive: true });
  edit(d);
  return d;
}
const withOverride = (o: string) => (d: string) => wf(join(d, "plan.yaml"), rf(join(d, "plan.yaml"), "utf8").replace("order: 1 }", `order: 1, override: ${o} }`));

describe("overrides fail loudly, and an override never hides a worse computed status", () => {
  test("override: a malformed override in plan.yaml is an error finding, not dropped in silence", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { bundle } = await buildBundle(miniCopy(withOverride("{ status: grey, reason: fine, date: '2026-10-20', by: the lead }")));
    const f = bundle.findings.find((x) => x.rule === "override-valid");
    expect(f).toMatchObject({ pack: "core", severity: "error", at: "ph1", atKind: "phase" });
    expect(f!.message).toContain("grey");
  });
  test("override: an empty reason or by is an error finding", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { bundle } = await buildBundle(miniCopy(withOverride("{ status: green, reason: '', date: '2026-10-20', by: '' }")));
    const f = bundle.findings.find((x) => x.rule === "override-valid");
    expect(f?.severity).toBe("error");
    expect(f!.message).toMatch(/reason/);
    expect(f!.message).toMatch(/by/);
    expect(bundle.plan.phases.find((p) => p.id === "ph1")!.override).toBeUndefined(); // not applied
  });
  test("override: a malformed override in milestones.yaml is an error finding too", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { bundle } = await buildBundle(miniCopy((d) => wf(join(d, "milestones.yaml"), "milestones:\n  ph2:\n    override: { status: green }\n")));
    expect(bundle.findings.find((x) => x.rule === "override-valid" && x.at === "ph2")?.severity).toBe("error");
  });
  test("an override better than computed shows the computed status on the slide and the page", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { renderSite } = await import("../src/site/render.ts");
    const ROOT = new URL("..", import.meta.url).pathname;
    const { bundle } = await buildBundle(DS_DIR, { built: "2026-10-22T10:00:00.000Z" });
    const ms = bundle.status!.milestones.find((m) => m.phase === "SHORTEN")!;
    expect(ms.status).toBe("green");
    expect(ms.computed).not.toBe("green");
    const road = bundle.deck!.slides.find((s) => s.template === "status")!.milestones!.find((m) => m.phase === "SHORTEN")!;
    expect(road.computed).toBe(ms.computed);
    const html = renderSite(bundle);
    const deck = html.slice(html.indexOf('class="msroad'));
    const at = deck.indexOf("Shorten it"), li = deck.slice(Math.max(0, deck.lastIndexOf("<li", at)), deck.indexOf("</li>", at));
    expect(li).toMatch(new RegExp(`Computed ${ms.computed === "red" ? "Red" : "Amber"}`));
  });
});

describe("duplicate YAML keys fail", () => {
  test("duplicateKeys finds a repeated key in a block mapping, a flow mapping and a list item, and nothing else", async () => {
    const { duplicateKeys } = await import("../src/core/yaml-keys.ts");
    expect(duplicateKeys("a: 1\nb: 2\na: 3\n").map((d) => [d.key, d.line])).toEqual([["a", 3]]);
    expect(duplicateKeys("x: { a: 1, b: \"a: 2\", a: 3 }\n").map((d) => d.key)).toEqual(["a"]);
    expect(duplicateKeys("l:\n  - id: 1\n    name: n\n    id: 2\n  - id: 3\n").map((d) => [d.key, d.line])).toEqual([["id", 4]]);
    expect(duplicateKeys("l:\n  - id: 1\n  - id: 2\nm:\n  id: 3\n")).toEqual([]);
    expect(duplicateKeys("why: >-\n  a: 1\n  a: 2\nnext: 1\n")).toEqual([]); // inside a block scalar
    expect(duplicateKeys("# a: 1\na: 1 # a: 2\n")).toEqual([]);
  });
  test("a duplicate key in plan.yaml is a core error at the file, not last-one-wins in silence", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const d = miniCopy((dir) => wf(join(dir, "plan.yaml"), rf(join(dir, "plan.yaml"), "utf8").replace("    owner: shop\n", "    owner: shop\n    owner: counter\n")));
    const { bundle } = await buildBundle(d);
    const f = bundle.findings.find((x) => x.rule === "yaml-keys-unique");
    expect(f).toMatchObject({ pack: "core", severity: "error", atKind: "instance" });
    expect(f!.message).toContain("plan.yaml");
    expect(f!.message).toContain("owner");
  });
});

describe("the deck says when a path is cut short, and names the same belief for a milestone on every slide", () => {
  const ROOT = new URL("..", import.meta.url).pathname;
  const built = (async () => (await (await import("../src/core/bundle.ts")).buildBundle(DS_DIR, { built: "2026-10-22T10:00:00.000Z" })).bundle)();
  test("path to green: a milestone with more steps than the slide shows says the path goes on, and where", async () => {
    const b = await built;
    const groups = b.deck!.slides.filter((s) => s.template === "path").flatMap((s) => s.groups ?? []);
    let cut = 0;
    for (const g of groups) {
      const m = b.status!.milestones.find((x) => b.plan.phases.find((p) => p.id === x.phase)!.name === g.title)!;
      const shown = g.items.filter((it) => !it.more).length;
      if (m.path.length > shown) { cut++; expect(g.items.at(-1)!.text).toMatch(/not the whole path: \d+ more steps? (is|are) on the Plan/); }
      else expect(g.items.some((it) => it.more)).toBe(false);
    }
    expect(cut).toBeGreaterThan(0);
  });
  test("risk agreement: the belief a milestone's reason names first is the one its path tests first, and the challenge and the first risk name the heaviest", async () => {
    const b = await built;
    for (const m of b.status!.milestones) {
      const r = m.reasons.find((x) => x.criterion === "untested-premise");
      if (!r) continue;
      const a = m.path.find((x) => x.criterion === "untested-premise");
      expect(a?.work?.id).toBe(r.refs[0].id);
    }
    const ch = b.status!.challenges.find((c) => c.criterion === "untested-premise")!;
    expect(ch.refs[0].id).toBe(b.status!.risks[0].claim);
  });
});

describe("the milestones a premise puts at stake are the ones status counts", () => {
  test("premise impact: PR-2 turns amber the milestones status names it in, apart from those whose own work rests on it, on the bundle, the claim page and the CLI", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { renderSite } = await import("../src/site/render.ts");
    const { premiseMd } = await import("../src/core/report.ts");
    const ROOT = new URL("..", import.meta.url).pathname;
    const { bundle } = await buildBundle(DS_DIR, { built: "2026-10-22T10:00:00.000Z" });
    const byStatus = bundle.status!.milestones.filter((m) => m.reasons.some((r) => r.criterion === "untested-premise" && r.refs.some((x) => x.id === "PR-2"))).map((m) => m.phase);
    expect(byStatus).toEqual(["SEE", "SHORTEN"]);
    expect(bundle.premises!["PR-2"].amberBy).toEqual(byStatus);
    expect(bundle.premises!["PR-2"].atStake).toEqual(["SHORTEN"]); // only "Shorten it"'s own work names it; "See the stream" changes a part that does
    const doc = renderSite(bundle);
    const i = doc.indexOf("</script>", doc.indexOf('id="de-bundle"')), o = doc.indexOf("<script>", i);
    const DE = new Function(doc.slice(o + 8, doc.indexOf("</script>", o)) + "\n;return DE;")();
    const h = DE.claimDetail(DE.buildIndex(bundle), "PR-2").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(h).toContain("Rests on it directly");
    expect(h).toContain("Turned amber by this");
    expect(h).toContain("See the stream");
    expect(h).toContain("Shorten it");
    const md = premiseMd(bundle, "PR-2");
    expect(md).toMatch(/Milestones whose own work rests on it: \*\*Shorten it\*\*/);
    expect(md).toMatch(/Turned amber by it \(their work changes a part that rests on it\): \*\*See the stream\*\*/);
  });
});

describe("snapshots keep status and the rule set; what changed leads with status moves and keeps check changes apart", () => {
  const ROOT = new URL("..", import.meta.url).pathname;
  const DS = DS_DIR;
  const dsCopy = () => { const d = mkdtempSync(join(tmpdir(), "plumb-honest-ds-")); cpSync(DS, d, { recursive: true }); return d; };
  test("makeSnapshot: stores milestone and plan status, the engine version and the rule-set version", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { makeSnapshot } = await import("../src/core/snapshot.ts");
    const { bundle } = await buildBundle(DS, { built: "2026-10-22T10:00:00.000Z" });
    const s = makeSnapshot(bundle);
    expect(s.status!.overall).toBe(bundle.status!.overall.status);
    expect(s.status!.milestones.map((m) => [m.id, m.status, m.computed])).toEqual(bundle.status!.milestones.map((m) => [m.phase, m.status, m.computed]));
    expect(s.engineVersion).toBe(bundle.engine.version);
    expect(s.rules).toMatch(/^[0-9a-z]+$/);
    expect(s.rules).toBe(bundle.engine.rules);
    expect(s.digest.s!.m.SEE).toBe(bundle.status!.milestones.find((m) => m.phase === "SEE")!.status);
  });
  test("what changed: a status move leads, in words (“See the stream” went amber to red)", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { makeSnapshot, saveSnapshot } = await import("../src/core/snapshot.ts");
    const d = dsCopy();
    const { trashSync } = { trashSync: (p: string) => { try { require("node:fs").renameSync(p, p + ".old-test"); } catch {} } };
    trashSync(join(d, "reports"));
    const { bundle: then } = await buildBundle(d, { built: "2026-10-21T10:00:00.000Z" });
    const see = then.status!.milestones.find((m) => m.phase === "SEE")!;
    expect(see.status).toBe("red");
    see.status = "amber"; see.computed = "amber"; // what the room saw last time
    saveSnapshot(d, makeSnapshot(then, { presented: true, now: new Date("2026-10-21T10:00:00Z") }));
    const { bundle: now } = await buildBundle(d, { built: "2026-10-22T10:00:00.000Z" });
    expect(now.sinceReport!.diff.status!.moves).toEqual([{ kind: "phase", id: "SEE", name: "See the stream", from: "amber", to: "red" }]);
    const slide = now.deck!.slides.find((s) => s.template === "changes")!;
    expect(slide.items![0].text).toBe("“See the stream” went amber to red");
    expect(slide.items![0].tone).toBe("fail");
  });
  test("what changed: findings of a rule the baseline did not have are a change in the checks, not the design getting worse", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { DIGEST } = await import("../src/core/digest.ts");
    const { bundle: now } = await buildBundle(DS, { built: "2026-10-22T10:00:00.000Z" });
    const then = structuredClone(now);
    // the baseline ran before flow/queue-has-wip-limit existed
    for (const p of then.instance.packs) p.rules = p.rules.filter((r) => !(p.name === "flow" && r.id === "queue-has-wip-limit"));
    then.findings = then.findings.filter((f) => !(f.pack === "flow" && f.rule === "queue-has-wip-limit"));
    const newOnes = now.findings.filter((f) => f.pack === "flow" && f.rule === "queue-has-wip-limit").length;
    expect(newOnes).toBeGreaterThan(0);
    const diff = DIGEST.compare(DIGEST.digest(then), DIGEST.digest(now), DIGEST.names(now), DIGEST.names(then));
    expect(diff.findings.added.filter((f) => f.id.startsWith("flow/queue-has-wip-limit@"))).toEqual([]);
    expect(diff.checks!.rulesAdded).toEqual(["flow/queue-has-wip-limit"]);
    expect(diff.checks!.findingsAdded.length).toBe(newOnes);
  });
});

describe("Mark as presented saves once, says so truly, and the dev loop ignores reports/", () => {
  const ROOT = new URL("..", import.meta.url).pathname;
  let dev: Awaited<ReturnType<typeof import("../src/dev/server.ts").startDev>> | undefined;
  const post = async () => {
    const res = await fetch(`http://127.0.0.1:${dev!.port}/__de/report`, { method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${dev!.port}`, "x-de-token": dev!.token }, body: JSON.stringify({ op: "present" }) });
    return { status: res.status, body: await res.json() as any };
  };
  test("dev ignores reports/: a snapshot written there does not rebuild or reload the page", async () => {
    const { startDev } = await import("../src/dev/server.ts");
    const d = mkdtempSync(join(tmpdir(), "plumb-honest-dev-")); cpSync(DS_DIR, d, { recursive: true });
    dev = await startDev(d, { port: 0, outDir: mkdtempSync(join(tmpdir(), "plumb-honest-out-")), debounceMs: 30 });
    const before = dev.builds();
    expect((await post()).status).toBe(200);
    await Bun.sleep(900);
    expect(dev.builds()).toBe(before);
  });
  test("Mark as presented saves once: a second press for the same build saves nothing and says it was already saved", async () => {
    const second = await post();
    expect(second.status).toBe(200);
    expect(second.body.already).toBe(true);
    expect(second.body.file).toMatch(/^reports\//);
    const html = await (await fetch(dev!.url)).text();
    dev!.close();
    expect(html).toContain("Saved as presented");
  });
  test("the page knows when this build is already presented, from the bundle, so a reload keeps the truth", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { makeSnapshot, saveSnapshot } = await import("../src/core/snapshot.ts");
    const { renderSite } = await import("../src/site/render.ts");
    const d = mkdtempSync(join(tmpdir(), "plumb-honest-pres-")); cpSync(DS_DIR, d, { recursive: true });
    const { bundle: b0 } = await buildBundle(d);
    const file = saveSnapshot(d, makeSnapshot(b0, { presented: true }));
    const { bundle } = await buildBundle(d);
    const doc = renderSite(bundle);
    const i = doc.indexOf("</script>", doc.indexOf('id="de-bundle"')), o = doc.indexOf("<script>", i);
    const DE = new Function(doc.slice(o + 8, doc.indexOf("</script>", o)) + "\n;return DE;")();
    expect(DE.presentedReport(bundle)?.file).toBe(file);
  });
});

describe("the dev watcher catches in-place edits", () => {
  test("watcher: an edit made with BSD sed -i (a rename over the file) rebuilds the page", async () => {
    const { startDev } = await import("../src/dev/server.ts");
    const d = miniCopy();
    const dev = await startDev(d, { port: 0, outDir: mkdtempSync(join(tmpdir(), "plumb-honest-out-")), debounceMs: 30 });
    try {
      await Bun.sleep(300);
      const before = dev.builds();
      const r = Bun.spawnSync(["sed", "-i", "", "s/Write the ticket form/Write the intake form/", join(d, "plan.yaml")]);
      expect(r.exitCode).toBe(0);
      for (let i = 0; i < 60 && dev.builds() === before; i++) await Bun.sleep(50);
      expect(dev.builds()).toBeGreaterThan(before);
      expect(await (await fetch(dev.url + "bundle.json")).text()).toContain("Write the intake form");
    } finally { dev.close(); }
  });
});

describe("an answer says who gave it", () => {
  const Q = (extra: string) => `notes:\n  - id: N-1\n    target: { kind: unit, id: u2 }\n    kind: question\n    text: "Who sets the limit?"\n    status: answered\n    answer: "The shop."\n${extra}    author: person\n    created: "2026-10-22T09:00:00Z"\n    updated: "2026-10-22T09:30:00Z"\n`;
  test("answered_by: notes.yaml keeps who answered; an unknown value is a problem", async () => {
    const { parseNotes, noteYaml } = await import("../src/core/notes.ts");
    const p = parseNotes(Q("    answered_by: agent\n"));
    expect(p.notes[0].answered_by).toBe("agent");
    expect(noteYaml(p.notes[0])).toContain("answered_by: agent");
    expect(parseNotes(Q("    answered_by: robot\n")).problems.join(" ")).toContain("answered_by");
  });
  test("answered_by: the note card says “Answered by Claude” for an agent's answer, and never presents it as the asker's", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { renderSite } = await import("../src/site/render.ts");
    const d = miniCopy((dir) => wf(join(dir, "notes.yaml"), Q("    answered_by: agent\n")));
    const { bundle } = await buildBundle(d);
    const doc = renderSite(bundle);
    const i = doc.indexOf("</script>", doc.indexOf('id="de-bundle"')), o = doc.indexOf("<script>", i);
    const DE = new Function(doc.slice(o + 8, doc.indexOf("</script>", o)) + "\n;return DE;")();
    const ix = DE.buildIndex(bundle);
    const card = DE.noteCard(ix, bundle.notes!.items[0], {});
    expect(card).toContain("Answered by Claude");
    const d2 = miniCopy((dir) => wf(join(dir, "notes.yaml"), Q("")));
    const b2 = (await buildBundle(d2)).bundle;
    expect(DE.noteCard(DE.buildIndex(b2), b2.notes!.items[0], {})).toContain("who answered is not recorded");
  });
  test("answered_by: an answer written from the page is recorded as a person's", async () => {
    const { handleNotes, newToken } = await import("../src/dev/notes-api.ts");
    const { parseNotes, notesVersion } = await import("../src/core/notes.ts");
    const { buildBundle } = await import("../src/core/bundle.ts");
    const d = miniCopy((dir) => wf(join(dir, "notes.yaml"), "notes:\n  - id: N-1\n    target: { kind: unit, id: u2 }\n    kind: question\n    text: \"Who sets the limit?\"\n    status: open\n    author: person\n    created: \"2026-10-22T09:00:00Z\"\n    updated: \"2026-10-22T09:00:00Z\"\n"));
    const token = newToken(), { bundle } = await buildBundle(d);
    const version = notesVersion(rf(join(d, "notes.yaml"), "utf8"));
    const res = await handleNotes(new Request("http://127.0.0.1:4999/__de/notes", { method: "POST", headers: { host: "127.0.0.1:4999", origin: "http://127.0.0.1:4999", "content-type": "application/json", "x-de-token": token }, body: JSON.stringify({ op: "answer", version, id: "N-1", answer: "The shop." }) }), { dir: d, token, port: () => 4999, bundle: () => bundle });
    expect(res.status).toBe(200);
    expect(parseNotes(rf(join(d, "notes.yaml"), "utf8")).notes[0].answered_by).toBe("person");
  });
});

describe.skipIf(!HAVE_MCP_SERVER)("the MCP server reads a rebuilt bundle", () => {
  test("MCP re-read: once the bundle file changes after the server loaded it, the next answer reads it and says so once", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { bundle } = await buildBundle(MINI, { built: "2026-01-01T00:00:00Z" });
    const path = join(mkdtempSync(join(tmpdir(), "plumb-honest-mcp-")), "bundle.json");
    await Bun.write(path, JSON.stringify(bundle));
    const s = Bun.spawn(["bun", new URL("../src/mcp/server.ts", import.meta.url).pathname, path], { stdin: "pipe", stdout: "pipe" });
    const reader = s.stdout.getReader(), dec = new TextDecoder();
    let buf = "";
    const next = async (): Promise<any> => {
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); return JSON.parse(line); }
        const r = await reader.read(); if (r.done) throw new Error("server closed"); buf += dec.decode(r.value, { stream: true });
      }
    };
    const ask = async (id: number) => { s.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "overview", arguments: {} } }) + "\n"); s.stdin.flush(); return (await next()).result.content[0].text as string; };
    s.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'); s.stdin.flush(); await next();
    expect(await ask(2)).not.toMatch(/stale|changed since/i);
    await Bun.sleep(20);
    await Bun.write(path, JSON.stringify({ ...bundle, engine: { ...bundle.engine, built: "2026-01-02T00:00:00Z" } }));
    const a3 = await ask(3), a4 = await ask(4);
    expect(a3).toMatch(/^Note: the bundle was rebuilt; this answer reads the new build \(2026-01-02T00:00:00Z; the server had 2026-01-01T00:00:00Z\)/);
    expect(a4).not.toMatch(/^(Note|Warning): /);
    s.stdin.end(); s.kill();
  });
});

describe("dev never overwrites the repository's build with an instance from elsewhere", () => {
  test("dev --out guard: an instance outside the repository needs --out; with it, the build goes there", async () => {
    const { startDev } = await import("../src/dev/server.ts");
    const d = miniCopy();
    await expect(startDev(d, { port: 0 })).rejects.toThrow(/outside this repository.*--out/);
    const out = mkdtempSync(join(tmpdir(), "plumb-honest-out-"));
    const dev = await startDev(d, { port: 0, outDir: out });
    dev.close();
    expect(rf(join(out, "index.html"), "utf8")).toContain("<!doctype html>");
  });
  test("dev --out guard: the CLI refuses without --out and says how", () => {
    const ROOT = new URL("..", import.meta.url).pathname;
    const r = Bun.spawnSync(["bun", ROOT + "plumb.ts", "dev", miniCopy(), "--port", "0"], { cwd: ROOT, timeout: 15000 });
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toMatch(/--out/);
  });
});

describe("a page that ignores the milestone filter says so", () => {
  test("not applied here: Teams and Tracker name the milestone chip as not applied, with why; Plan does not", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { renderSite } = await import("../src/site/render.ts");
    const ROOT = new URL("..", import.meta.url).pathname;
    const { bundle } = await buildBundle(DS_DIR, { built: "2026-10-22T10:00:00.000Z" });
    const doc = renderSite(bundle);
    const i = doc.indexOf("</script>", doc.indexOf('id="de-bundle"')), o = doc.indexOf("<script>", i);
    const DE = new Function(doc.slice(o + 8, doc.indexOf("</script>", o)) + "\n;return DE;")();
    const F = { milestone: ["SEE"] };
    for (const page of ["teams", "tracker"]) {
      const xs = DE.notAppliedHere(page, F);
      expect(xs.map((x: any) => x.key)).toEqual(["milestone"]);
      expect(xs[0].note).toMatch(/every milestone/);
    }
    expect(DE.notAppliedHere("plan", F)).toEqual([]);
    expect(DE.notAppliedHere("teams", {})).toEqual([]);
    expect(doc).toContain("(not applied here)"); // the chip says it, in the client the page carries
  });
});
