import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildBundle } from "./bundle.ts";
import { loadInstance } from "./load.ts";
import { isRootDir, loadRoot } from "./root.ts";
import { composeGraph, runPortfolio } from "./portfolio.ts";
import { emptyPremiseLinks, premisesProjection, premisesText, readPremiseLinks } from "./premise-links.ts";
import { checkRoot } from "./root-build.ts";
import type { Finding } from "../types.ts";

/** Builds only in memory. Error findings do not change the projection's successful exit status. */
export async function premisesCommand(scope: string, json = false): Promise<string> {
  const path = resolve(scope);
  const portfolio = existsSync(path) && statSync(path).isDirectory() ? existsSync(join(path, "portfolio.yaml")) : path.endsWith("portfolio.yaml");
  let projection: ReturnType<typeof premisesProjection>;
  let findings: Finding[];
  if (portfolio) {
    const run = await runPortfolio(path);
    if (!run.graph || run.designs.some((r) => !r.bundle)) throw new Error("Premise scope contains inputs that did not load");
    const designs = run.designs.map((d) => d.namespace);
    projection = premisesProjection(designs, run.graph.model, run.graph.plan, run.data.premiseLinks ?? emptyPremiseLinks());
    findings = run.data.findings;
  } else if (isRootDir(path)) {
    const root = loadRoot(path);
    if (root.problems.length) throw new Error(root.problems.join("\n"));
    const graph = composeGraph(root, [], "root", "Root");
    projection = premisesProjection([], graph.model, graph.plan, readPremiseLinks(root.dir, graph.model, []).data);
    findings = (await checkRoot(root)).findings;
  } else {
    const inst = loadInstance(path);
    const { bundle } = await buildBundle(inst);
    const namespace = inst.ns?.namespace ?? inst.config.name;
    const graph = composeGraph(inst.ns?.root?.input, [{ d: { namespace, dir: inst.dir, title: inst.config.title, model: bundle.model, plan: bundle.plan, pins: inst.ns?.pins ?? [] }, config: inst.config }], inst.config.name, inst.config.title);
    projection = premisesProjection([namespace], graph.model, graph.plan, readPremiseLinks(inst.ns?.root?.dir, graph.model, [namespace]).data);
    findings = bundle.findings;
  }
  for (const f of findings) process.stderr.write(`[${f.severity}] ${f.pack}/${f.rule} at ${f.at}: ${f.message}\n`);
  return json ? JSON.stringify(projection, null, 2) : premisesText(projection);
}
