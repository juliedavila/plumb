// Teams and roles: owners and verifiers from the team registry, inherited by units from the parts they change, with
// overrides recorded; unassigned work as a finding counted per gate and listed for the current gate only; the
// waits-on map, the team load, and separation of duties as a team-level proxy.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { teamFacts, unitRoles, teamSettings } from "../src/core/teams.ts";
import { buildBundle } from "../src/core/bundle.ts";
import { analyzePlan } from "../src/core/plan.ts";
import { renderSite, index, planBrief, unassignedSplit } from "../src/site/render.ts";
import { teamsPage } from "../src/site/teams.ts";
import { loadTeamMap, normaliseOwners } from "../src/design/teams.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Bundle } from "../src/types.ts";
import { CLIENT_JS } from "../src/site/render.ts";
import { config, E, model, PH, plan, run, T, U } from "./core-helpers.ts";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = join(import.meta.dir, "..");
const DE = new Function(`${CLIENT_JS}; return DE;`)();

const m = model({
  teams: [T("t1"), T("t2"), T("t3")],
  elements: [E("a", { owner: "t1", verifier: "t2" }), E("b", { owner: "t2", verifier: "t2" }), E("c", { owner: undefined }), E("d", { owner: "t1" })] });
const p = plan({
  phases: [PH("ph1", 1), PH("ph2", 2)],
  units: [
    U("U1", { elements: [{ id: "a", from: "none", to: "built" }], provides: ["x"] }),                       // parts: t1, verifier t2
    U("U2", { elements: [{ id: "a", from: "none", to: "built" }, { id: "b", from: "none", to: "built" }], requires: ["x"] }), // both t1 and t2
    U("U3", { elements: [{ id: "a", from: "none", to: "built" }], owner: "t3", requires: ["x"] }),           // override
    U("U4", { elements: [{ id: "a", from: "none", to: "built" }], owner: "t1" }),                            // repeats its part: inherited
    U("U5", { owner: "t2", phase: "ph2" }),                                                                  // no parts: declared
    U("U6", { elements: [{ id: "c", from: "none", to: "built" }], phase: "ph2" }),                           // only an unowned part
    U("U7", { phase: "ph2" }),                                                                                // nothing at all
    U("U8", { phase: "ph2", status: "done" }),                                                                // done, unassigned
  ] });

describe("inheritance", () => {
  const r = unitRoles(m, p);
  test("a unit takes the owner and verifier of the parts it changes", () => {
    expect(r.U1).toEqual({ owners: ["t1"], ownerSource: "parts", verifiers: ["t2"], verifierSource: "parts" });
  });
  test("parts with different owners: the unit lists all of them, in registry order", () => {
    expect(r.U2.owners).toEqual(["t1", "t2"]);
    expect(r.U2.verifiers).toEqual(["t2"]);
  });
  test("an owner that differs from the parts is an override; one that repeats them is inherited", () => {
    expect(r.U3).toMatchObject({ owners: ["t3"], ownerSource: "override" });
    expect(r.U4).toMatchObject({ owners: ["t1"], ownerSource: "parts" });
  });
  test("a unit with no owned part keeps its own owner, else it has none", () => {
    expect(r.U5).toMatchObject({ owners: ["t2"], ownerSource: "declared" });
    expect(r.U6).toMatchObject({ owners: [], ownerSource: "none" });
    expect(r.U7).toMatchObject({ owners: [], ownerSource: "none", verifierSource: "none" });
  });
});

