import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { addDesign } from "../src/design/add.ts";
import { loadTeamMap } from "../src/design/teams.ts";
import { readTeamMap } from "../src/core/teams.ts";
import { normClaim, loadInstance } from "../src/core/load.ts";
import { parseYaml } from "../src/core/yaml.ts";
import { readPremiseLinks, premisesProjection, premisesText, validatePremiseLinks } from "../src/core/premise-links.ts";
import { allPremiseImpacts } from "../src/core/premise.ts";
import { runPortfolio, readLock, readPortfolio, writeLock } from "../src/core/portfolio.ts";
import { openingSentence } from "../src/site/portfolio-facts.ts";
import { buildBundle } from "../src/core/bundle.ts";
import { portfolioBriefMd } from "../src/core/portfolio-brief.ts";
import { localPath, shellArg } from "../src/core/invocation.ts";
import { scrubListPath } from "../src/core/scrub.ts";

const temps: string[] = [];
const temp = () => { const d = mkdtempSync(join(import.meta.dir,".adopter061-")); temps.push(d); return d; };
afterEach(() => { for (const d of temps.splice(0)) rmSync(d,{recursive:true,force:true}); });
const fixtures = join(import.meta.dir,"fixtures/editions");
const cli = (args:string[],cwd:string) => Bun.spawnSync([process.execPath,join(import.meta.dir,"../plumb.ts"),...args],{cwd,stdout:"pipe",stderr:"pipe"});

for (const nested of [false,true]) test(`pins inside a direct edition, version nested: ${nested}`,async () => {
  const dir = temp(), from = join(dir,"upstream"), workspace = join(dir,"plumb");
  cpSync(join(fixtures,"premerge/1.0.0"),from,{recursive:true});
  const pin = join(from,"pins/intake",...(nested ? ["1.0.0"] : []));
  cpSync(join(fixtures,"intake/1.0.0"),pin,{recursive:true});
  await expect(addDesign("premerge","1.0.0",{from,workspace})).rejects.toThrow(`--from ${shellArg(localPath(pin))}`);
  const hint = cli(["design","add","premerge@1.0.0","--from",from,"--workspace",workspace],dir);
  const command = hint.stderr.toString().split("Run: ")[1]?.trim();
  expect(command).toStartWith("bun ");
  // Fixture paths have no shell metacharacters. Execute the exact printed arguments.
  const pasted = Bun.spawnSync(command.split(" "),{cwd:dir,stdout:"pipe",stderr:"pipe"});
  expect(pasted.exitCode).toBe(0);
  const result = await addDesign("premerge","1.0.0",{from,workspace:join(dir,"recursive"),withPins:true});
  expect(result.map(d=>d.namespace)).toEqual(["intake","premerge"]);
  expect(existsSync(join(dir,"recursive/instances/intake/editions/1.0.0/edition.yaml"))).toBe(true);
});

test("a missing nearby pin explains the required folder",async () => {
  const dir=temp(),from=join(dir,"upstream"); cpSync(join(fixtures,"premerge/1.0.0"),from,{recursive:true});
  await expect(addDesign("premerge","1.0.0",{from,workspace:join(dir,"workspace")})).rejects.toThrow("The --from folder must directly hold edition.yaml for intake@1.0.0 and its listed files.");
});

test("empty owner mappings stay unresolved in both loaders and draft guidance",async () => {
  const dir=temp(); await addDesign("intake","1.0.0",{from:fixtures,workspace:dir});
  const draft=join(dir,"instances/shared/team-map.draft.yaml"), text=readFileSync(draft,"utf8");
  expect(text).toStartWith("# Declare teams"); expect(text).toContain("cannot map yet");
  expect(loadTeamMap(draft).owners["counter operations"].teams).toEqual([]);
  expect(readTeamMap(draft)!.problems).toEqual([]);
  expect(readTeamMap(draft)!.teams).toEqual([]);
  writeFileSync(draft,"owners:\n  incomplete: {}\n");
  expect(()=>loadTeamMap(draft)).toThrow("names no team");
  expect(readTeamMap(draft)!.problems.join("\n")).toContain("names no team");
});

