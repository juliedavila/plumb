import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addDesign } from "../src/design/add.ts";
import { hash, yamlText, FILE_LIMIT } from "../src/design/manifest.ts";
import { filesDigest, readEdition, verifyEdition } from "../src/core/edition.ts";
import { buildBundle } from "../src/core/bundle.ts";
import { loadInstance } from "../src/core/load.ts";
import { runPortfolio } from "../src/core/portfolio.ts";
import { makeEditions } from "./fixtures/make-editions.ts";

const fixtures = join(import.meta.dir,"fixtures/editions");
const temps: string[] = [];
const temp = () => { const d=mkdtempSync(join(tmpdir(),"plumb-add-test-")); temps.push(d); return d; };
afterEach(()=> { for (const d of temps.splice(0)) rmSync(d,{recursive:true,force:true}); });
const Y = (p: string): any => Bun.YAML.parse(readFileSync(p,"utf8"));
const put = (p: string,value: unknown) => {mkdirSync(join(p,".."),{recursive:true});writeFileSync(p,yamlText(value));};
const source = () => {const d=temp();cpSync(fixtures,d,{recursive:true});return d;};
const release = (d: string,ns="intake") => join(d,ns,"1.0.0");
function changeStamp(d: string,fn: (s:any)=>void) { const path=join(d,"edition.yaml"),s=Y(path);fn(s);put(path,s); }
function rehash(d:string) {
  changeStamp(d,s=>{for(const f of s.files)f.sha256=hash(readFileSync(join(d,f.path)));s.shared.sha256=s.files.find((f:any)=>f.path===s.shared.path).sha256;if(s.manual_work)s.manual_work.sha256=s.files.find((f:any)=>f.path===s.manual_work.path).sha256;s.digest=filesDigest(s.files);});
}
function map(workspace:string,org=false) {
  const root=join(workspace,"instances/shared");
  const teams=[{id:"counter",name:"Front counter"},{id:"shop",name:"Workshop"}];
  put(join(root,"team-map.yaml"),{...(org?{}:{teams}),owners:{"counter operations":{teams:["counter"]},"repair operations":{teams:["shop"],verifier:"counter",decider:["counter"],not:["counter"]}}});
  if(org)put(join(root,"org.yaml"),{teams});
}
const add = (workspace:string,from=fixtures,withPins=false) => addDesign("intake","1.0.0",{workspace,from,withPins});
const cli = (args:string[],cwd:string) => Bun.spawnSync([process.execPath,join(import.meta.dir,"../plumb.ts"),...args],{cwd,stdout:"pipe",stderr:"pipe"});