describe("findings", () => {
  test("an open unit with no owner team is unassigned; a done one is not reported", async () => {
    const fs = await run("teams", "unit-has-owner", m, p);
    expect(fs.map((f) => f.at)).toEqual(["U6", "U7"]);
    expect(fs[0].message).toBe("unit U6 has no owner team: the part it changes has none, and it names none");
    expect(fs[1].message).toBe("unit U7 has no owner team: it changes no part and names none");
  });
  test("a verifier must name a declared team", async () => {
    const mm = model({ teams: [T("t1")], elements: [E("a", { verifier: "ghost" })] });
    const fs = await run("teams", "verifier-team-exists", mm, plan({ phases: [PH("ph1", 1)], units: [U("U1", { verifier: "nobody" })] }));
    expect(fs.map((f) => `${f.atKind}:${f.at}`)).toEqual(["element:a", "unit:U1"]);
  });
  test("an owner that names no declared team is an error (generic for parts, plan for units)", async () => {
    const mm = model({ teams: [T("t1")], elements: [E("a", { owner: "ghost" })] });
    expect((await run("generic", "references-resolve", mm)).map((f) => f.message)).toContain('element a names owner team "ghost", which does not exist');
    expect((await run("plan", "unit-owner-exists", mm, plan({ phases: [PH("ph1", 1)], units: [U("U1", { owner: "ghost" })] }))).length).toBe(1);
  });
  test("unassigned units are counted per gate", () => {
    const f = teamFacts(m, p, config(), analyzePlan(p));
    expect(f.unassigned).toEqual([{ phase: "ph1", units: [], open: 0 }, { phase: "ph2", units: ["U6", "U7", "U8"], open: 2 }]);
    expect(f.unownedParts).toEqual(["c"]);
  });
});

describe("the instances", () => {
  test("delivery stream: every part has an owner; units name an owner only where they differ from their parts", async () => {
    const { bundle: b } = await buildBundle(DS_DIR);
    expect(b.teams!.unownedParts).toEqual([]);
    for (const u of b.plan.units) {
      const r = b.teams!.units[u.id];
      if (u.owner) expect(["override", "declared"]).toContain(r.ownerSource);
      expect(r.owners.length).toBeGreaterThan(0);
    }
    expect(b.teams!.units["U-18"].ownerSource).toBe("override");
    expect(b.findings.some((f) => f.pack === "teams" && f.rule === "unit-has-owner")).toBe(false);
  });
});

describe("on the page", () => {
  test("a unit's detail says who owns and verifies it, and where that comes from", () => {
    const b = { model: { ...m, claims: [] }, plan: p, analysis: analyzePlan(p), findings: [], patches: [], layouts: [], instance: { packs: [] }, teams: teamFacts(m, p, config(), analyzePlan(p)) };
    const ix = DE.buildIndex(b);
    const h1 = DE.unitDetail(ix, "U1");
    expect(h1).toContain("<dt>Owner team</dt><dd>t1 <span class=\"muted small\">(from the parts it changes)</span>");
    expect(h1).toContain("<dt>Verified by</dt><dd>t2");
    expect(DE.unitDetail(ix, "U3")).toContain("an override: its parts say t1");
    expect(DE.unitDetail(ix, "U5")).toContain("named on the unit, which changes no part with one");
    expect(DE.unitDetail(ix, "U7")).toContain("No owner team</a>");
    expect(DE.unitDetail(ix, "U2")).toContain("<dd>t1 and t2 ");
    expect(DE.elementDetail(ix, "a")).toContain("Verified by t2");
  });
  test("the plan table shows inherited owners and filters by any of them", async () => {
    const { bundle: b } = await buildBundle(DS_DIR);
    const html = renderSite(b);
    const row = /<tr id="unit-U-02"[^>]*data-owner="([^"]*)"/.exec(html);
    expect(row![1]).toBe("platform");
    expect(planBrief(index(b))).not.toContain("owner team");
  });
});

describe("settings", () => {
  test("teams.max_share and the role map come from engine.yaml, with defaults", () => {
    expect(teamSettings(config()).maxShare).toBe(0.4);
    expect(teamSettings(config({ teams: { max_share: 0.25, role_map: { author: "owner", checker: "verifier", bogus: "x" } } })).roleMap)
      .toMatchObject({ author: "owner", checker: "verifier", proposer: "owner", verifier: "verifier" });
    expect(teamSettings(config({ teams: { max_share: 7 } })).maxShare).toBe(0.4);
  });
});

