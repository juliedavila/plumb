// Learn the interface: a second, generic tour on any instance, one step per move, its targets picked from the bundle
// that is open. The tests run the pure builder over both instances and the hand-made sample.
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle";
import { renderSite } from "../src/site/render";
import type { Bundle } from "../src/types";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const ds = (await buildBundle(DS_DIR, { built: "2026-10-21T10:00:00.000Z" })).bundle;
const sample: Bundle = await Bun.file(join(ROOT, "tests/fixtures/sample-bundle.json")).json();
const clientOf = (doc: string): any => { const D = '<script type="application/json" id="de-bundle">'; const i = doc.indexOf("</script>", doc.indexOf(D)), o = doc.indexOf("<script>", i); return new Function(doc.slice(o + 8, doc.indexOf("</script>", o)) + "\n;return DE;")(); };
const DE = clientOf(renderSite(ds));

describe("Learn the interface", () => {
  for (const [name, b] of [["delivery-stream", ds], ["sample", sample]] as const) {
    test(`${name}: every step lands on a page the build has, and every record it acts on exists`, () => {
      const ix = DE.buildIndex(b), t = DE.learnTour(ix);
      expect(t.title).toBe("Learn the interface");
      for (const s of t.steps) {
        const r = DE.parseRoute(s.hash);
        expect(["overview", "model", "plan", "present"]).toContain(r.page);
        expect(s.title.length).toBeGreaterThan(5);
        expect(s.say).toMatch(/[.!?]$/);
        for (const ref of [s.ref, s.ref2].filter(Boolean)) { const [k, ...id] = ref.split(":"); expect(DE.recordOf(ix, k, id.join(":"))).not.toBeNull(); }
      }
    });
  }
  test("one step per move, in order, with real targets from the instance", () => {
    const t = DE.learnTour(DE.buildIndex(ds));
    expect(t.steps.map((s: any) => s.title)).toEqual([
      "Hover over a reference for its card", "Click it for a drawer", "Open a second drawer on top", "Escape steps back",
      "Set a filter chip", "The chip carries to another page", "Follow a link", "Climb the crumbs",
      "Open a zone from the Overview", "A zone's own drawing", "Switch the work area with a tile", "Present mode", "Leave it",
    ]);
    expect(t.steps.map((s: any) => s.act ?? "")).toEqual(["hover", "drawer", "stack", "drawer", "", "", "", "", "", "", "", "", ""]);
    // the unit that unblocks the most, its owner team as the chip, a part it changes as the second drawer
    const top = DE.rankedFrontier(DE.buildIndex(ds))[0].id;
    expect(t.steps[0].ref).toBe(`unit:${top}`);
    const owner = ds.teams!.units[top].owners[0];
    expect(t.steps[4].hash).toBe(`#plan/units?owner=${owner}`);
    expect(t.steps[5].hash).toBe(`#model/elements?owner=${owner}`);
    expect(t.steps[2].ref2).toMatch(/^(element|phase):/); // a part it changes, else its milestone
    expect(DE.parseRoute(t.steps[6].hash).raw.trail).toBe(`unit!owner=${owner}~parts`);
    expect(t.steps[7].hash).toBe(`#plan/units?owner=${owner}`);
    expect(t.steps[11].hash).toBe("#present/2");
  });
  test("a bundle with no deck, no zones and no teams still gets a tour that ends on the sheet of keys", () => {
    const t = DE.learnTour(DE.buildIndex(sample));
    expect(t.steps.at(-1).title).toBe("Every key and move");
    expect(t.steps.some((s: any) => s.act === "hover")).toBe(true);
  });
  test("the route: #learn/<n> beside #tour/<n>, and the page offers both tours", () => {
    expect(DE.parseRoute("#learn/3")).toMatchObject({ page: "learn", n: 3 });
    expect(DE.parseRoute("#tour/2")).toMatchObject({ page: "tour", n: 2 });
    expect(DE.carryState({ st: { f: { zone: ["x"] } }, route: { page: "plan" } }, "#learn/2")).toBe("#learn/2");
  });
});
