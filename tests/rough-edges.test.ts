// The two drawings rebuilt for scale: the merged change drawing a patch gets,
// and the two-sided neighbourhood tree at depth 2. Their invariants, on the real instances.
import { test, expect, describe } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { MINI } from "./core-helpers.ts";
import { join } from "node:path";
import { renderSite } from "../src/site/render";
import { buildBundle } from "../src/core/bundle";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const ds = (await buildBundle(DS_DIR, { built: "2026-10-21T10:00:00.000Z" })).bundle;
const fixture = mkdtempSync(join(tmpdir(),"plumb-drawings-"));
cpSync(MINI,fixture,{recursive:true});
const elements = [{id:"hub",name:"Repair dispatch",kind:"store",owner:"shop"}];
const relationships: any[] = [];
for(let i=0;i<6;i++){
  elements.push({id:`branch-${i}`,name:`Service desk ${i}`,kind:"service",owner:"shop"});
  relationships.push({id:`r-${i}`,from:"hub",to:`branch-${i}`,kind:"data"});
  for(let j=0;j<(i<2?8:4);j++){
    const id=`leaf-${i}-${j}`;elements.push({id,name:`Repair station ${i}-${j}`,kind:"service",owner:"shop"});
    relationships.push({id:`r-leaf-${i}-${j}`,from:`branch-${i}`,to:id,kind:"data"});
  }
}
relationships.push({id:"cross",from:"branch-0",to:"branch-1",kind:"data"});
const views=Array.from({length:10},(_,i)=>({id:`v-${i}`,title:`Service view ${i}`,elements:elements.map(e=>e.id)}));
writeFileSync(join(fixture,"model.yaml"),Bun.YAML.stringify({teams:[{id:"shop",name:"Workshop"}],systems:[],zones:[],elements,relationships,contracts:[],views},null,2));
writeFileSync(join(fixture,"plan.yaml"),"phases: []\nunits: []\n");
writeFileSync(join(fixture,"engine.yaml"),"name: repairs\ntitle: Repair dispatch\npacks: [generic]\n");
writeFileSync(join(fixture,"patches/P-DROP.yaml"),"id: P-DROP\ntitle: Retire dispatch\nwhy: Service desks dispatch directly.\nstatus: proposed\nops: [{op: remove, kind: element, id: hub}]\n");
const dispatch = (await buildBundle(fixture,{built:"test"})).bundle;
const DATA_OPEN = '<script type="application/json" id="de-bundle">';
const clientOf = (doc: string): any => { const i = doc.indexOf("</script>", doc.indexOf(DATA_OPEN)); const open = doc.indexOf("<script>", i); return new Function(doc.slice(open + 8, doc.indexOf("</script>", open)) + "\n;return DE;")(); };

describe("the change drawing", () => {
  const p2 = dispatch.patches.find((p) => p.id === "P-DROP")!.impact.drawing!;
  test("Retiring dispatch draws the hub and its direct neighbours", () => {
    expect(p2.change!.centre).toEqual(["hub"]);
    expect(p2.change!.elements.length).toBe(7);
    expect(p2.change!.removedRelationships.length).toBe(6);
    expect(p2.change!.layout.nodes.length).toBe(7);
  });
  test("the three columns keep every line off the middle column", () => {
    const L = p2.change!.layout, mid = L.nodes.find((n) => n.id === "hub")!;
    for (const n of L.nodes) if (n.id !== mid.id) expect(n.x + n.w <= mid.x || n.x >= mid.x + mid.w).toBe(true);
    for (const e of L.edges) for (const [x, y] of e.points) expect(x <= mid.x || x >= mid.x + mid.w || y < mid.y || y > mid.y + mid.h || e.from === mid.id || e.to === mid.id).toBe(true);
  });
  test("the phone form is one column under 400 px wide", () => {
    const N = p2.change!.narrow!;
    expect(N.width).toBeLessThan(400);
    expect(new Set(N.nodes.map((n) => n.x)).size).toBe(1);
  });
  test("relationships a patch adds between neighbours are drawn (the delivery stream's new hand-off)", () => {
    const ch = ds.patches.find((p) => p.id === "P-001")!.impact.drawing!.change!;
    expect(ch.addedRelationships.length).toBe(2);
    for (const id of ch.addedRelationships) expect(ch.layout.edges.some((e) => e.id === id)).toBe(true);
  });
  test("the views table lists each changed view once, with what it loses", () => {
    expect(p2.views!.length).toBe(10);
    expect(new Set(p2.views!.map((v) => v.view)).size).toBe(10);
    for (const v of p2.views!) expect(v.elementsRemoved).toEqual(["hub"]);
  });
});

describe("the depth-2 neighbourhood", () => {
  const DE = clientOf(renderSite(dispatch));
  const ix = DE.buildIndex(dispatch);
  const D = DE.focusDiagram(ix, "hub", 2, {});
  test("counts the hops: 6 direct, 32 two steps away", () => {
    expect(D.hop1).toBe(6);
    expect(D.hop2).toBe(32);
  });
  test("stays bounded: five per branch, then a +N more box", () => {
    expect(D.nodes.length).toBeLessThanOrEqual(40);
    const stubs = D.nodes.filter((n: any) => n.stub);
    expect(stubs.length).toBeGreaterThan(0);
    for (const s of stubs) expect(s.label).toMatch(/^\+\d+ more$/);
  });
  test("draws only shortest-path lines at rest; the rest are hidden cross-links", () => {
    const visible = D.edges.filter((e: any) => e.cls !== "cross");
    for (const e of visible) expect(Math.abs(D.nodes.find((n: any) => n.id === e.from).col - D.nodes.find((n: any) => n.id === e.to).col)).toBe(1);
    expect(D.cross).toBeGreaterThan(0);
  });
  test("a +N more box opens five more", () => {
    const stub = D.nodes.find((n: any) => n.stub);
    const E = DE.focusDiagram(ix, "hub", 2, { expanded: new Set([stub.stub.key]) });
    expect(E.nodes.filter((n: any) => !n.stub).length).toBeGreaterThan(D.nodes.filter((n: any) => !n.stub).length);
  });
  test("depth 1 keeps the links between neighbours", () => {
    const D1 = DE.focusDiagram(ix, "hub", 1, {});
    expect(D1.hop2).toBe(0);
    expect(D1.edges.every((e: any) => e.cls !== "cross")).toBe(true);
  });
});