describe("waits on, load, roles by gate", () => {
  const f = teamFacts(m, p, config(), analyzePlan(p));
  test("team A waits on team B when an open unit of A's depends on a unit of B's", () => {
    // U2 (t1 and t2) and U3 (t3) need x from U1 (t1): t2 waits on t1, t3 waits on t1; t1 never waits on itself
    expect(f.waitsOn.map((e) => `${e.from}>${e.to}:${e.count}`)).toEqual(["t2>t1:1", "t3>t1:1"]);
    expect(f.waitsOn[1].pairs).toEqual([["U3", "U1"]]);
  });
  test("load is each team's open units and share; over the threshold is a finding, counts before the percentage", async () => {
    expect(f.load.find((l) => l.team === "t1")).toEqual({ team: "t1", open: 3, share: 0.429 }); // U1, U2 and U4; U3 overrides to t3
    const fs = await run("teams", "team-load", m, p, config({ teams: { max_share: 0.5 } }));
    expect(fs).toEqual([]);
    expect(await run("teams", "team-load", m, p)).toEqual([{ at: "t1", atKind: "team", message: "team t1 owns 3 of the 7 open units (43%), more than the 40% this instance allows" }]);
  });
  test("roles by gate count owned and verified units per team", () => {
    const t1 = f.byGate.find((r) => r.team === "t1")!;
    expect(t1.gates).toEqual({ ph1: { owner: 3, verifier: 0 } });
    expect(f.byGate.find((r) => r.team === "t2")!.gates).toEqual({ ph1: { owner: 1, verifier: 4 }, ph2: { owner: 1, verifier: 0 } });
  });
  test("the Teams page: the map, the load table, roles by gate and the labelled proxy", async () => {
    const { bundle: b } = await buildBundle(DS_DIR);
    const html = renderSite(b);
    const page = html.slice(html.indexOf('id="teams" data-page="teams"'), html.indexOf("</section>\n", html.indexOf('id="h-sep"')));
    expect(page).toContain("<caption class=\"sr-only\">Team waits on team: open dependencies between units</caption>");
    expect(page).toMatch(/<b>Product<\/b> waits on <b>Platform<\/b>/);
    expect(page).toContain("5 of 17 (29%)");
    expect(page).toContain('href="#checks/rule/teams/team-load">Over 25%</a>');
    expect(page).toContain("A team-level proxy.");
    expect(page).toMatch(/Code review<\/a> <span class="small fg2">owned and verified by Engineering/);
    expect(html).toContain('data-nav="teams">Teams <span class="badge warning">3');
    expect(b.findings.filter((x) => x.rule === "team-load").map((x) => x.at)).toEqual(["platform", "product"]);
  });
});

describe("separation of duties (team-level proxy)", () => {
  test("a part owned and verified by one team is a finding", async () => {
    expect((await run("teams", "separation-of-duties", m, p)).map((x) => x.message)).toEqual(["part b is owned and verified by the same team, t2"]);
  });
  test("unit role pairs that map to owner and verifier are checked; others are counted, not guessed", async () => {
    const mm = model({ teams: [T("t1"), T("t2")], elements: [E("a", { owner: "t1", verifier: "t1" }), E("b", { owner: "t1", verifier: "t2" })] });
    const pp = plan({ phases: [PH("ph1", 1)], units: [
      U("U1", { elements: [{ id: "a", from: "none", to: "built" }], attrs: { separates: [["proposer", "verifier"], ["proposer", "approver"]] } }),
      U("U2", { elements: [{ id: "b", from: "none", to: "built" }], attrs: { separates: [["verifier", "proposer"]] } }),
      U("U3", { attrs: { separates: [["proposer", "verifier"]] } }),
    ] });
    const f = teamFacts(mm, pp, config(), analyzePlan(pp));
    expect(f.separation).toMatchObject({ checkedPairs: 2, unmappedPairs: 1, unassignedPairs: 1, pairs: [{ unit: "U1", roles: ["proposer", "verifier"], team: "t1" }] });
    const fs = await run("teams", "separation-of-duties", mm, pp);
    expect(fs.map((x) => x.message)).toContain("unit U1 must separate proposer and verifier (owner and verifier), and team t1 holds both");
  });
});

