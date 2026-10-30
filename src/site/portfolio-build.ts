// Building the portfolio's pages: compose and check the portfolio, take the verdict of
// each proposed root patch on it, assemble the page's facts, and render the portfolio page and a page for each design
// built inside it. One function for `bun plumb.ts portfolio build`, the dev loop and publish.
//
//   <out>/index.html        the portfolio page
//   <out>/portfolio.json    everything it shows (PortfolioData with `page`), for agents
//   <out>/<ns>/index.html   each design's page, built inside the portfolio: its label, links back and to the others
//   <out>/<ns>/bundle.json  its bundle, with `portfolio`

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Bundle, PortfolioData, PortfolioImpact, PortfolioMode } from "../types.ts";
import { portfolioImpact, runPortfolio, writeLock, type PortfolioRun } from "../core/portfolio.ts";
import { designContext, portfolioPageFacts } from "./portfolio-facts.ts";
import { renderPortfolio } from "./portfolio.ts";
import { renderSite } from "./render.ts";

export interface PortfolioPages {
  run: PortfolioRun;
  data: PortfolioData;                   // with page
  html: string;                          // the portfolio page
  designs: { namespace: string; bundle: Bundle; html: string }[];
  impacts: PortfolioImpact[];
}

/** Compose, check and render: nothing is written. `built` is the build time; its date is the page's "today". */
export async function portfolioPages(target: string, opts: { mode?: PortfolioMode; built?: string } = {}): Promise<PortfolioPages> {
  const built = opts.built ?? new Date().toISOString();
  const mode = opts.mode ?? "working";
  const run = await runPortfolio(target, { mode, built });
  // the verdict of each proposed root patch on the whole portfolio; the build as it stands is the "without" side
  const impacts: PortfolioImpact[] = [];
  if (!run.data.stopped) for (const p of (run.root.patches ?? []).filter((x) => x.status === "proposed")) {
    try { impacts.push(await portfolioImpact(run.file.path, p.file ?? p.id, { mode, built, current: run })); } catch { /* a patch that does not load is a finding of the root's own build */ }
  }
  const page = await portfolioPageFacts(run, { built, impacts });
  const data: PortfolioData = { ...run.data, page };
  const designs = run.designs.filter((d) => d.bundle).map((d) => {
    const bundle: Bundle = { ...d.bundle!, portfolio: designContext(data, page, d.namespace) };
    return { namespace: d.namespace, bundle, html: renderSite(bundle) };
  });
  return { run, data, html: renderPortfolio(data), designs, impacts };
}

/** Write the pages, portfolio.json, each design's bundle, and the mode's section of portfolio.lock. */
export function writePortfolioPages(p: PortfolioPages, out: string, opts: { lock?: boolean } = {}): { out: string; lock?: string } {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "portfolio.json"), JSON.stringify(p.data, null, 2) + "\n");
  writeFileSync(join(out, "index.html"), p.html);
  for (const d of p.designs) {
    mkdirSync(join(out, d.namespace), { recursive: true });
    writeFileSync(join(out, d.namespace, "bundle.json"), JSON.stringify(d.bundle, null, 2) + "\n");
    writeFileSync(join(out, d.namespace, "index.html"), d.html);
  }
  const lock = opts.lock === false ? undefined : writeLock(p.run.file, p.run.mode, p.data.lock);
  return { out, ...(lock ? { lock } : {}) };
}
