import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { portfolioPages, writePortfolioPages } from "../src/site/portfolio-build.ts";
import { renderPortfolio } from "../src/site/portfolio.ts";
import { CLIENT_JS, renderSite } from "../src/site/render.ts";
import { briefMd } from "../src/core/brief-cli.ts";
import { portfolioBriefMd } from "../src/core/portfolio-brief.ts";
import { capabilityName, readerUnitTitle } from "../src/core/reader.ts";
import { inventoryChanges } from "../src/tracker/inventory-diff.ts";
import { discoverJira } from "../src/tracker/jira/discover.ts";
import { readRaw } from "../src/tracker/raw.ts";
import { EX_DIR } from "./example-dirs.ts";

const ROOT = join(import.meta.dir, "..");
const BUILT = "2026-11-16T10:00:00.000Z";
const client = new Function(`${CLIENT_JS}\nreturn DE;`)();
const targets = [join(EX_DIR, "portfolio")];
const portfolios = await Promise.all(targets.map((target) => portfolioPages(target, { built: BUILT })));

/** Inspect prose everywhere, including disclosures. Only code, scripts, styles and attributes may hold ids. */
function prose(html: string): string {
  return html.replace(/<(script|style|code)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}
function prefixedIds(text: string): string[] {
  return [...new Set(text.match(/\b[a-z][a-z0-9-]{0,23}:[a-z0-9][a-z0-9_.\/-]*/gi) ?? [])];
}
const roadmapOf = (html: string) => html.slice(html.indexOf('<section class="section" id="roadmap"'), html.indexOf('<section class="section" id="load"'));

describe("phase roadmaps", () => {

  test("mixed plans keep dated and overdue milestones on the grid with undated and reached phases below", () => {
    const data = structuredClone(portfolios[0].data);
    const row = data.page!.roadmap.rows[0];
    const original = row.milestones[0];
    row.milestones = [
      { ...original, id: "test:early", name: "An earlier target", target: "2026-10-01", month: "2026-10", late: true, reached: false },
      { ...original, id: "test:dated", name: "A dated milestone", target: "2026-12-01", month: "2026-12", reached: false },
      { ...original, id: "test:phase", name: "An undated phase", target: undefined, month: undefined, reached: false },
      { ...original, id: "test:reached", name: "A reached phase", target: undefined, month: undefined, reached: true, open: 0 },
      { ...original, id: "test:later", name: "A later target", target: "2029-01-01", month: undefined, beyond: true, reached: false },
    ];
    data.page!.roadmap.rows = [row];
    const html = roadmapOf(renderPortfolio(data));
    const track = html.slice(html.indexOf('class="rm-track"'), html.indexOf('class="rm-phases"'));
    expect(track).toContain('data-ms="test:early"');
    expect(track).toContain('data-ms="test:dated"');
    expect(track).toContain('data-ms="test:later"');
    expect(track).not.toContain('data-ms="test:phase"');
    const strip = html.slice(html.indexOf('class="rm-phases"'));
    expect(strip).toContain('data-ms="test:phase"');
    expect(strip).toContain('data-ms="test:reached"');
    expect(strip.indexOf('data-ms="test:phase"')).toBeLessThan(strip.indexOf('data-ms="test:reached"'));
    expect(prose(strip)).toContain(`Reached · 0 of ${original.total} ${original.total === 1 ? "unit" : "units"} open`);
    expect(prose(html)).toContain("Earlier");
    expect(prose(html)).toContain("Later");
  });

  test("the dated example keeps its month grid", () => {
    const p = portfolios.find((p) => p.data.designs.some((d) => d.namespace === "intake"));
    if (!p) return;
    const html = roadmapOf(p.html);
    expect(html).toContain('class="rm-months"');
    expect(html).toContain('class="rm-track"');
    expect(html).not.toContain('class="rm-phases"');
  });
});

describe("names in rendered prose", () => {
  test("the scan permits ids only in code and attributes", () => {
    expect(prefixedIds(prose('<a href="#shared:cap.ready" data-id="org:team">Ready</a><code>shared:cap.ready</code>'))).toEqual([]);
    expect(prefixedIds(prose('<p>Waits on shared:cap.ready.</p>'))).toEqual(["shared:cap.ready."]);
  });


  for (const [i, target] of targets.entries()) test(`builds ${target.split("/").slice(-2).join("/")} with no namespaced ids in any page or brief prose`, async () => {
    for (const p of [portfolios[i], await portfolioPages(target, { built: BUILT, mode: "presenting" })]) {
      const out = mkdtempSync(join(tmpdir(), "plumb-pages-"));
      writePortfolioPages(p, out, { lock: false });
      expect(prefixedIds(prose(readFileSync(join(out, "index.html"), "utf8")))).toEqual([]);
      expect(prefixedIds((await portfolioBriefMd(target, { built: BUILT, mode: p.data.portfolio.mode })).replace(/`[^`]*`/g, ""))).toEqual([]);
      for (const d of p.designs) {
        expect(prefixedIds(prose(readFileSync(join(out, d.namespace, "index.html"), "utf8")))).toEqual([]);
        const ix = client.buildIndex(d.bundle);
        const details = [
          ...d.bundle.plan.units.map((u) => client.unitDetail(ix, u.id)),
          ...d.bundle.model.elements.map((e) => client.elementDetail(ix, e.id)),
          ...(d.bundle.model.claims ?? []).map((c) => client.claimDetail(ix, c.id)),
          ...[...ix.providers.keys()].map((c) => client.capDetail(ix, c)),
        ].join("\n");
        expect(prefixedIds(prose(details))).toEqual([]);
        const dir = p.run.designs.find((x) => x.namespace === d.namespace)!.composed!.dir;
        expect(prefixedIds((await briefMd(dir)).replace(/`[^`]*`/g, ""))).toEqual([]);
      }
    }
  }, 20000);
});

