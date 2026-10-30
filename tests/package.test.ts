import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packageBundle, leakCheck, sectionLines } from "../src/dev/package.ts";
import { loadScrubList, parseScrubList, scrubListPath } from "../src/core/scrub.ts";
import { setting } from "../src/core/env.ts";
import { hash } from "../src/design/manifest.ts";
const root=join(import.meta.dir,"..");
const temps:string[]=[];
const temp=()=>{const d=mkdtempSync(join(tmpdir(),"plumb-package-test-"));temps.push(d);return d;};
afterEach(()=>{for(const d of temps.splice(0))rmSync(d,{recursive:true,force:true});});
const scrub=()=>{const file=join(temp(),"scrub.txt");writeFileSync(file,"");return file;};

test("standalone packages contain code, fixtures, examples and verified manifest; authored workspace designs are absent",async()=>{
  const out=join(temp(),"package");const r=await packageBundle(out,{root,scrubList:scrub()});
  expect(r.ok).toBe(true);expect(r.leaks).toEqual([]);
  for(const f of ["plumb.ts","package.json","CHANGELOG.md","README.md","SPEC.md","DEMO.md","skill/plumb/SKILL.md","src/design/add.ts","src/core/scrub.ts","examples/delivery-stream/model.yaml","tests/design-add.test.ts","tests/standalone.test.ts","tests/fixtures/editions/intake/1.0.0/edition.yaml"])expect(existsSync(join(out,f))).toBe(true);
  for(const f of ["instances","portfolios","tools","de.ts","src/mcp/server.ts","tests/mcp.test.ts"])expect(existsSync(join(out,f))).toBe(false);
  expect(JSON.parse(readFileSync(join(out,"package.json"),"utf8"))).toMatchObject({name:"@juliedavila/plumb",version:JSON.parse(readFileSync(join(root,"package.json"),"utf8")).version,bin:{plumb:"./plumb.ts"},private:false});
  const lines=readFileSync(join(out,"MANIFEST"),"utf8").split("\n").filter(l=>l&&!l.startsWith("#"));
  expect(lines.length).toBe(r.files.length);
  for(const line of lines){const m=/^([a-f0-9]{64})\s+(\d+)\s+(.+)$/.exec(line)!;const b=readFileSync(join(out,m[3]));expect(hash(b)).toBe(m[1]);expect(b.length).toBe(Number(m[2]));}
  expect(readFileSync(join(out,"README.md"),"utf8")).toContain("made without the MCP server");
  const process=Bun.spawnSync([Bun.which("bun")!,join(out,"plumb.ts"),"build",join(out,"examples/delivery-stream"),"--out",join(out,"build/delivery-stream")],{cwd:out,stdout:"pipe",stderr:"pipe"});
  expect(existsSync(join(out,"build/delivery-stream/index.html"))).toBe(true);
  expect(process.stderr.toString()).not.toContain("Cannot find");
});
test("MCP is optional; nonempty and overlapping destinations are refused",async()=>{
  const out=join(temp(),"package"),available=existsSync(join(root,"src/mcp/server.ts"));
  if(!available)await expect(packageBundle(out,{root,withMcp:true,scrubList:scrub()})).rejects.toThrow(/MCP server is not present/);
  const r=await packageBundle(out,{root,withMcp:available,scrubList:scrub()});expect(r.ok).toBe(true);
  expect(existsSync(join(out,"src/mcp/server.ts"))).toBe(available);expect(existsSync(join(out,"tests/mcp.test.ts"))).toBe(available);
  await expect(packageBundle(out,{root})).rejects.toThrow(/not empty/);
  await expect(packageBundle(join(root,"build/package"),{root})).rejects.toThrow(/inside/);
});
test("home paths, email addresses and scrub-list names block the staged package and echo only match kinds",async()=>{
  const tree=join(temp(),"source");mkdirSync(tree);
  for(const f of ["plumb.ts","package.json","README.md","SPEC.md","DEMO.md","CHANGELOG.md",".gitignore"])cpSync(join(root,f),join(tree,f));
  cpSync(join(root,"skill"),join(tree,"skill"),{recursive:true});
  const secret=["ForTests","OnlySecret"].join("");
  writeFileSync(join(tree,"DEMO.md"),[secret,["","Users","someone","project"].join("/"),"person"+"@"+["business","com"].join(".")].join("\n"));
  const list=join(temp(),"scrub.txt");writeFileSync(list,secret+"\n");const out=join(temp(),"package");
  const r=await packageBundle(out,{root:tree,scrubList:list});expect(r.ok).toBe(false);expect(existsSync(out)).toBe(false);
  expect(r.leaks.map(h=>h.what)).toEqual(["a name from the scrub list (its entry 1)","a /Users path","an email address"]);
  expect(JSON.stringify(r.leaks)).not.toContain(secret);
});
test("scrub parsing supports explicit section patterns, replacements and the legacy marker with no implicit allowance",()=>{
  const doc="# Notes\nAcme Labs\n## Comparison\nAcme Labs\n### Detail\nAcme Labs\n## Next\nAcme Labs\n";
  const parsed=parseScrubList("section: ^Comparison$\nallow-in-section: Acme Labs => a company\nlandscape: Beta Corp\n[bad\n");
  expect(parsed.list.map(([re,rep,allowed])=>[re.source,rep,allowed])).toEqual([["Acme Labs","a company",true],["Beta Corp","[scrubbed]",true]]);
  expect(parsed.problems.length).toBe(1);expect([...sectionLines(doc,parsed.sections)]).toEqual([3,4,5,6]);
  const d=temp();writeFileSync(join(d,"example.md"),doc);
  expect(leakCheck(d,["example.md"],[/Acme Labs/],[true],{sectionPatterns:parsed.sections}).map(h=>h.line)).toEqual([2,8]);
  expect(leakCheck(d,["example.md"],[/Acme Labs/],[true]).map(h=>h.line)).toEqual([2,4,6,8]);
  const warnings:string[]=[];expect(loadScrubList(join(d,"missing.txt"),m=>warnings.push(m)).found).toBe(false);expect(warnings).toHaveLength(1);
});
test("Plumb settings take priority, and deprecated environment settings print a notice",()=>{
  expect(setting("SCRUB_LIST",{PLUMB_SCRUB_LIST:"new",DE_SCRUB_LIST:"old"})).toBe("new");
  const messages:string[]=[];const write=process.stderr.write;
  process.stderr.write=((message:any)=>{messages.push(String(message));return true;}) as any;
  try{expect(setting("SCRUB_LIST",{DE_SCRUB_LIST:"old"})).toBe("old");}finally{process.stderr.write=write;}
  expect(messages).toEqual(["DE_SCRUB_LIST is deprecated; use PLUMB_SCRUB_LIST.\n"]);
  expect(scrubListPath({PLUMB_SCRUB_LIST:"./fictional-scrub.txt"})).toBe(join(process.cwd(),"fictional-scrub.txt"));
});
