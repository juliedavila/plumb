import { invocation } from "./invocation.ts";
// bun plumb.ts portfolio <build | check | impact | brief>. build writes the
// portfolio page and a page for each design built inside it (src/site/portfolio-build.ts); check, impact and brief
// print, and write nothing.

import { join, relative, resolve } from "node:path";
import type { PortfolioMode } from "../types.ts";
import { portfolioFindingsMd, portfolioImpact, portfolioImpactMd, readPortfolio, runPortfolio } from "./portfolio.ts";
import { portfolioPages, writePortfolioPages } from "../site/portfolio-build.ts";
import { portfolioBriefMd } from "./portfolio-brief.ts";
import { isDate } from "./estimate.ts";

/** Usage for composing, checking and reading a portfolio or evaluating a root proposal. */
export const PORTFOLIO_USAGE = `usage:
  ${invocation()} portfolio build  <portfolio> [--presenting] [--out <dir>] [--today <YYYY-MM-DD>]   compose and check; write the portfolio page, each design's page built inside it, portfolio.json and portfolio.lock
  ${invocation()} portfolio check  <portfolio> [--presenting] [--today <YYYY-MM-DD>]                 every finding across the designs as Markdown; exit 1 on errors
  ${invocation()} portfolio impact <portfolio> <root patch> [--presenting] [--today <YYYY-MM-DD>]     the portfolio with and without one of the root's patches, and its verdict
  ${invocation()} portfolio brief  <portfolio> [--presenting] [--today <YYYY-MM-DD>]                 what needs a person across the designs, read-only
<portfolio> is a folder holding portfolio.yaml, or the file. --presenting composes each design's newest released edition with today's status.
--today builds as of that date (ages, ends, what is in force), for a page that must read the same on any day.`;

const rel = (p: string) => relative(process.cwd(), p) || p;

/** Dispatch portfolio builds, checks, impact reports and read-only briefs with optional dated composition. */
export async function portfolioCli(args: string[], engineRoot: string): Promise<number> {
  const [sub, target, ...rest] = args;
  if (!sub || sub === "-h" || sub === "--help" || !target) { console.log(PORTFOLIO_USAGE); return sub && target ? 0 : 2; }
  const mode: PortfolioMode = rest.includes("--presenting") ? "presenting" : "working";
  const ti = rest.indexOf("--today");
  if (ti >= 0 && !isDate(rest[ti + 1])) { console.error(`--today needs a date, YYYY-MM-DD${rest[ti + 1] ? `, not "${rest[ti + 1]}"` : ""}`); return 2; }
  // a build as of a day: midday UTC, so the date reads the same in every time zone
  const built = ti >= 0 ? `${rest[ti + 1].slice(0, 10)}T12:00:00.000Z` : undefined;
  const opts = { mode, ...(built ? { built } : {}) };
  try {
    if (sub === "build") {
      const oi = rest.indexOf("--out");
      if (oi >= 0 && !rest[oi + 1]) { console.error("--out needs a directory"); return 2; }
      const pages = await portfolioPages(target, opts);
      const out = oi >= 0 ? resolve(rest[oi + 1]) : join(engineRoot, "build", `portfolio-${pages.run.file.name}${mode === "presenting" ? "-presenting" : ""}`);
      const w = writePortfolioPages(pages, out);
      const fs = pages.data.findings, errors = fs.filter((f) => f.severity === "error").length;
      console.log([
        `Built ${pages.run.file.title} (${mode === "presenting" ? "presenting released editions" : "working copies"}): ${pages.designs.length} designs, ${errors} errors, ${fs.length - errors} warnings.`,
        `- the portfolio page: ${rel(join(out, "index.html"))}`,
        ...pages.designs.map((d) => `- ${d.bundle.instance.title}, built inside it: ${rel(join(out, d.namespace, "index.html"))}`),
        `- portfolio.json and each design's bundle.json beside them`, ...(w.lock ? [`- lock: ${rel(w.lock)}`] : []), "",
      ].join("\n"));
      console.log(portfolioFindingsMd(pages.data));
      return errors ? 1 : 0;
    }
    if (sub === "check") {
      const run = await runPortfolio(target, opts);
      console.log(portfolioFindingsMd(run.data));
      return run.data.findings.some((f) => f.severity === "error") ? 1 : 0;
    }
    if (sub === "impact") {
      const patch = rest.find((x, i) => !x.startsWith("--") && rest[i - 1] !== "--today");
      if (!patch) { console.error(PORTFOLIO_USAGE); return 2; }
      const im = await portfolioImpact(target, patch, opts);
      console.log(portfolioImpactMd(im, readPortfolio(target).title));
      return 0;
    }
    if (sub === "brief") {
      console.log(await portfolioBriefMd(target, opts));
      return 0;
    }
  } catch (e) {
    console.error(`portfolio ${sub}: ${(e as Error).message}`);
    return 2;
  }
  console.error(`unknown portfolio command "${sub}"\n${PORTFOLIO_USAGE}`);
  return 2;
}