describe("discover reports inventory changes", () => {
  const inventory = discoverJira(readRaw(join(import.meta.dir, "fixtures/jira-delivery")));
  test("first, unchanged, counts, added vocabulary, changed metadata and removed vocabulary are distinct", () => {
    expect(inventoryChanges(undefined, inventory)[0]).toBe("Inventory created. There is no earlier inventory to compare.");
    const reordered = structuredClone(inventory);
    reordered.statuses.reverse();
    expect(inventoryChanges(inventory, reordered)[0]).toBe("Inventory unchanged.");
    const counts = structuredClone(inventory);
    counts.issues++;
    counts.statuses[0].count++;
    const countDiff = inventoryChanges(inventory, counts).join(" ");
    expect(countDiff).toContain("Changed issues: 27 to 28");
    expect(countDiff).toContain("Changed statuses:");
    expect(countDiff).toContain("Mapping vocabulary unchanged");
    const moved = structuredClone(inventory);
    moved.source = { dir: "another-export", files: ["issues.json"] };
    expect(inventoryChanges(inventory, moved).join(" ")).toContain("Mapping vocabulary unchanged");
    const changed = structuredClone(inventory);
    changed.statuses[0].category = "doing";
    changed.fields[0].name = "New field name";
    changed.projects.push({ key: "NEW", name: "New project", issues: 0 });
    changed.linkTypes.pop();
    const diff = inventoryChanges(inventory, changed).join(" ");
    expect(diff).toContain("Added projects: New project");
    expect(diff).toContain("Changed fields: New field name");
    expect(diff).toContain("Removed linkTypes:");
    expect(diff).toContain("category");
    expect(diff).toContain("Run tracker draft-mapping");
  });

  test("the CLI compares the previous file before overwriting it and keeps the mapping", () => {
    const dir = mkdtempSync(join(tmpdir(), "plumb-discover-"));
    const source = join(import.meta.dir, "fixtures/jira-delivery");
    cpSync(source, join(dir, "export"), { recursive: true });
    const run = () => Bun.spawnSync([process.execPath, join(ROOT, "plumb.ts"), "tracker", "discover", dir, "--from", join(dir, "export")], { stdout: "pipe", stderr: "pipe" });
    const first = run();
    expect(first.exitCode).toBe(0);
    expect(first.stdout.toString()).toContain("Inventory created");
    writeFileSync(join(dir, "tracker/mapping.yaml"), "# The person's mapping choices\n");
    expect(run().stdout.toString()).toContain("Inventory unchanged");
    const file = join(dir, "tracker/inventory.json");
    const previous = JSON.parse(readFileSync(file, "utf8"));
    previous.statuses = previous.statuses.filter((s: { name: string }) => s.name !== inventory.statuses[0].name);
    writeFileSync(file, JSON.stringify(previous));
    const next = run();
    expect(next.exitCode).toBe(0);
    expect(next.stdout.toString()).toContain(`Added statuses: ${inventory.statuses[0].name}`);
    expect(next.stdout.toString()).toContain("Run tracker draft-mapping");
    expect(readFileSync(join(dir, "tracker/mapping.yaml"), "utf8")).toBe("# The person's mapping choices\n");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(JSON.stringify({ ...inventory, source: { dir: "export", files: readRaw(source).files.map((f) => f.name) } })));
  });
});