test("YAML errors locate file and line across direct and finding loaders",() => {
  const text="owners:\n  role: bad: value\n",dir=temp(),path=join(dir,"team-map.yaml");writeFileSync(path,text);
  expect(()=>parseYaml(text,path)).toThrow("2: ");
  expect(()=>loadTeamMap(path)).toThrow("team-map.yaml: 2: ");
  expect(readTeamMap(path)!.problems.join("\n")).toContain("team-map.yaml: YAML parse error: 2: ");
  expect(readTeamMap(path)!.problems.join("\n")).not.toContain(dir);
  const edition=join(dir,"edition.yaml");writeFileSync(edition,text);
  expect(()=>loadInstance(dir)).toThrow();
});

test("declared links project, cascade with tags, stay external alone, and warn on duplicates",async () => {
  const run=await runPortfolio(join(import.meta.dir,"../examples/portfolio"));
  const declared=run.data.premiseLinks!.links.filter(l=>l.status==="declared");
  expect(declared).toMatchObject([{from:"intake:IN-4",to:"premerge:PM-2",type:"depends-on",status:"declared"}]);
  const impacts=allPremiseImpacts(run.graph!.model,run.graph!.plan,run.data.premiseLinks!.links);
  expect(impacts["premerge:PM-2"].dependents).toContainEqual(expect.objectContaining({id:"intake:IN-4",status:"declared",links:[{id:declared[0].id,status:"declared"}]}));
  expect(impacts["premerge:PM-2"].units.flatMap(g=>g.units).some(id=>id.startsWith("intake:"))).toBe(true);
  const source=normClaim({id:"alpha:A",kind:"premise",statement:"A",rests_on:{claims:["beta:B"]}});
  expect(source.rests_on).toEqual(["beta:B"]);
  expect(normClaim({id:"invalid",rests_on:{other:"beta:B"}}).rests_on).toEqual(["[object Object]"]);
  const model={...run.graph!.model,claims:[source]};
  const alone=readPremiseLinks(undefined,model,["alpha"]).data;
  expect(alone.links[0]).toMatchObject({status:"declared",external:true});
  expect(premisesText(premisesProjection(["alpha"],model,{phases:[],units:[]},alone))).toContain("declared, external");
  const target=normClaim({id:"beta:B",statement:"B"});
  const duplicate=validatePremiseLinks({links:[{id:"PL-999",from:"alpha:A",to:"beta:B",type:"depends-on",found:{by:"agent:review",at:"2026-10-30",reasoning:"Evidence",sources:["model.yaml"]}}]}, {...model,claims:[source,target]},["alpha","beta"]);
  expect(duplicate.findings).toContainEqual(expect.objectContaining({severity:"warning",message:expect.stringContaining("PL-999 duplicates declared:alpha:A->beta:B")}));
  expect(readPremiseLinks(undefined,model,["alpha","beta"]).findings).toContainEqual(expect.objectContaining({severity:"error",message:expect.stringContaining("does not resolve to a claim")}));
});

test("freshly imported pins stay out of the stale list and brief groups unresolved owners",async () => {
  const dir=temp();await addDesign("premerge","1.0.0",{from:fixtures,workspace:dir,withPins:true});
  const portfolio=join(dir,"portfolio");mkdirSync(portfolio);
  writeFileSync(join(portfolio,"portfolio.yaml"),JSON.stringify({root:"../instances/shared",designs:[{namespace:"intake",from:"../instances/intake"},{namespace:"premerge",from:"../instances/premerge"}]}));
  const run=await runPortfolio(portfolio);
  expect(run.data.findings.filter(f=>f.rule==="xref-pin-stale")).toEqual([]);
  const errors=run.data.findings.filter(f=>f.severity==="error");
  expect(errors.length).toBeGreaterThan(0);
  expect(await portfolioBriefMd(portfolio)).toContain(`${errors.length} errors, all unresolved owner roles: finish the team map`);
});