describe("contact details in free text", () => {
  test("an email address or an @handle in a note, a claim or a patch's why is a warning that says where, not what", async () => {
    const { buildContext } = await import("../src/core/rules.ts");
    const { pack: generic, contactKind } = await import("../packs/generic/index.ts");
    expect(contactKind("ask someone@example.org")).toBe("an email address");
    expect(contactKind("ping @lead-dev about it")).toBe("an @handle");
    expect(contactKind("(@ops) knows")).toBe("an @handle");
    expect(contactKind("pack/rule@U-05 and a@b")).toBeUndefined();   // finding ids and bare @ are not handles
    expect(contactKind("costs 3 @ 5 each")).toBeUndefined();
    const mm = model({ claims: [{ id: "C1", statement: "Fine", kind: "premise", grade: "untested", source: "per x.y@corp.example" }] });
    const ctx = buildContext(config(), mm, plan(), undefined, {
      notes: [{ id: "N-1", target: { kind: "claim", id: "C1" }, kind: "note", text: "cc @someone", status: "open", author: "person", created: "", updated: "" }],
      patches: [{ id: "P-1", why: "as agreed with a@b.example" }] });
    const fs = generic.rules.find((r) => r.id === "no-contact-details")!.check(ctx);
    expect(fs.map((f) => f.message)).toEqual(["note N-1 has an @handle in its text", "claim C1 has an email address in its source", "patch P-1 has an email address in its why"]);
    for (const f of fs) expect(f.message).not.toMatch(/someone|corp|a@b/);
  });
});

// A verifier never also owns the part, a part's `not:` list names the
// teams it must stay independent of, a decider is a structured field a role pair can read, parts with no named verifier
// are "not assessed" (never a pass), and the load counts owners only.
describe("separation of duties: co-owners, exclusions, deciders, not assessed", () => {
  const mm = model({
    teams: [T("t1"), T("t2"), T("t3")],
    elements: [
      E("ok", { owner: "t1", verifier: "t2" }),
      E("co", { owner: "t1", verifier: "t2", attrs: { owner_teams: ["t1", "t2"] } }),
      E("ex", { owner: "t1", verifier: "t3", attrs: { not: ["t3"] } }),
      E("own-ex", { owner: "t2", attrs: { not: ["t2"] } }),
      E("none", { owner: "t1" }),
      E("bare", { owner: undefined }),
    ] });
  const f = teamFacts(mm, plan(), config(), { deps: {} });
  test("a verifier among the owner teams or in the part's not: list fails; an owner in its not: list fails too", async () => {
    expect(f.separation.parts).toEqual([
      { part: "co", team: "t2", reason: "co-owner" },
      { part: "ex", team: "t3", reason: "excluded" },
      { part: "own-ex", team: "t2", reason: "excluded-owner" },
    ]);
    expect((await run("teams", "separation-of-duties", mm)).map((x) => x.message)).toEqual([
      "part co is co-owned and verified by the same team, t2",
      "part ex is verified by t3, a team it must stay independent of",
      "part own-ex is owned by t2, a team it must stay independent of",
    ]);
  });
  test("parts with no named verifier are not assessed, never passed", () => {
    expect(f.separation).toMatchObject({ checkedParts: 3, passedParts: 1, failedParts: 2, notAssessedParts: 3 });
  });
  test("a role pair may name the decider (a part's attrs.decider, one team or a list) or a role a named team holds", () => {
    const c = config({ teams: { role_map: { "decision-owner": "decider" }, role_teams: { evaluator: "t2" } } });
    expect(teamSettings(c).roleMap["decision-owner"]).toBe("decider");
    expect(teamSettings(c).roleTeams).toEqual({ evaluator: "t2" });
    const m2 = model({ teams: [T("t1"), T("t2"), T("t3")], elements: [
      E("same", { owner: "t1", attrs: { decider: "t2" } }), E("diff", { owner: "t1", attrs: { decider: ["t1", "t3"] } }), E("nod", { owner: "t1" }),
    ] });
    const pair = (id: string, part: string) => U(id, { elements: [{ id: part, from: "none", to: "built" }], attrs: { separates: [["evaluator", "decision-owner"]] } });
    const p2 = plan({ phases: [PH("ph1", 1)], units: [pair("U1", "same"), pair("U2", "diff"), pair("U3", "nod")] });
    const s = teamFacts(m2, p2, c, { deps: {} }).separation;
    expect(s).toMatchObject({ checkedPairs: 2, unassignedPairs: 1, unmappedPairs: 0, pairs: [{ unit: "U1", roles: ["evaluator", "decision-owner"], team: "t2" }] });
    expect(teamFacts(m2, p2, config(), { deps: {} }).separation.unmappedPairs).toBe(3); // without the settings nothing is guessed
  });
  test("load counts owners only: co-owners and teams named only in roles add nothing", () => {
    const m3 = model({ teams: [T("t1"), T("t2"), T("t3")], elements: [E("a", { owner: "t1", attrs: { owner_teams: ["t1", "t2"], owner_roles: { t3: "staffs the unit" }, decider: "t3" } })] });
    const p3 = plan({ phases: [PH("ph1", 1)], units: [U("U1", { elements: [{ id: "a", from: "none", to: "built" }] }), U("U2", { elements: [{ id: "a", from: "none", to: "built" }] })] });
    expect(teamFacts(m3, p3, config(), analyzePlan(p3)).load).toEqual([{ team: "t1", open: 2, share: 1 }]);
  });
  test("the Teams page says what was judged, what passed and what was not assessed, as a team-level proxy", () => {
    const b = { model: { ...mm, claims: [] }, plan: plan(), analysis: analyzePlan(plan()), findings: [], patches: [], layouts: [], instance: { packs: [] }, teams: f } as unknown as Bundle;
    const html = teamsPage(b);
    const sep = html.slice(html.indexOf('id="h-sep"'));
    expect(sep).toContain("A team-level proxy.");
    expect(sep).toContain("Judged on the 3 parts that name a verifier: 1 passes and 2 fail. Not assessed on the other 3 parts, which name no verifier");
    expect(sep).toContain("co-owned and verified by t2");
    expect(sep).toContain("verified by t3, which it must stay independent of");
  });
});