describe("design add from folders",()=>{
  test("deterministic generator; direct, namespace/version, and editions/namespace/version layouts",async()=>{
    const generated=temp();makeEditions(generated);
    expect(readFileSync(join(generated,"premerge/1.0.0/edition.yaml"))).toEqual(readFileSync(join(fixtures,"premerge/1.0.0/edition.yaml")));
    const nested=temp();cpSync(fixtures,join(nested,"editions"),{recursive:true});
    for(const from of [release(fixtures),fixtures,nested]){
      const workspace=temp();const result=await add(workspace,from);
      expect(result).toMatchObject([{namespace:"intake",version:"1.0.0",resolved:0,unresolved:2}]);
      const dir=join(workspace,"instances/intake/editions/1.0.0");
      for(const f of ["edition.yaml",...Y(join(release(fixtures),"edition.yaml")).files.map((f:any)=>f.path)])expect(readFileSync(join(dir,f))).toEqual(readFileSync(join(release(fixtures),f)));
      expect(verifyEdition(readEdition(join(workspace,"instances/intake"),"1.0.0"))).toEqual([]);
      expect(Y(join(workspace,"instances/shared/engine.yaml"))).toMatchObject({kind:"root",shared_from:{editions:[{namespace:"intake",version:"1.0.0",sha256:result[0].sha256}]}});
      expect(existsSync(join(workspace,"instances/shared/team-map.yaml"))).toBe(false);
      expect(Object.keys(Y(join(workspace,"instances/shared/team-map.draft.yaml")).owners)).toEqual(["counter operations","repair operations"]);
      expect(Y(join(workspace,"instances/intake/model.yaml")).elements[0].owner).toBe("counter operations");
    }
  });
  test("with-pins adds dependencies first, builds through the CLI, composes working and presenting",async()=>{
    const workspace=temp();map(workspace,true);
    const r=await addDesign("premerge","1.0.0",{workspace,from:fixtures,withPins:true});
    expect(r.map(d=>d.namespace)).toEqual(["intake","premerge"]);
    expect(r.map(d=>d.resolved)).toEqual([2,2]);
    for(const ns of ["intake","premerge"]){
      const dir=join(workspace,"instances",ns);const b=await buildBundle(dir);
      expect(b.bundle.findings.filter(f=>f.severity==="error")).toEqual([]);
      expect(Y(join(dir,"model.yaml")).teams).toEqual([]);
      expect(cli(["build",dir],workspace).exitCode).toBe(0);
    }
    const portfolio=join(workspace,"portfolios/repairs");
    put(join(portfolio,"portfolio.yaml"),{name:"repairs",title:"Repair services",root:"../../instances/shared",designs:[{namespace:"intake",from:"../../instances/intake"},{namespace:"premerge",from:"../../instances/premerge"}]});
    for(const mode of ["working","presenting"] as const){const run=await runPortfolio(portfolio,{mode});expect(run.data.stopped).toBeFalsy();expect(run.data.findings.filter(f=>f.severity==="error")).toEqual([]);}
    const command=cli(["design","add","premerge@1.0.0","--from",fixtures,"--workspace",workspace],workspace);
    expect(command.exitCode).toBe(0);expect(command.stdout.toString()).toContain("plumb portfolio build");
  });
  test("same stamp re-derives against a new team map; every live-state category survives",async()=>{
    const workspace=temp();await add(workspace);
    const dir=join(workspace,"instances/intake");
    const files=["progress.yaml","milestones.yaml","current.yaml","notes.yaml","deck.yaml","tour.yaml","patches/keep.yaml","tracker/links.yaml","reports/keep.json"];
    for(const f of files){mkdirSync(join(dir,f,".."),{recursive:true});writeFileSync(join(dir,f),`# authored ${f}\n`);}
    map(workspace);const teamBytes=readFileSync(join(workspace,"instances/shared/team-map.yaml"));
    const result=await add(workspace);expect(result[0].resolved).toBe(2);expect(result[0].unresolved).toBe(0);
    expect(readFileSync(join(workspace,"instances/shared/team-map.yaml"))).toEqual(teamBytes);
    expect(Y(join(dir,"model.yaml")).elements[0]).toMatchObject({owner:"counter",owner_as_written:"counter operations",attrs:{design_role:"counter operations"}});
    expect(Y(join(workspace,"instances/shared/team-map.draft.yaml"))).toEqual({owners:{}});
    for(const f of files)expect(readFileSync(join(dir,f),"utf8")).toBe(`# authored ${f}\n`);
    expect(verifyEdition(readEdition(dir,"1.0.0"))).toEqual([]);
    writeFileSync(join(dir,"editions/1.0.0/model.engine.yaml"),"# tampered adapter\n");
    expect(()=>loadInstance(dir,{edition:"1.0.0"})).toThrow(/not intact/);
  });
  test("published root-level engine inputs remain intact when adapter names would collide",async()=>{
    const from=source(),dir=release(from),path="Engine.yaml";
    writeFileSync(join(dir,path),readFileSync(join(dir,"plumb/engine.yaml")));
    changeStamp(dir,s=>{s.plumb.engine=path;s.files.push({path,sha256:hash(readFileSync(join(dir,path)))});s.digest=filesDigest(s.files);});
    const workspace=temp();map(workspace);await add(workspace,from);
    const instance=join(workspace,"instances/intake"),frozen=join(instance,"editions/1.0.0");
    expect(readFileSync(join(frozen,path))).toEqual(readFileSync(join(dir,path)));
    expect(Y(join(frozen,"engine-import.yaml")).adapters.engine).toBe("adapter-engine.yaml");
    expect(verifyEdition(readEdition(instance,"1.0.0"))).toEqual([]);
    expect(loadInstance(instance,{edition:"1.0.0"}).config.name).toBe("intake");
  });
  test("partial maps leave sorted unresolved roles in a draft and never replace the written map",async()=>{
    const workspace=temp(),file=join(workspace,"instances/shared/team-map.yaml");
    put(file,{teams:[{id:"counter"}],owners:{"counter operations":{teams:["counter"]},"repair operations":{teams:[]}}});
    const before=readFileSync(file);const r=await add(workspace);
    expect(r[0]).toMatchObject({resolved:1,unresolved:1});expect(readFileSync(file)).toEqual(before);
    expect(Y(join(workspace,"instances/shared/team-map.draft.yaml"))).toEqual({owners:{"repair operations":{teams:[]}}});
  });
});

