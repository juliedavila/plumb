#!/usr/bin/env bun
// Plumb: the checked design CLI.
//   bun plumb.ts build  <instance-dir> [--out <dir>] [--edition <version>] [--today YYYY-MM-DD]   compile, check, analyze, layout; write build/<name>/bundle.json and index.html (a released edition: build/<name>-<version>/)
//   bun plumb.ts check  <instance-dir> [--edition <version>] [--today YYYY-MM-DD]   findings as Markdown; exit 1 on errors
//   bun plumb.ts brief  <instance-dir>                  what changed and what needs a person, read-only (src/core/brief-cli.ts)
//   bun plumb.ts impact <instance-dir> <patch-id>       impact report as Markdown
//   bun plumb.ts plan   <instance-dir>                  frontier, critical path, phase progress as Markdown
//   bun plumb.ts premise <instance-dir> [claim-id]       what rests on a claim ("if this is false"); without an id, the claims ranked
//   bun plumb.ts diff   <instance-dir> --from <bundle.json|git ref|edition folder> [--to ...] [--save]   compare two builds
//   bun plumb.ts report <instance-dir> [--presented]    save a report snapshot in <instance>/reports/; --presented marks it as shown to the room
//   bun plumb.ts site   <instance-dir>                  same as build
//   bun plumb.ts tracker <sub> <instance-dir> ...        tracker discovery, mapping, reconciliation, export (src/tracker/cli.ts)
//   bun plumb.ts dev    <instance-dir | portfolio> [--port 4317] [--out <dir>]   serve the page on 127.0.0.1, rebuild on change, live reload; a portfolio serves its page and its designs' pages and watches its root; --out is required outside this repository
//   bun plumb.ts vault <instance or portfolio> --out <dir> [--packaging] [--today YYYY-MM-DD]
//   bun plumb.ts publish <out-dir> <instance-dir | portfolio>...     write a static folder: one page per instance, a portfolio's pages, an index, .nojekyll
//   bun plumb.ts design add <namespace>@<version> --from <source> [--workspace <dir>] [--with-pins] [--ref <ref>] [--path <path>]
//   bun plumb.ts package <out-dir> [--with-mcp]   a clean bundle to take elsewhere (src/dev/package.ts)
//   bun plumb.ts release <instance-dir> --label <version>   freeze the design as a released edition in <instance>/editions/<version>/ (src/core/edition.ts)
//   bun plumb.ts migrate <instance-dir> [--to 0.4] [--root <dir>] [--moved <file>] [--dry-run]   bring an instance to a newer schema (src/migrate/index.ts)
//   bun plumb.ts portfolio <build | check | impact | brief> <portfolio> ...   designs composed over one root: the portfolio page, its checks, a root patch's verdict, what needs a person (src/core/portfolio-cli.ts)
//   bun plumb.ts check|build <root-dir>                 a shared root (kind: root) in place of an instance: its own checks (src/core/root-build.ts)

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Bundle } from "./src/types.ts";
import { buildBundle, modelHash } from "./src/core/bundle.ts";
import { release } from "./src/core/edition.ts";
import { SchemaError } from "./src/core/schema.ts";
import { MIGRATE_USAGE, migrateCli } from "./src/migrate/index.ts";
import { PORTFOLIO_USAGE, portfolioCli } from "./src/core/portfolio-cli.ts";
import { compile } from "./src/core/compile.ts";
import { computeImpact, findPatch } from "./src/core/impact.ts";
import { loadInstance, packNames } from "./src/core/load.ts";
import { analyzePlan } from "./src/core/plan.ts";
import { buildSummaryMd, findingsMd, impactMd, planMd, premiseMd } from "./src/core/report.ts";
import { premisesCommand } from "./src/core/premises-command.ts";
import { rankClaims, weight } from "./src/core/premise.ts";
import { diffCli } from "./src/core/diff.ts";
import { reportCli } from "./src/core/report-cli.ts";
import { briefCli } from "./src/core/brief-cli.ts";
import { loadPacks, packsFor } from "./src/core/rules.ts";
import { TRACKER_USAGE, trackerCli } from "./src/tracker/cli.ts";
import { startDev } from "./src/dev/server.ts";
import { publish } from "./src/dev/publish.ts";
import { packageCli } from "./src/dev/package.ts";
import { vaultCli } from "./src/vault/build.ts";
import { isRootDir } from "./src/core/root.ts";
import { ROOT_USAGE, rootCli } from "./src/core/root-build.ts";
import { designCli } from "./src/design/add.ts";
import { isDate } from "./src/core/estimate.ts";
import { invocation } from "./src/core/invocation.ts";

