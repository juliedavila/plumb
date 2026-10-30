// The Teams page for leadership: a team, clicked anywhere, opens its card and sets the owner filter so its open work
// lists; who waits on whom is drawn (teams as boxes, an arrow from the team that waits, labelled with the count), each
// arrow listing its dependencies as sentences with titles first; roles by milestone, named and explained.
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle";
import { renderSite } from "../src/site/render";
import { teamsPage, waitSentence, waitsDiagram } from "../src/site/teams";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const ds = (await buildBundle(DS_DIR, { built: "2026-10-21T10:00:00.000Z" })).bundle;
const page = teamsPage(ds);

describe("teams open from anywhere", () => {
  test("every team name on the page, in the table, the drawing, the matrix and the roles, opens the team", () => {
    for (const t of ["product", "platform", "engineering"]) {
      expect(page).toContain(`<a class="team-open" href="#teams?owner=${t}" data-team-open="${t}" data-ref="team:${t}">`);
      expect(page).toContain(`<g class="tnode" data-team-open="${t}"`);
    }
    const roles = page.slice(page.indexOf('class="roles-table"'));
    expect(roles).toContain('data-team-open="product"');
    const matrix = page.slice(page.indexOf('class="waits-matrix"'), page.indexOf("</table>", page.indexOf('class="waits-matrix"')));
    expect(matrix).toContain('data-team-open="platform"');
  });
  test("a team in a path to green opens it too; the page holds the section its open work lists in", () => {
    const html = renderSite(ds);
    expect(html).toMatch(/class="team-chip" href="#teams\?owner=platform" data-team-open="platform"/);
    expect(page).toContain('<section class="section team-work" id="team-work" aria-labelledby="h-team-work" hidden>');
  });
  test("the client: a team goes to the Teams page with its owner filter, keeping the others", () => {
    const doc = renderSite(ds), D = '<script type="application/json" id="de-bundle">';
    const i = doc.indexOf("</script>", doc.indexOf(D)), o = doc.indexOf("<script>", i);
    const DE = new Function(doc.slice(o + 8, doc.indexOf("</script>", o)) + "\n;return DE;")();
    expect(typeof DE.teamsPageCtl).toBe("function");
    expect(DE.withState("#teams", { f: { owner: ["product"], zone: ["live"] } })).toBe("#teams?zone=live&owner=product");
  });
});

describe("who waits on whom, drawn", () => {
  test("teams as boxes and an arrow from the waiting team to the one it waits on, labelled with the count", () => {
    const d = waitsDiagram(ds, ds.teams!);
    expect(d.shown.length).toBe(7);
    const pp = ds.teams!.waitsOn.find((e) => e.from === "product" && e.to === "platform")!;
    expect(d.svg).toContain(`<g class="wedge" data-wait="product|platform" tabindex="0" role="button" aria-label="Product waits on Platform: ${pp.count} dependencies. Show them."`);
    expect(d.svg).toContain('marker-end="url(#wa-head)"');
    expect(d.svg).toMatch(new RegExp(`data-wait="product\\|platform"[\\s\\S]*?<text[^>]*>${pp.count}</text>`));
  });
  test("an arrow lists its dependencies as sentences, titles first and ids after", () => {
    expect(waitSentence(ds, "product", "platform", "U-05", "U-02")).toBe(`Product's <a href="#plan/unit/U-05" data-unit="U-05">“Walk one change from idea to production”</a> waits on Platform's <a href="#plan/unit/U-02" data-unit="U-02">“Record the wait at each step”</a> <span class="id small">U-05 → U-02</span>`);
    expect(page).toContain('<div class="wait-list" data-wait-list="product|platform" hidden><h3>Product waits on Platform');
  });
  test("roles by milestone: milestones by name, owner and verifier explained in a line", () => {
    expect(page).toContain("The owner does the work and answers for it; the verifier checks it independently before it counts as done.");
    expect(page).toContain('<th scope="col" class="n">See the stream</th>');
    expect(page).not.toMatch(/Gate \d|Milestone \d/);
  });
});