describe("verification refuses before workspace writes",()=>{
  test("absent pin reports the exact next command",async()=>{
    const workspace=join(temp(),"workspace");
    await expect(addDesign("premerge","1.0.0",{workspace,from:fixtures})).rejects.toThrow(`plumb design add intake@1.0.0 --from ${JSON.stringify(fixtures)} --workspace ${JSON.stringify(workspace)}`);
    expect(existsSync(workspace)).toBe(false);
  });
  test("present pin at a different version or hash is refused",async()=>{
    for(const field of ["version","hash"]){
      const workspace=temp();await add(workspace);
      const file=join(workspace,"instances/intake/edition.yaml");
      if(field==="version")changeStamp(dirnameFile(file),s=>s.version="2.0.0");else writeFileSync(file,readFileSync(file,"utf8")+"\n# changed stamp\n");
      await expect(addDesign("premerge","1.0.0",{workspace,from:fixtures,withPins:true})).rejects.toThrow(/installed version\/hash conflicts/);
      expect(existsSync(join(workspace,"instances/premerge"))).toBe(false);
    }
  });
  test("with-pins verifies the pin hash before installing either design",async()=>{
    const from=source();changeStamp(release(from,"premerge"),s=>s.pins[0].sha256="0".repeat(64));const workspace=temp();
    await expect(addDesign("premerge","1.0.0",{workspace,from,withPins:true})).rejects.toThrow(/intake.*pinned SHA-256/);
    expect(existsSync(join(workspace,"instances"))).toBe(false);
  });
  test("tampered files, digest, identity, release flag, interface and unlisted inputs name their file",async()=>{
    const cases:[string,(d:string)=>void,string][]=[
      ["bytes",d=>writeFileSync(join(d,"plumb/model.yaml"),"tampered"),"plumb/model.yaml"],
      ["digest",d=>changeStamp(d,s=>s.digest="0".repeat(64)),"edition.yaml"],
      ["namespace",d=>changeStamp(d,s=>s.namespace="other"),"edition.yaml"],
      ["line",d=>changeStamp(d,s=>s.line="other"),"edition.yaml"],
      ["version",d=>changeStamp(d,s=>s.version="2.0.0"),"edition.yaml"],
      ["unreleased",d=>changeStamp(d,s=>s.released=false),"edition.yaml"],
      ["interface",d=>changeStamp(d,s=>s.plumb.interface=2),"edition.yaml"],
      ["unlisted",d=>changeStamp(d,s=>s.plumb.model="unlisted.yaml"),"unlisted.yaml"],
      ["shared hash",d=>changeStamp(d,s=>s.shared.sha256="0".repeat(64)),"shared/seams.yaml"],
      ["manual hash",d=>changeStamp(d,s=>s.manual_work.sha256="0".repeat(64)),"shared/manual-work.yaml"],
    ];
    for(const [,mutate,message] of cases){const from=source();mutate(release(from));const workspace=temp();await expect(add(workspace,from)).rejects.toThrow(message);expect(existsSync(join(workspace,"instances"))).toBe(false);}
  });
  test("traversal, absolute and duplicate paths, and symlinks are refused",async()=>{
    for(const path of ["../escape","/absolute","a/../escape","a\\escape","plumb/model.yaml","Engine-import.yaml/hidden","Edition.yaml/hidden"]){
      const from=source();changeStamp(release(from),s=>{s.files.push({path,sha256:"0".repeat(64)});s.digest=filesDigest(s.files);});
      const workspace=temp();await expect(add(workspace,from)).rejects.toThrow(/path/);expect(existsSync(join(workspace,"instances"))).toBe(false);
    }
    const from=source(),path=join(release(from),"plumb/model.yaml"),outside=join(temp(),"model.yaml");cpSync(path,outside);rmSync(path);symlinkSync(outside,path);
    await expect(add(temp(),from)).rejects.toThrow(/symbolic/);
  });
  test("a new stamp under the same version is refused without changing live files",async()=>{
    const workspace=temp();await add(workspace);const from=source();writeFileSync(join(release(from),"edition.yaml"),readFileSync(join(release(from),"edition.yaml"),"utf8")+"\n# new stamp\n");
    const before=readFileSync(join(workspace,"instances/intake/model.yaml"));await expect(add(workspace,from)).rejects.toThrow(/different edition stamp/);expect(readFileSync(join(workspace,"instances/intake/model.yaml"))).toEqual(before);
  });
  test("shared seams or manual-work mismatch identifies the design that supplied the root",async()=>{
    for(const file of ["seams.yaml","manual-work.yaml"]){
      const workspace=temp();await add(workspace);const from=source();
      const dir=release(from,"premerge");writeFileSync(join(dir,"shared",file),readFileSync(join(dir,"shared",file),"utf8")+"\n# other shared layer\n");rehash(dir);
      await expect(addDesign("premerge","1.0.0",{workspace,from})).rejects.toThrow(/intake@1.0.0/);expect(existsSync(join(workspace,"instances/premerge"))).toBe(false);
    }
  });
  test("recursive pin cycles are refused",async()=>{
    const from=source();changeStamp(release(from),s=>s.pins=[{namespace:"premerge",version:"1.0.0",sha256:"0".repeat(64)}]);
    changeStamp(release(from,"premerge"),s=>s.pins[0].sha256=hash(readFileSync(join(release(from),"edition.yaml"))));
    const workspace=temp();await expect(addDesign("premerge","1.0.0",{workspace,from,withPins:true})).rejects.toThrow(/pin cycle/);expect(existsSync(join(workspace,"instances"))).toBe(false);
  });
});
function dirnameFile(file:string){return join(file,"..");}