// Command-local options are validated before dispatch, including flags before a target.
const values: Record<string, string[]> = {
  build: ["out", "edition", "today"], site: ["out", "edition", "today"], check: ["edition", "today"],
  brief: [], impact: [], plan: [], premises: [], premise: [], diff: ["from", "to"], report: [],
  dev: ["port", "out"], vault: ["out", "today"], publish: [], package: [], release: ["label"], migrate: ["to", "root", "moved"],
  "design add": ["from", "workspace", "ref", "path"],
  "portfolio build": ["out", "today"], "portfolio check": ["today"], "portfolio impact": ["today"], "portfolio brief": ["today"],
  "tracker discover": ["from", "adapter"], "tracker draft-mapping": [], "tracker reconcile": ["from"], "tracker export": ["out"],
  "tracker measure": ["from", "as-of", "portfolio", "today", "agent", "tool", "model", "by", "requested-by"],
};
const switches: Record<string, string[]> = {
  premises: ["json"], diff: ["save", "json"], report: ["presented"], vault: ["packaging"], package: ["with-mcp"], migrate: ["dry-run"],
  "design add": ["with-pins"], "portfolio build": ["presenting"], "portfolio check": ["presenting"], "portfolio impact": ["presenting"], "portfolio brief": ["presenting"],
  "tracker draft-mapping": ["force"], "tracker measure": ["draft-patch", "limits"],
};

/** Validate one command's flags without reading inputs or writing outputs. */
function validateOptions(command: string, args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("-")) continue;
    if (arg === "--help" || arg === "-h") continue;
    if (values[command]?.includes(arg.slice(2)) && arg.startsWith("--")) {
      if (!args[i + 1] || args[i + 1].startsWith("-")) return `${arg} needs a value`;
      i++;
    } else if (!arg.startsWith("--") || !switches[command]?.includes(arg.slice(2))) return `unknown option ${arg} for ${command}`;
  }
}

/** All public commands, including nested command names and the site alias. */
const commands = Object.keys(values);

const ROOT = import.meta.dir;
const USAGE = `usage:
  ${invocation()} build  <instance-dir> [--out <dir>] [--edition <version>] [--today YYYY-MM-DD]   compile and check; write bundle.json and index.html
  ${invocation()} site   <instance-dir> [--out <dir>] [--edition <version>] [--today YYYY-MM-DD]   alias for build
  ${invocation()} check  <instance-dir> [--edition <version>] [--today YYYY-MM-DD]   print findings; exit 1 on errors
  ${invocation()} brief  <instance-dir>   status, changes and what needs a person, read-only
  ${invocation()} impact <instance-dir> <patch-id>   evaluate a design patch and print its verdict
  ${invocation()} plan   <instance-dir>   ready work, blockers and critical path
  ${invocation()} premises <instance-or-root-or-portfolio> [--json]   read premises and reconciliation links in scope
  ${invocation()} premise <instance-dir> [claim-id]   rank claims or show what rests on one
  ${invocation()} diff   <instance-dir> --from <bundle.json | git ref | edition folder> [--to ...] [--save] [--json]   compare builds
  ${invocation()} report <instance-dir> [--presented]   save a report snapshot, optionally marked shown
  ${invocation()} dev    <instance-dir | portfolio> [--port 4317] [--out <dir>]   serve locally and rebuild on changes
  ${invocation()} vault <instance or portfolio> --out <dir> [--packaging] [--today YYYY-MM-DD]   generate an Obsidian vault and import annotations
  ${invocation()} publish <out-dir> <instance-dir | portfolio>...   write a static folder with an index
  ${invocation()} design add <namespace>@<version> --from <source> [--workspace <dir>] [--with-pins] [--ref <ref>] [--path <path>]   verify and add a released design
  ${invocation()} package <out-dir> [--with-mcp]   write a checked standalone distribution
  ${invocation()} release <instance-dir> --label <version>   freeze a released design edition
  ${MIGRATE_USAGE.replace(/^usage: /, "")}   migrate schemas or moved ids
<instance-dir> means the design folder. Design build, site and check --today build as of that date (ages, status and dated organization checks) at noon UTC, with a repeatable build stamp. Shared-root build and check use the machine date.
${PORTFOLIO_USAGE.replace(/^usage:\n/, "")}
${ROOT_USAGE}
${TRACKER_USAGE.replace(/^usage:\n/, "")}`;

