// `bun plumb.ts publish <out-dir> <instance | portfolio>...`: a static folder any static host can serve, e.g. GitHub Pages
// (templates/github-pages.yml is a workflow template for that). Latent: this writes files and nothing else.
// It creates no repository, remote or site.
//
//   <out-dir>/index.html          an index page linking every instance and portfolio
//   <out-dir>/<name>/index.html   each instance's page (the same single offline file `build` writes)
//   <out-dir>/<name>/bundle.json  its bundle, for agents
//   <out-dir>/portfolio-<name>/   a portfolio's page and each design's page built inside it: its
//                                 working view, as `bun plumb.ts portfolio build` writes it, without touching its lock
//   <out-dir>/.nojekyll           so GitHub Pages serves the files as they are

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Bundle } from "../types.ts";
import { buildBundle } from "../core/bundle.ts";
import { renderSite } from "../site/render.ts";
import { CSS } from "../site/styles.ts";
import { esc, plural } from "../site/html.ts";
import { isPortfolioPath } from "./server.ts";
import { portfolioPages, writePortfolioPages } from "../site/portfolio-build.ts";

/** A portfolio on the index: its folder, title, mode and how its checks stand. */
export interface PublishedPortfolio { name: string; title: string; designs: number; errors: number; warnings: number; sentence: string }

export interface PublishResult { outDir: string; pages: { name: string; title: string; path: string; errors: number; warnings: number }[]; portfolios?: PublishedPortfolio[]; errors: number; summary: string }

/** The index page, in the site's own stylesheet and tokens; portfolios, when there are any, come first. */
export function indexPage(bundles: Bundle[], portfolios: PublishedPortfolio[] = []): string {
  const cards = bundles.map((b) => {
    const e = b.findings.filter((f) => f.severity === "error").length, w = b.findings.length - e;
    const done = b.plan.units.filter((u) => u.status === "done").length;
    const sound = e ? `<span class="st fail"><span class="w">Fails ${e}</span></span>` : `<span class="st pass"><span class="w">Passes</span></span>`;
    return `<a class="tile" href="${esc(encodeURIComponent(b.instance.name))}/"><span class="big">${esc(b.instance.title)}</span>
${b.instance.description ? `<span class="line">${esc(b.instance.description)}</span>` : ""}
<span class="line">${plural(b.model.elements.length, "part")} · ${done} of ${b.plan.units.length} units done · ${plural(b.patches.length, "patch", "patches")}</span>
<span class="line">${sound}${w ? ` · ${plural(w, "warning")}` : ""}</span></a>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Plumb instances</title>
<style>${CSS}</style>
</head>
<body>
<main id="main">
<section class="page" aria-labelledby="h-index">
<div class="page-head"><h1 id="h-index">Plumb instances</h1></div>
${portfolios.length ? `<h2>Portfolios</h2>
<div class="tiles" style="--tiles:2">${portfolios.map((p) => `<a class="tile" href="portfolio-${esc(encodeURIComponent(p.name))}/"><span class="big">${esc(p.title)}</span>
<span class="line">${esc(p.sentence)}</span>
<span class="line">${plural(p.designs, "design")} · ${p.errors ? `<span class="st fail"><span class="w">Fails ${p.errors}</span></span>` : `<span class="st pass"><span class="w">Passes</span></span>`}${p.warnings ? ` · ${plural(p.warnings, "warning")}` : ""}</span></a>`).join("\n")}</div>
<h2>Instances</h2>` : ""}
<p class="brief">${plural(bundles.length, "instance")}. Each page is one self-contained file.</p>
<div class="tiles" style="--tiles:2">${cards}</div>
</section>
<p class="small muted">Plumb ${esc(bundles[0]?.engine.version ?? "")}</p>
</main>
</body>
</html>
`;
}

export async function publish(outDirIn: string, instanceDirs: string[]): Promise<PublishResult> {
  const outDir = resolve(outDirIn);
  mkdirSync(outDir, { recursive: true });
  const bundles: Bundle[] = [];
  const pages: PublishResult["pages"] = [];
  const seen = new Set<string>();
  const portfolios: PublishedPortfolio[] = [];
  for (const d of instanceDirs) {
    if (isPortfolioPath(resolve(d))) {
      const p = await portfolioPages(resolve(d));
      const name = p.run.file.name;
      if (portfolios.some((x) => x.name === name)) throw new Error(`two portfolios are named "${name}"; each needs its own name`);
      writePortfolioPages(p, join(outDir, `portfolio-${name}`), { lock: false });
      const e = p.data.findings.filter((f) => f.severity === "error").length;
      portfolios.push({ name, title: p.run.file.title, designs: p.designs.length, errors: e, warnings: p.data.findings.length - e, sentence: p.data.page?.sentence ?? "" });
      continue;
    }
    const { bundle } = await buildBundle(d);
    const name = bundle.instance.name;
    if (seen.has(name)) throw new Error(`two instances are named "${name}"; each needs its own folder`);
    seen.add(name);
    const dir = join(outDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), renderSite(bundle));
    writeFileSync(join(dir, "bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
    const e = bundle.findings.filter((f) => f.severity === "error").length;
    pages.push({ name, title: bundle.instance.title, path: join(dir, "index.html"), errors: e, warnings: bundle.findings.length - e });
    bundles.push(bundle);
  }
  writeFileSync(join(outDir, "index.html"), indexPage(bundles, portfolios));
  writeFileSync(join(outDir, ".nojekyll"), "");
  const errors = pages.reduce((n, p) => n + p.errors, 0) + portfolios.reduce((n, p) => n + p.errors, 0);
  const summary = [`# Published ${plural(pages.length, "instance")}${portfolios.length ? ` and ${plural(portfolios.length, "portfolio")}` : ""} to ${outDir}`, "", ...portfolios.map((p) => `- portfolio-${p.name}/index.html: ${p.title}, ${plural(p.designs, "design")} (${p.errors} errors, ${p.warnings} warnings)`), ...pages.map((p) => `- ${p.name}/index.html: ${p.title} (${p.errors} errors, ${p.warnings} warnings)`), `- index.html, .nojekyll`, ""].join("\n");
  return { outDir, pages, ...(portfolios.length ? { portfolios } : {}), errors, summary };
}