test("command rendering preserves JSON evidence and quotes shell metacharacters",() => {
  const evidence=JSON.stringify({sources:["plumb build a"]});
  const dir = temp(), script = join(dir,"evidence.ts");
  writeFileSync(script, `import ${JSON.stringify(join(import.meta.dir,"../plumb.ts"))}; console.log(${JSON.stringify(evidence)}); console.warn("user says bun plumb.ts build a");`);
  const result = Bun.spawnSync([process.execPath,script,"--help"],{stdout:"pipe",stderr:"pipe"});
  expect(result.stdout.toString()).toContain(evidence);
  expect(result.stderr.toString()).toContain("user says bun plumb.ts build a");
  expect(shellArg("a'$(whoami)")).toBe("'a'\\''$(whoami)'");
});

test("legacy scrub path warns only once and explicit paths avoid home fallbacks",() => {
  const dir=temp(),home=join(dir,"home"),old=join(home,".config/design-engine/scrub.txt");
  mkdirSync(join(old,".."),{recursive:true});writeFileSync(old,"fictional-pattern\n");
  const script=join(dir,"probe.ts");
  writeFileSync(script,`import { scrubListPath } from ${JSON.stringify(join(import.meta.dir,"../src/core/scrub.ts"))};\nconst home = ${JSON.stringify(home)};\nconsole.log(scrubListPath({},home));\nconsole.log(scrubListPath({},home));\n`);
  const result=Bun.spawnSync([process.execPath,script],{stdout:"pipe",stderr:"pipe"});
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString().match(/scrub path is deprecated/g)).toHaveLength(1);
  expect(result.stdout.toString().trim().split("\n")).toEqual([old,old]);
  expect(scrubListPath({PLUMB_SCRUB_LIST:"./local-scrub.txt"},home)).toBe(join(process.cwd(),"local-scrub.txt"));
  expect(scrubListPath({},join(dir,"absent"))).toBe(join(dir,"absent/.config/plumb/scrub.txt"));
});