describe("GitHub edition transport",()=>{
  test("the transport also verifies manifest-only downloads and redirect bounds with an in-memory HTTP fixture",async()=>{
    const requests:string[]=[],oldFetch=globalThis.fetch,oldBase=process.env.PLUMB_GITHUB_RAW;
    process.env.PLUMB_GITHUB_RAW="http://mirror.invalid";
    let mode="release";
    globalThis.fetch=(async(input:any)=>{
      const url=new URL(String(input));requests.push(url.pathname);
      if(mode==="redirect")return new Response(null,{status:302,headers:{location:"http://other.invalid/release"}});
      if(mode==="loop")return new Response(null,{status:302,headers:{location:url.href}});
      if(mode==="oversize")return new Response("large",{headers:{"content-length":String(FILE_LIMIT+1)}});
      const match=/^\/fiction\/repairs\/[^/]+\/editions\/(intake|premerge)\/1.0.0\/(.+)$/.exec(url.pathname);
      return match&&existsSync(join(fixtures,match[1],"1.0.0",match[2]))?new Response(readFileSync(join(fixtures,match[1],"1.0.0",match[2]))):new Response("missing",{status:404});
    }) as typeof fetch;
    try{
      const workspace=temp();const result=await addDesign("premerge","1.0.0",{workspace,from:"github:fiction/repairs",withPins:true});
      expect(result.map(d=>d.namespace)).toEqual(["intake","premerge"]);
      expect(requests.length).toBe(2+Y(join(release(fixtures),"edition.yaml")).files.length+Y(join(release(fixtures,"premerge"),"edition.yaml")).files.length);
      expect(requests.every(path=>path.endsWith("edition.yaml")||["plumb/engine.yaml","plumb/model.yaml","plumb/plan.yaml","shared/seams.yaml","shared/manual-work.yaml"].some(file=>path.endsWith(file)))).toBe(true);
      for(const [next,error]of[["redirect",/another host/],["loop",/too many redirects/],["oversize",/32 MB/]] as const){mode=next;const target=temp();await expect(add(target,"github:fiction/repairs")).rejects.toThrow(error);expect(existsSync(join(target,"instances"))).toBe(false);}
    }finally{globalThis.fetch=oldFetch;if(oldBase===undefined)delete process.env.PLUMB_GITHUB_RAW;else process.env.PLUMB_GITHUB_RAW=oldBase;}
  });
  test("only listed files are fetched, including recursive pins; explicit ref/path and CLI defaults work",async()=>{
    const requests:string[]=[];
    const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){
      const path=decodeURIComponent(new URL(req.url).pathname);requests.push(path);
      const match=/^\/fiction\/repairs\/[^/]+\/(?:editions|custom)\/(intake|premerge)\/1.0.0\/(.+)$/.exec(path);
      return match && existsSync(join(fixtures,match[1],"1.0.0",match[2]))?new Response(readFileSync(join(fixtures,match[1],"1.0.0",match[2]))):new Response("missing",{status:404});
    }});
    const old=process.env.PLUMB_GITHUB_RAW;process.env.PLUMB_GITHUB_RAW=server.url.href;
    try{
      const workspace=temp();const r=await addDesign("premerge","1.0.0",{workspace,from:"github:fiction/repairs",withPins:true});
      expect(r.map(x=>x.namespace)).toEqual(["intake","premerge"]);
      const expected=["intake","premerge"].flatMap(ns=>["edition.yaml",...Y(join(fixtures,ns,"1.0.0/edition.yaml")).files.map((f:any)=>f.path)].map(f=>`/fiction/repairs/${ns}-v1.0.0/editions/${ns}/1.0.0/${f}`));
      expect(requests.sort()).toEqual(expected.sort());
      requests.length=0;await addDesign("intake","1.0.0",{workspace:temp(),from:"github:fiction/repairs",ref:"release",path:"custom/intake/1.0.0"});
      expect(requests.every(p=>p.startsWith("/fiction/repairs/release/custom/intake/1.0.0/"))).toBe(true);
      // A ref override names the requested release only; a pin resolves through its own version tag.
      requests.length=0;await addDesign("premerge","1.0.0",{workspace:temp(),from:"github:fiction/repairs",ref:"release",withPins:true});
      expect(requests.filter(p=>p.includes("/intake/")).every(p=>p.startsWith("/fiction/repairs/intake-v1.0.0/editions/intake/1.0.0/"))).toBe(true);
      expect(requests.filter(p=>p.includes("/premerge/")).every(p=>p.startsWith("/fiction/repairs/release/editions/premerge/1.0.0/"))).toBe(true);
    }finally{if(old===undefined)delete process.env.PLUMB_GITHUB_RAW;else process.env.PLUMB_GITHUB_RAW=old;server.stop(true);}
  });
  test("cross-host redirects and oversized files are refused before workspace writes",async()=>{
    let mode="redirect",otherRequests=0;
    const other=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){otherRequests++;return new Response("unexpected");}});
    const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){
      if(mode==="redirect")return new Response(null,{status:302,headers:{location:other.url.href}});
      if(new URL(req.url).pathname.endsWith("edition.yaml"))return new Response(readFileSync(join(release(fixtures),"edition.yaml")));
      // A real body past the cap: over a socket Bun sets the true length, so only streamed bytes can trip the limit.
      let sent=0;const chunk=new Uint8Array(1024*1024);
      return new Response(new ReadableStream({pull(c){if(sent>FILE_LIMIT){c.close();return;}c.enqueue(chunk);sent+=chunk.length;}}));
    }});
    const old=process.env.PLUMB_GITHUB_RAW;process.env.PLUMB_GITHUB_RAW=server.url.href;
    try{for(const next of ["redirect","size"]){mode=next;const workspace=temp();await expect(add(workspace,"github:fiction/repairs")).rejects.toThrow(next==="redirect"?/another host/:/32 MB/);expect(existsSync(join(workspace,"instances"))).toBe(false);}expect(otherRequests).toBe(0);}
    finally{if(old===undefined)delete process.env.PLUMB_GITHUB_RAW;else process.env.PLUMB_GITHUB_RAW=old;server.stop(true);other.stop(true);}
  });
});