function die(msg: string, code = 2): never {
  process.stderr.write(msg.endsWith("\n") ? msg : msg + "\n");
  process.exit(code);
}

async function renderSiteIfPresent(bundle: Bundle): Promise<string | undefined> {
  const path = join(ROOT, "src/site/render.ts");
  if (!existsSync(path)) return undefined;
  const mod = await import(path);
  if (typeof mod.renderSite !== "function") return undefined;
  return mod.renderSite(bundle) as string;
}

async function main(argv: string[]) {
  const [cmd, dir, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") { console.log(USAGE); return 0; }
  const nested = ["design", "portfolio", "tracker"].includes(cmd);
  if (!commands.some(c => c.split(" ")[0] === cmd)) die(`unknown command "${cmd}"\n${USAGE}`);
  const command = nested && dir && !dir.startsWith("-") ? `${cmd} ${dir}` : cmd;
  if (nested && command !== cmd && !commands.includes(command)) die(`unknown ${cmd} command "${dir}"\n${USAGE}`);
  const usage = USAGE.split("\n").filter(line => line.trimStart().startsWith(`${invocation()} ${command} `)).join("\n") || USAGE;
  const optionError = validateOptions(command, argv.slice(nested && command !== cmd ? 2 : 1));
  if (optionError) die(`${optionError}\nusage:\n${usage}`);
  if (argv.includes("--help") || argv.includes("-h")) { console.log(`usage:\n${usage}`); return 0; }
  if (!dir) die(USAGE);

  if (cmd === "premises") { console.log(await premisesCommand(dir, rest.includes("--json"))); return 0; }

  if (cmd === "design") return designCli([dir, ...rest]);

  if (cmd === "tracker") return trackerCli([dir, ...rest]);

  if (cmd === "vault") return vaultCli([dir, ...rest]);

  if (cmd === "package") return packageCli([dir, ...rest], ROOT);

  if (cmd === "migrate") return migrateCli(dir, rest);

  if (cmd === "portfolio") return portfolioCli([dir, ...rest], process.cwd());

  if (cmd === "release") {
    const li = rest.indexOf("--label");
    const label = li >= 0 ? rest[li + 1] : undefined;
    if (!label) die(`release needs --label <version>\n${USAGE}`);
    const inst = loadInstance(dir);
    let r;
    try { r = release(inst, label, modelHash(inst)); } catch (e) { die(`release: ${(e as Error).message}`, 1); }
    const pin = `{ namespace: ${inst.ns?.namespace ?? inst.config.name}, version: "${label}", sha256: ${r.sha256} }`;
    console.log([`Released ${inst.config.title} ${label} to ${relative(process.cwd(), r.dir) || r.dir}: ${r.stamp.files.length} files, build ${r.stamp.build}.`,
      `edition.yaml sha256 ${r.sha256}`, `A design that ships with this one pins it as: ${pin}`].join("\n"));
    return 0;
  }

  if (cmd === "dev") {
    const pi = rest.indexOf("--port");
    const port = pi >= 0 ? Number(rest[pi + 1]) : 4317;
    if (!Number.isInteger(port) || port < 0 || port > 65535) die(`--port must be a port number, not ${rest[pi + 1]}`);
    const oi = rest.indexOf("--out");
    if (oi >= 0 && !rest[oi + 1]) die("--out needs a directory");
    let dev;
    try { dev = await startDev(dir, { port, log: (m) => console.log(m), ...(oi >= 0 ? { outDir: resolve(rest[oi + 1]) } : {}) }); }
    catch (e) { die(`dev: ${(e as Error).message}`); }
    console.log(`serving ${dev.url} (127.0.0.1 only); watching ${dev.watching.join(", ")}. Ctrl-C to stop.`);
    await new Promise(() => {}); // run until interrupted
  }

  if (cmd === "publish") {
    if (!rest.length) die(USAGE);
    const r = await publish(dir, rest);
    console.log(r.summary);
    return r.errors ? 1 : 0;
  }

  // a shared root (its engine.yaml says kind: root): its own checks, in place of an instance's
  if ((cmd === "check" || cmd === "build") && isRootDir(dir)) {
    const unsupported = rest.find(arg => arg === "--today" || arg === "--edition");
    if (unsupported) die(`unknown option ${unsupported} for ${cmd}\nusage:\n${ROOT_USAGE}`);
    return rootCli(cmd, dir, rest, process.cwd());
  }

  const ei = rest.indexOf("--edition");
  if (ei >= 0 && !rest[ei + 1]) die("--edition needs a version");
  const edition = ei >= 0 ? { edition: rest[ei + 1] } : {};
  const ti = rest.indexOf("--today");
  if (ti >= 0 && (!isDate(rest[ti + 1]) || new Date(`${rest[ti + 1]}T12:00:00.000Z`).toISOString().slice(0, 10) !== rest[ti + 1])) die("--today needs a valid date, YYYY-MM-DD");
  const datedEdition = { ...edition, ...(ti >= 0 ? { built: `${rest[ti + 1]}T12:00:00.000Z` } : {}) };

  if (cmd === "build" || cmd === "site") {
    const oi = rest.indexOf("--out");
    const { bundle, warnings } = await buildBundle(dir, datedEdition);
    for (const w of warnings) process.stderr.write(w + "\n");
    const outDir = oi >= 0 && rest[oi + 1] ? resolve(rest[oi + 1]) : join(process.cwd(), "build", bundle.instance.name + (bundle.instance.edition ? `-${bundle.instance.edition.version}` : ""));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
    let site: string;
    try {
      const html = await renderSiteIfPresent(bundle);
      if (html === undefined) site = "skipped (src/site/render.ts is not there yet)";
      else { writeFileSync(join(outDir, "index.html"), html); site = join(outDir, "index.html"); }
    } catch (e) {
      site = `failed: ${(e as Error).message}`;
    }
    console.log(buildSummaryMd(bundle, outDir, site));
    if (bundle.findings.length) console.log(findingsMd(bundle.findings));
    return bundle.findings.some((f) => f.severity === "error") ? 1 : 0;
  }

  if (cmd === "check") {
    const { bundle } = await buildBundle(dir, datedEdition);
    console.log(findingsMd(bundle.findings, `Checks: ${bundle.instance.title}`));
    return bundle.findings.some((f) => f.severity === "error") ? 1 : 0;
  }

  if (cmd === "impact") {
    const pid = rest[0];
    if (!pid) die(USAGE);
    const inst = loadInstance(dir);
    const p = findPatch(inst, pid);
    if (!p) die(`unknown patch "${pid}"; known: ${inst.patches.map((x) => x.id).join(", ") || "(none)"}`);
    const loaded = await loadPacks(packNames(inst));
    const packs = packsFor(loaded.packs, !!inst.ns), errors = loaded.errors;
    for (const e of errors) process.stderr.write(`warning: pack ${e.name} did not load: ${e.message}\n`);
    for (const f of inst.loadFindings ?? []) process.stderr.write(`warning: ${f.message}\n`);
    console.log(impactMd(computeImpact(inst, pid, packs), p.title, p.why));
    return 0;
  }

  if (cmd === "premise") {
    const { bundle } = await buildBundle(dir);
    const claims = bundle.model.claims ?? [];
    if (!rest[0]) {
      if (!claims.length) { console.log("This instance declares no claims (model.yaml `claims:`)."); return 0; }
      const ranked = rankClaims(claims, bundle.premises ?? {});
      console.log([`# Claims: ${bundle.instance.title}`, "", "Ranked by how much rests on each.", "", "| Claim | Kind | Grade | Rests on it | Statement |", "|---|---|---|---|---|",
        ...ranked.map((c) => `| \`${c.id}\` | ${c.kind} | ${c.grade} | ${bundle.premises?.[c.id] ? weight(bundle.premises[c.id]) : 0} | ${c.statement.replace(/\|/g, "\\|")} |`), ""].join("\n"));
      return 0;
    }
    const md = premiseMd(bundle, rest[0]);
    console.log(md);
    return claims.some((c) => c.id === rest[0]) ? 0 : 1;
  }

  if (cmd === "diff") return diffCli(dir, rest);

  if (cmd === "report") return reportCli(dir, rest);

  if (cmd === "brief") return briefCli(dir);

  if (cmd === "plan") {
    const inst = loadInstance(dir);
    const c = compile(inst);
    console.log(planMd(c.plan, analyzePlan(c.plan), `Plan: ${inst.config.title}`));
    return 0;
  }

  die(`unknown command "${cmd}"\n${USAGE}`);
}

if (import.meta.main) {
  // a schema this engine cannot read stops the build: say the finding, write nothing, exit 1
  main(process.argv.slice(2)).then((code) => process.exit(code ?? 0), (e) => (e instanceof SchemaError ? die(`${e.finding.pack}/${e.finding.rule} (error): ${e.finding.message}`, 1) : die(`error: ${(e as Error).message}`, 2)));
}