test("linked and direct invocations render source hints on stderr", () => {
  const dir=temp(), link=join(dir,"plumb");
  symlinkSync(join(import.meta.dir,"../plumb.ts"),link);
  const args=["tracker","reconcile",join(import.meta.dir,"../examples/shared")];
  const linked=Bun.spawnSync([process.execPath,link,...args],{cwd:dir,stdout:"pipe",stderr:"pipe"});
  const direct=cli(args,dir);
  // A linked run prints the bun form unless the process title is plumb: it works when pasted either way.
  expect(linked.stderr.toString()).toMatch(/(?:^|[ (])(?:plumb|bun \S*plumb\.ts) tracker measure/);
  expect(direct.stderr.toString()).toContain("bun ");
  expect(direct.stderr.toString()).toContain("plumb.ts tracker measure");
  const executable=Bun.spawnSync([link,...args],{cwd:dir,stdout:"pipe",stderr:"pipe"});
  expect(executable.stderr.toString()).toMatch(/(?:^|[ (])(?:plumb|bun \S*plumb\.ts) tracker measure/);
  const help=cli(["--help"],dir).stdout.toString();
  expect(help).not.toContain("  plumb ");
  expect(help).toContain("plumb.ts tracker measure");
});

test("malformed lock warns with relative file and position and can rebuild",async () => {
  const dir=temp();
  cpSync(join(import.meta.dir,"fixtures/portfolio/base"),dir,{recursive:true});
  const file=readPortfolio(join(dir,"portfolio"));
  writeFileSync(join(file.dir,"portfolio.lock"),"working:\n  bad: value: broken\n");
  const warnings:string[]=[]; const original=console.warn;
  console.warn=(message)=>warnings.push(String(message));
  try {
    expect(readLock(file)).toEqual({});
    const run=await runPortfolio(file.dir);
    writeLock(file,"working",run.data.lock);
    expect(readLock(file).working).toEqual(run.data.lock);
  }
  finally {console.warn=original;}
  expect(warnings.join("\n")).toContain("portfolio.lock: 2:");
  expect(warnings.join("\n")).toContain("rebuilding portfolio.lock");
  expect(warnings.join("\n")).not.toContain(file.dir);
});

test("brief describes a dominant error class even with another error",async () => {
  const {data}=await runPortfolio(join(import.meta.dir,"../examples/portfolio"));
  data.findings=Array.from({length:122},()=>({pack:"plan",rule:"owner",severity:"error" as const,at:"x",atKind:"instance" as const,subject:"x",message:"owner team role does not exist"}));
  data.findings.push({...data.findings[0],message:"other error"});
  expect(openingSentence(data,{relevant:0,excepted:0})).toContain("122 of 123 errors are unresolved owner roles: finish the team map");
});

test("exported model rests_on claims produce declared links including shared claims", () => {
  const exported=loadInstance(join(import.meta.dir,"fixtures/exported-design/plumb"));
  const claims=exported.model.claims!.map(c=>({...c,id:`exported:${c.id}`}));
  const model={elements:[],relationships:[],claims} as any;
  const {data}=readPremiseLinks(undefined,model,["exported"]);
  expect(data.links.map(l=>[l.from,l.to,l.status,l.external])).toEqual([["exported:EX-1","upstream:UP-1","declared",true],["exported:EX-1","shared:SH-1","declared",true]]);
  expect(data.debt.declared).toBe(2);
  expect(premisesText(premisesProjection(["exported"],model,{phases:[],units:[]},data))).toContain("Declared links: 2");
});

test("legacy environment notices print once per process", () => {
  const dir=temp(),script=join(dir,"env.ts");
  writeFileSync(script,`import {setting} from ${JSON.stringify(join(import.meta.dir,"../src/core/env.ts"))}; console.log(setting("A",{DE_A:"one"})); console.log(setting("B",{DE_B:"two"}));`);
  const result=Bun.spawnSync([process.execPath,script],{stdout:"pipe",stderr:"pipe"});
  expect(result.stdout.toString()).toBe("one\ntwo\n");
  expect(result.stderr.toString().match(/deprecated/g)).toHaveLength(1);
});

test("YAML coordinate fallback preserves the error if temporary storage is unavailable", () => {
  const dir=temp(),script=join(dir,"yaml-fallback.ts");
  writeFileSync(script,`import {mock} from "bun:test";\nimport * as fs from "node:fs";\nmock.module("node:fs",()=>({...fs,mkdtempSync(){throw new Error("unavailable");}}));\nconst {parseYaml}=await import(${JSON.stringify(join(import.meta.dir,"../src/core/yaml.ts"))});\ntry {parseYaml("key: broken: yaml", "/absolute/private.yaml");} catch(e){console.log(e.message);}\n`);
  const result=Bun.spawnSync([process.execPath,script],{stdout:"pipe",stderr:"pipe"});
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Unexpected token");
  expect(result.stdout.toString()).not.toMatch(/1:1|absolute|unavailable/);
});

test("shipped null ends warn in a design build; organization null ends remain errors",async () => {
  const dir=temp();
  cpSync(join(import.meta.dir,"fixtures/portfolio/base"),dir,{recursive:true});
  const seams=join(dir,"shared/seams.yaml"),raw=Bun.YAML.parse(readFileSync(seams,"utf8")) as any;
  const exception={contracts:["Spec"],accepted_by:"risk owner",until:null,why:"Waiting for adoption"};
  raw.seams[0].default_exceptions=[exception];writeFileSync(seams,JSON.stringify(raw));
  rmSync(join(dir,"shared/org.yaml"),{force:true});
  const built=await buildBundle(loadInstance(join(dir,"designs/alpha")));
  const warnings=built.bundle.findings.filter(f=>f.pack==="org"&&f.rule==="exception-valid");
  expect(warnings).toContainEqual(expect.objectContaining({severity:"warning",message:expect.stringContaining("awaits the organization's end date")}));
  writeFileSync(join(dir,"shared/org.yaml"),JSON.stringify({seam_exceptions:{[raw.seams[0].id]:[exception]}}));
  const own=await buildBundle(loadInstance(join(dir,"designs/alpha")));
  expect(own.bundle.findings).toContainEqual(expect.objectContaining({pack:"org",rule:"exception-valid",severity:"error",message:expect.stringContaining("has no end")}));
});