describe("the team map's decider, not: lists and unit roles reach the import", () => {
  test("loadTeamMap reads decider (one team or a list), not and unit_roles, and refuses undeclared teams", () => {
    const d = mkdtempSync(join(tmpdir(), "plumb-tm-"));
    const f = join(d, "team-map.yaml");
    writeFileSync(f, `teams:\n  - { id: a, name: A }\n  - { id: b, name: B }\n  - { id: c, name: C }\nunit_roles:\n  decision-owner: decider\n  evaluator: c\nowners:\n  "A runs it": { teams: [a], decider: b, not: [c] }\n  "A and B": { teams: [a, b], decider: [b, c] }\n`);
    const tm = loadTeamMap(f);
    expect(tm.owners["A runs it"]).toEqual({ teams: ["a"], decider: ["b"], not: ["c"] });
    expect(tm.owners["A and B"].decider).toEqual(["b", "c"]);
    expect(tm.unitRoles).toEqual({ roleMap: { "decision-owner": "decider" }, roleTeams: { evaluator: "c" } });
    writeFileSync(f, `teams:\n  - { id: a, name: A }\nowners:\n  "A": { teams: [a], not: [ghost] }\n`);
    expect(() => loadTeamMap(f)).toThrow(/undeclared team ghost/);
  });
  test("a team named only as a decider, an exclusion, a role or a unit role stays in the registry", () => {
    const tm = { teams: [T("a"), T("b"), T("c"), T("d"), T("e")], owners: { s: { teams: ["a"], decider: ["b"], not: ["c"], roles: { d: "staffs" } } }, unitRoles: { roleMap: {}, roleTeams: { evaluator: "e" } } };
    expect(normaliseOwners(["s"], tm).teams.map((t) => t.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

