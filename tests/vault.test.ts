import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildVault, humanRegion, HUMAN_START, HUMAN_END } from "../src/vault/build.ts";
import { loadNotes } from "../src/core/notes.ts";
import { leakCheck } from "../src/dev/package.ts";
import { sha256 } from "../src/core/util.ts";

const root = join(import.meta.dir, "..");
const temp = () => mkdtempSync(join(tmpdir(), "plumb-vault-test-"));
function fixture() {
  const base = temp(); cpSync(join(root, "examples"), join(base, "examples"), { recursive: true });
  return { base, target: join(base, "examples/portfolio"), out: join(base, "vault") };
}
function files(out: string): Record<string, string> { return Object.fromEntries(readdirSync(out).filter((f) => f !== ".obsidian").sort().map((f) => [f, readFileSync(join(out, f), "utf8")])); }
function front(text: string): any { return Bun.YAML.parse(text.split("---\n")[1]); }
function page(out: string, kind: string, id?: string) {
  const found = Object.entries(files(out)).find(([f,t]) => f.endsWith(".md") && front(t).kind === kind && (!id || front(t).id === id));
  if (!found) throw new Error(`missing ${kind} ${id}`); return { file: found[0], text: found[1], path: join(out, found[0]) };
}
function annotate(p: ReturnType<typeof page>, text: string) { writeFileSync(p.path, p.text.replace(HUMAN_START, HUMAN_START + text)); }
const now = () => "2026-10-28T16:00:00Z";

describe("Obsidian generated vault", () => {
  test("same inputs write the same bytes, all frontmatter is typed, all generated wikilinks resolve", async () => {
    const {target, out, base} = fixture();
    const first = await buildVault(target, out);
    expect(first.ok).toBe(true);
    const a = files(out);
    await buildVault(target, out); expect(files(out)).toEqual(a);
    const second = join(base,"second"); await buildVault(target, second); expect(files(second)).toEqual(a);
    const names = new Set(Object.keys(a).filter((f) => f.endsWith(".md")).map((f) => f.slice(0,-3)));
    for (const [f,t] of Object.entries(a)) if (f.endsWith(".md")) {
      const fm = front(t);
      for (const field of ["id", "kind", "design", "status", "name"]) expect(typeof fm[field]).toBe("string");
      expect(Array.isArray(fm.owner_team)).toBe(true);
      expect(fm.aliases).toEqual([fm.name, fm.id]);
      expect(fm.record).toBeUndefined(); expect(fm.attrs).toBeUndefined();
      for (const [field,value] of Object.entries(fm)) {
        if (["aliases","owner_team"].includes(field)) expect((value as any[]).every((v)=>typeof v==="string")).toBe(true);
        else expect(value===null || ["string","number","boolean"].includes(typeof value)).toBe(true);
      }
      expect(humanRegion(t)).toBeDefined();
      for (const link of t.slice(t.indexOf("\n---\n", 4) + 5).matchAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g)) {
        expect(names.has(link[1])).toBe(true);
        expect(link[2]).toBe(front(a[link[1]+".md"]).name.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"));
      }
      expect([...t.matchAll(/\[\[/g)].length).toBe([...t.matchAll(/\[\[[^\]|]+\|[^\]]+\]\]/g)].length);
      if (fm.kind === "part") expect(typeof fm.today_only).toBe("boolean");
      if (fm.kind === "relationship") { expect(typeof fm.from).toBe("string"); expect(typeof fm.to).toBe("string"); }
      if (fm.kind === "unit") { expect(typeof fm.phase).toBe("string"); expect(t).toContain("**Elements:**"); }
    }
    expect(first.counts).toMatchObject({ design: 3, portfolio: 1, part: 36, relationship: 44, unit: 36 });
  });

  test("discovery and confirmation retain original provenance and refused agent confirmations stay discovered", async () => {
    const {target,out,base} = fixture();
    const current = join(base,"examples/designs/inventory/current.yaml");
    const input = Bun.YAML.parse(readFileSync(current,"utf8")) as any;
    const records = Object.values(input.parts) as any[];
    const ids = Object.keys(input.parts);
    expect(ids.length).toBeGreaterThan(1);
    records[0].found = { by: "agent:catalog-scout", from: "the fictional catalog", as_of: "2026-10-20", confidence: "medium" };
    delete records[0].confirmed;
    records[1].found = { by: "the inventory lead", from: "the review", as_of: "2026-10-21", confidence: "high" };
    records[1].confirmed = { by: "the inventory lead", at: "2026-10-22" };
    records[2].confirmed = { by: "agent:catalog-scout", at: "2026-10-22" };
    writeFileSync(current, JSON.stringify(input));
    await buildVault(target,out);
    const d = page(out,"part",`inventory:${ids[0]}`), c = page(out,"part",`inventory:${ids[1]}`), refused = page(out,"part",`inventory:${ids[2]}`);
    expect(front(d.text)).toMatchObject({ status:"discovered", state:"discovered", confirmed_by:null, confirmed_at:null, found_by:"agent:catalog-scout",found_agent:"catalog-scout",found_as_of:"2026-10-20",found_from:"the fictional catalog",found_confidence:"medium" });
    expect(d.text).toContain("Discovered only. Not confirmed.");
    expect(front(c.text)).toMatchObject({ status:"confirmed", confirmed_by:"the inventory lead",confirmed_at:"2026-10-22",found_by:"the inventory lead",found_as_of:"2026-10-21" });
    expect(c.text).toContain("**Confirmed.**");
    expect(front(refused.text).state).toBe("discovered");
    expect(front(refused.text).refused).toBeTruthy();
    expect(front(refused.text).confirmed_by).toBeNull(); expect(front(refused.text).confirmed_at).toBeNull();
  });

  test("human text survives, imports as an open proposal through notes.yaml, and answers flow back without duplicate imports", async () => {
    const {target,out,base} = fixture(); await buildVault(target,out);
    const p = page(out,"part","intake:scanner-feeds");
    const actual = p ?? page(out,"part");
    const fm = front(actual.text), source = join(base,`examples/designs/${fm.design}`);
    const beforeNotes = loadNotes(source);
    const text = "Please review the owner team.\n\nKeep **this formatting**.\n";
    annotate(actual,text);
    const r = await buildVault(target,out,{now}); expect(r.ok).toBe(true); expect(r.imported).toBe(1);
    expect(humanRegion(readFileSync(actual.path,"utf8"))!.human).toBe(text);
    const notes = loadNotes(source)!;
    expect(notes.notes.length).toBe((beforeNotes?.notes.length ?? 0)+1);
    const n = notes.notes.at(-1)!;
    expect(n).toMatchObject({target:{kind:"element",id:fm.id.slice(fm.design.length+1)},status:"open",kind:"note",author:"person"});
    expect(n.text).toContain("Proposal from the vault");
    expect(n.text).toContain(text.trim());
    const snapshot = files(out);
    expect((await buildVault(target,out,{now})).imported).toBe(0); expect(files(out)).toEqual(snapshot);
    const notesPath=join(source,"notes.yaml");
    const input=Bun.YAML.parse(readFileSync(notesPath,"utf8")) as any;
    const last=input.notes.at(-1); last.answer="The lead will review it."; last.answered_by="agent"; last.status="answered"; delete last.sources; // The existing page answer path replaces answer sources.
    writeFileSync(notesPath,JSON.stringify(input));
    expect((await buildVault(target,out,{now})).imported).toBe(0);
    expect(loadNotes(source)!.notes.length).toBe(notes.notes.length);
    expect(readFileSync(actual.path,"utf8")).toContain("Answer (agent): The lead will review it.");
    expect(humanRegion(readFileSync(actual.path,"utf8"))!.human).toBe(text);
  });

  test("outside edits, changed fences and removed records are reported without merging or overwriting", async () => {
    const {target,out,base} = fixture(); await buildVault(target,out);
    const p=page(out,"unit"); const fm=front(p.text);
    annotate(p,"A human proposal.\n");
    writeFileSync(p.path,readFileSync(p.path,"utf8").replace("# ","# Changed "));
    const source=join(base,`examples/designs/${fm.design}`), before=loadNotes(source)?.version;
    const snapshot=files(out), r=await buildVault(target,out,{now});
    expect(r.ok).toBe(false); expect(r.conflicts.some((s)=>s.includes("outside its human region"))).toBe(true);
    expect(files(out)).toEqual(snapshot); expect(loadNotes(source)?.version).toBe(before);
    writeFileSync(p.path,p.text.replace(HUMAN_END,"gone"));
    expect((await buildVault(target,out)).conflicts.length).toBeGreaterThan(0);
    writeFileSync(p.path,p.text);
    const planPath=join(source,"plan.yaml"), plan=Bun.YAML.parse(readFileSync(planPath,"utf8")) as any;
    plan.units=plan.units.filter((u:any)=>u.id!==fm.id.slice(fm.design.length+1)); writeFileSync(planPath,JSON.stringify(plan));
    const removed=await buildVault(target,out);
    expect(removed.ok).toBe(false); expect(removed.conflicts.some((s)=>s.includes("retained for review"))).toBe(true);
    expect(existsSync(p.path)).toBe(true);
  });

  test("team and index annotations use the same engine note path", async () => {
    const {base,target,out}=fixture(); await buildVault(target,out);
    const team=page(out,"team"), design=page(out,"design"), portfolio=page(out,"portfolio");
    for(const p of [team,design,portfolio]) annotate(p,"Review this scope.\n");
    const r=await buildVault(target,out,{now}); expect(r.imported).toBe(3); expect(r.ok).toBe(true);
    const orgNotes=loadNotes(join(base,"examples/shared"))!.notes;
    expect(orgNotes.some((n)=>n.target.kind==="team" && n.text.includes("Review this scope"))).toBe(true);
    expect(loadNotes(target)!.notes.some((n)=>n.target.kind==="portfolio")).toBe(true);
    const designHome=front(design.text).design;
    expect(loadNotes(join(base,`examples/designs/${designHome}`))!.notes.some((n)=>n.target.kind==="design")).toBe(true);
  });

  test("packaging reuses the leak check and blocks source leaks and human leaks before any writes", async () => {
    const {base,target,out}=fixture(); const scrub=join(base,"scrub.txt"); writeFileSync(scrub,"Secret Fictional Label\n");
    expect((await buildVault(target,out,{packaging:true,scrubList:scrub})).ok).toBe(true);
    const p=page(out,"part"), snapshotSource=loadNotes(join(base,`examples/designs/${front(p.text).design}`))?.version;
    annotate(p,`Secret Fictional Label
/${"Users"}/someone/private
/home/someone/private
C:\\Users\\someone\\private
reader@example.com
${"reader"}@${"somewhere"}.org
`);
    const snapshot=files(out),r=await buildVault(target,out,{packaging:true,scrubList:scrub});
    expect(r.ok).toBe(false); expect(r.leaks.some((h)=>h.what.includes("scrub list"))).toBe(true);
    expect(r.leaks.filter((h)=>h.what.includes("path")).length).toBe(3);
    expect(r.leaks.filter((h)=>h.what.includes("email")).length).toBe(2);
    expect(files(out)).toEqual(snapshot);
    expect(loadNotes(join(base,`examples/designs/${front(p.text).design}`))?.version).toBe(snapshotSource);
    const fresh=join(base,"fresh");
    const model=join(base,`examples/designs/${front(p.text).design}/model.yaml`);
    writeFileSync(model,readFileSync(model,"utf8")+"\n# A comment is not rendered.\n");
    const input=Bun.YAML.parse(readFileSync(model,"utf8")) as any; input.elements[0].description=`${"reader"}@${"somewhere"}.org`; writeFileSync(model,JSON.stringify(input));
    expect((await buildVault(target,fresh,{packaging:true,scrubList:scrub})).ok).toBe(false); expect(existsSync(fresh)).toBe(false);
  });

  test("standalone legacy designs, date option, Obsidian settings, and guarded output paths",async()=>{
    const base=temp(),target=join(root,"examples/delivery-stream"),out=join(base,"vault");
    expect((await buildVault(target,out,{today:"2026-10-28"})).ok).toBe(true);
    expect(front(page(out,"unit").text).as_of).toBe("2026-10-28");
    const before=files(out); const config=join(out,".obsidian");
    const {mkdirSync}=await import("node:fs"); mkdirSync(config);writeFileSync(join(config,"app.json"),"{}");
    await buildVault(target,out,{today:"2026-10-28"});expect(files(out)).toEqual(before);expect(readFileSync(join(config,"app.json"),"utf8")).toBe("{}");
    await expect(buildVault(target,target)).rejects.toThrow("source inputs");
    await expect(buildVault(target,join(base,"bad"),{today:"2026-02-30"})).rejects.toThrow("valid");
    const leaked=join(base,"leaks");mkdirSync(leaked);writeFileSync(join(leaked,"data.txt"),"contact@example.com\n");
    expect(leakCheck(leaked,["data.txt"],[])).toHaveLength(0);
    expect(leakCheck(leaked,["data.txt"],[],[],{strictEmails:true})).toHaveLength(1);
  });
});

// Exercise the existing HTTP handler without requiring a listening socket in restricted environments.
test("the shared notes writer serves both API and vault imports, with stale-write protection", async () => {
  const { handleNotes, TOKEN_HEADER, NOTES_PATH } = await import("../src/dev/notes-api.ts");
  const { notesVersion, writeNoteEdit } = await import("../src/core/notes.ts");
  const dir = temp(), original = "# Keep this comment.\nnotes: []\n", path = join(dir, "notes.yaml");
  writeFileSync(path, original);
  const ctx = { dir, port: () => 4317, token: "test-token", bundle: () => undefined, now };
  const post = (version: string, text: string) => handleNotes(new Request(`http://127.0.0.1:4317${NOTES_PATH}`, { method:"POST", headers:{host:"127.0.0.1:4317",origin:"http://127.0.0.1:4317","content-type":"application/json",[TOKEN_HEADER]:ctx.token}, body:JSON.stringify({op:"add",version,target:{kind:"element",id:"part"},kind:"note",text}) }),ctx);
  const response = await post(notesVersion(original),"Review the part.");
  expect(response.status).toBe(200); expect(readFileSync(path,"utf8")).toContain("# Keep this comment.");
  const after=readFileSync(path,"utf8");
  expect((await post(notesVersion(original),"Stale edit")).status).toBe(409);
  expect(readFileSync(path,"utf8")).toBe(after);
  const n=loadNotes(dir)!.notes[0];
  expect(()=>writeNoteEdit(dir,notesVersion(original),{op:"replace",id:n.id,note:{...n,text:"stale"}})).toThrow("changed");
  expect(readFileSync(path,"utf8")).toBe(after);
  writeFileSync(path,"notes: [broken");
  expect(()=>writeNoteEdit(dir,notesVersion("notes: [broken"),{op:"add",note:n})).toThrow("problems");
});

test("source changes regenerate fields while human notes survive, and filename encoding avoids collisions",async()=>{
  const base=temp(),target=join(base,"source"),out=join(base,"vault");
  cpSync(join(root,"tests/fixtures/mini"),target,{recursive:true});
  const model=join(target,"model.yaml"),input=Bun.YAML.parse(readFileSync(model,"utf8")) as any;
  input.elements.push({id:"a/b",name:"First collision",kind:"service"},{id:"a?b",name:"Second collision",kind:"service"});writeFileSync(model,JSON.stringify(input));
  await buildVault(target,out);
  const a=page(out,"part","mini:a/b"),b=page(out,"part","mini:a?b");expect(a.file).not.toBe(b.file);
  annotate(a,"Please inspect this part.\n");await buildVault(target,out,{now});
  const currentBefore=readFileSync(model,"utf8");expect(currentBefore).toBe(JSON.stringify(input));
  input.elements.find((e:any)=>e.id==="a/b").description="New source description.";writeFileSync(model,JSON.stringify(input));
  const r=await buildVault(target,out,{now});expect(r.ok).toBe(true);
  const text=readFileSync(a.path,"utf8");expect(front(text).description).toBeUndefined();expect(text).toContain("New source description.");expect(humanRegion(text)!.human).toBe("Please inspect this part.\n");
});

test("all record kinds route annotations to existing note targets",async()=>{
  const {target,out,base}=fixture();await buildVault(target,out);
  const kinds=["relationship","contract","unit","milestone","finding"];
  const selected=kinds.map((kind)=>{
    const entry=Object.entries(files(out)).find(([f,t])=>f.endsWith(".md") && front(t).kind===kind && front(t).design==="intake");
    if(!entry)throw Error("missing own record "+kind);
    return {file:entry[0],text:entry[1],path:join(out,entry[0])};
  });
  for(const p of selected)annotate(p,`Review this ${front(p.text).kind}.\n`);
  const r=await buildVault(target,out,{now});expect(r.ok).toBe(true);expect(r.imported).toBe(kinds.length);
  const notes=loadNotes(join(base,"examples/designs/intake"))!.notes;
  for(const kind of ["relationship","contract","unit","phase","finding"])expect(notes.some((n)=>n.target.kind===kind && n.sources?.some((s)=>s.startsWith("vault:")))).toBe(true);
  expect((await buildVault(target,out,{now})).ok).toBe(true);
});

test("shared ownership roles and portfolio findings retain their scoped note homes",async()=>{
  const {target,out,base}=fixture();const first=await buildVault(target,out);
  const role=Object.entries(files(out)).find(([f,t])=>f.endsWith('.md')&&front(t).kind==='team'&&front(t).design==='shared')!;
  const finding=Object.entries(files(out)).find(([f,t])=>f.endsWith('.md')&&front(t).kind==='finding'&&front(t).pack==='portfolio')!;
  expect(role).toBeDefined();expect(finding).toBeDefined();
  for(const [file,text] of [role,finding])annotate({file,text,path:join(out,file)},"Please review this shared decision.\n");
  const result=await buildVault(target,out,{now});expect(result.ok).toBe(true);expect(result.imported).toBe(2);
  expect(result.counts.finding).toBe(first.counts.finding);
  expect(loadNotes(target)!.notes.some((n)=>n.target.kind==='finding')).toBe(true);
  expect(loadNotes(join(base,'examples/shared'))!.notes.some((n)=>n.target.kind==='team'&&n.target.id.startsWith('shared:'))).toBe(true);
});

test("packaging also scans preserved Obsidian settings",async()=>{
  const {target,out}=fixture();await buildVault(target,out);
  const {mkdirSync}=await import('node:fs');mkdirSync(join(out,'.obsidian'));
  const settings=join(out,'.obsidian','app.json');
  const text=JSON.stringify({contact:`${'reviewer'}@${'somewhere'}.org`});writeFileSync(settings,text);
  const result=await buildVault(target,out,{packaging:true});expect(result.ok).toBe(false);
  expect(result.leaks.some((h)=>h.file==='.obsidian/app.json'&&h.what==='an email address')).toBe(true);
  expect(readFileSync(settings,'utf8')).toBe(text);
});

function mini() {
  const base=temp(), target=join(base,"source"), out=join(base,"vault");
  cpSync(join(root,"tests/fixtures/mini"),target,{recursive:true});
  const model=join(target,"model.yaml"), input=Bun.YAML.parse(readFileSync(model,"utf8")) as any;
  const save=()=>writeFileSync(model,JSON.stringify(input));
  return {base,target,out,model,input,save};
}

test("plain names stay readable; equal, case-folded, normalized and sanitized names get short stable suffixes",async()=>{
  const {base,target,out,input,save}=mini();
  const names=["Shared name","Shared name","shared NAME","a/b","a?b","Café","Cafe\u0301","CON",".","A [link] #tag | pipe", "界".repeat(100),"界".repeat(101)];
  for(const [i,name] of names.entries()) input.elements.push({id:`extra-${i}`,name,kind:"service"});
  save(); expect((await buildVault(target,out)).ok).toBe(true);
  expect(page(out,"part","mini:customer").file).toBe("Customer.md");
  expect(page(out,"team","mini:counter").file).toBe("Front counter.md");
  expect(page(out,"contract","mini:ticket").file).toBe("ticket.md");
  for(const i of [0,1,2,3,4,5,6,10,11]) expect(page(out,"part",`mini:extra-${i}`).file).toMatch(/ \([a-f0-9]{8}\)\.md$/);
  const snapshot=files(out), filenames=Object.keys(snapshot);
  expect(new Set(filenames.map(f=>f.normalize("NFC").toLowerCase())).size).toBe(filenames.length);
  for(const f of filenames) { expect(Buffer.byteLength(f)).toBeLessThan(256); expect(f).not.toMatch(/[<>:"/\\|?*\[\]#^]/); }
  const special=page(out,"part","mini:extra-9");
  const index=page(out,"design");
  expect(index.text).toContain(`[[${special.file.slice(0,-3)}|A &#91;link&#93; #tag &#124; pipe]]`);
  // A natural name resembling a generated suffix also keeps its plain filename.
  const collision=page(out,"part","mini:extra-0").file.slice(0,-3);
  input.elements.push({id:"looks-like-suffix",name:collision,kind:"service"});save();
  expect((await buildVault(target,out)).ok).toBe(true);
  expect(page(out,"part","mini:looks-like-suffix").file).toBe(collision+".md");
  expect(page(out,"part","mini:extra-0").file).not.toBe(collision+".md");
  input.elements.reverse();save();const fresh=join(base,"fresh");
  expect((await buildVault(target,fresh)).ok).toBe(true);expect(files(fresh)).toEqual(files(out));
});

test("record renames, collision changes and name swaps carry each human region by manifest identity",async()=>{
  const {base,target,out,input,save}=mini(); await buildVault(target,out);
  const customer=page(out,"part","mini:customer"), intake=page(out,"part","mini:pickup");
  const textA="Customer proposal.\n\nKeep **formatting**.\n", textB="Pickup proposal.\n";
  annotate(customer,textA);annotate(intake,textB);
  const a=input.elements.find((e:any)=>e.id==="customer"), b=input.elements.find((e:any)=>e.id==="pickup");
  a.name="Pickup shelf";b.name="Customer";save();
  let r=await buildVault(target,out,{now});expect(r.ok).toBe(true);expect(r.imported).toBe(2);
  const verify=()=>{
    expect(humanRegion(page(out,"part","mini:customer").text)!.human).toBe(textA);
    expect(humanRegion(page(out,"part","mini:pickup").text)!.human).toBe(textB);
  };verify();
  expect(page(out,"part","mini:customer").file).toBe("Pickup shelf.md");
  a.name="Customer";save();r=await buildVault(target,out,{now});expect(r.ok).toBe(true);expect(r.imported).toBe(0);verify();
  expect(page(out,"part","mini:customer").file).toMatch(/^Customer \([a-f0-9]{8}\)\.md$/);
  expect(existsSync(join(out,"Customer.md"))).toBe(false);
  b.name="CUSTOMER SERVICE";save();expect((await buildVault(target,out,{now})).ok).toBe(true);verify();
  b.name="customer service";save();expect((await buildVault(target,out,{now})).ok).toBe(true);verify();
  expect(page(out,"part","mini:customer").file).toBe("Customer.md");
  expect(page(out,"part","mini:pickup").file).toBe("customer service.md");
  const snapshot=files(out);expect((await buildVault(target,out,{now})).imported).toBe(0);expect(files(out)).toEqual(snapshot);
  expect(loadNotes(target)!.notes.filter(n=>n.sources?.some(s=>s.startsWith("vault:")))).toHaveLength(2);
  // Generated shells and the manifest match an independent build; human bytes stay local.
  const fresh=join(base,"fresh");await buildVault(target,fresh);
  const generated=(all:Record<string,string>)=>Object.fromEntries(Object.entries(all).map(([f,t])=>[f,f.endsWith(".md")?humanRegion(t)!.shell:t]));
  expect(generated(files(out))).toEqual(generated(files(fresh)));
});

test("format 1 id-based vaults migrate without orphaning annotations or retaining duplicate notes",async()=>{
  const {target,out}=mini();await buildVault(target,out);
  const p=page(out,"part","mini:customer");annotate(p,"Keep this legacy annotation.\n");
  const manifestPath=join(out,".plumb-vault.json"), manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
  const entries:Record<string,any>={};
  for(const [file,stamp] of Object.entries(manifest.files) as [string,any][]) {
    const fm=front(readFileSync(join(out,file),"utf8"));
    const legacy=`${fm.kind}-${fm.id.replace(/[^A-Za-z0-9_-]/g,"-").slice(0,75)}-${sha256(stamp.key).slice(0,16)}.md`;
    renameSync(join(out,file),join(out,legacy));entries[legacy]=stamp;
  }
  manifest.files=entries;writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+"\n");
  const count=readdirSync(out).length,r=await buildVault(target,out,{now});
  expect(r.ok).toBe(true);expect(r.imported).toBe(1);expect(readdirSync(out)).toHaveLength(count);
  expect(humanRegion(page(out,"part","mini:customer").text)!.human).toBe("Keep this legacy annotation.\n");
  for(const old of Object.keys(entries))expect(existsSync(join(out,old))).toBe(false);
  const snapshot=files(out);expect((await buildVault(target,out,{now})).imported).toBe(0);expect(files(out)).toEqual(snapshot);
});

test("rename preflight retains edited, missing and unmanaged notes and rejects duplicate manifest identities",async()=>{
  const {target,out,input,save}=mini();await buildVault(target,out);
  const p=page(out,"part","mini:customer");annotate(p,"A pending proposal.\n");
  input.elements.find((e:any)=>e.id==="customer").name="Renamed customer";save();
  writeFileSync(p.path,readFileSync(p.path,"utf8").replace("# Customer","# Edited"));
  let snapshot=files(out),r=await buildVault(target,out,{now});expect(r.ok).toBe(false);expect(files(out)).toEqual(snapshot);expect(loadNotes(target)).toBeUndefined();
  annotate({...p},"A pending proposal.\n");
  const displaced=join(out,"Unmanaged.md");renameSync(p.path,displaced);snapshot=files(out);
  r=await buildVault(target,out,{now});expect(r.conflicts.some(c=>c.includes("missing"))).toBe(true);expect(r.conflicts.some(c=>c.includes("unmanaged"))).toBe(true);expect(files(out)).toEqual(snapshot);
  renameSync(displaced,p.path);
  const manifestPath=join(out,".plumb-vault.json"),manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
  const stamps=Object.values(manifest.files) as any[];stamps[1].key=stamps[0].key;writeFileSync(manifestPath,JSON.stringify(manifest));snapshot=files(out);
  await expect(buildVault(target,out,{now})).rejects.toThrow("invalid identity");expect(files(out)).toEqual(snapshot);expect(loadNotes(target)).toBeUndefined();
});

test("packaging checks the readable body and refuses renames before any annotation or vault write",async()=>{
  const {base,target,out,input,save}=mini(),scrub=join(base,"scrub.txt");writeFileSync(scrub,"Private Fictional Detail\n");await buildVault(target,out);
  const p=page(out,"part","mini:customer");annotate(p,"Review before renaming.\n");
  const e=input.elements.find((e:any)=>e.id==="customer");e.name="Renamed customer";e.attrs={nested:{evidence:"Private Fictional Detail"}};save();
  const snapshot=files(out),r=await buildVault(target,out,{now,packaging:true,scrubList:scrub});
  expect(r.ok).toBe(false);expect(r.leaks.some(h=>h.file==="Renamed customer.md"&&h.what.includes("scrub list"))).toBe(true);
  expect(files(out)).toEqual(snapshot);expect(loadNotes(target)).toBeUndefined();
});

test("nested attributes and record lists render as readable details while scalar filters retain their types",async()=>{
  const {target,out,input,save}=mini();input.elements[0].attrs={audit:{score:7,enabled:true},evidence:["Catalog",{source:"Workshop review",accepted:false}]};save();await buildVault(target,out);
  const p=page(out,"part","mini:customer"),fm=front(p.text);
  expect(fm.today_only).toBe(false);expect(front(page(out,"milestone","mini:ph1").text).order).toBe(1);expect(fm.attrs).toBeUndefined();expect(fm.record).toBeUndefined();
  expect(p.text).toContain("## Record details\n\n- **Attrs:**\n  - **Audit:**\n    - **Enabled:** true\n    - **Score:** 7");
  expect(p.text).toContain("**Source:** Workshop review");expect(p.text).toContain("**Accepted:** false");
  const unit=page(out,"unit","mini:u1");expect(front(unit.text).phase).toBe("mini:ph1");expect(unit.text).toContain("**Provides:**\n  - tickets");
});

test("a new record reusing an obsolete name cannot inherit the old record's human text",async()=>{
  const {target,out,input,save}=mini();input.elements.push({id:"old-record",name:"Reusable name",kind:"service"});save();await buildVault(target,out);
  const p=page(out,"part","mini:old-record");annotate(p,"This belongs only to the old record.\n");
  input.elements.find((e:any)=>e.id==="old-record").id="new-record";save();
  const snapshot=files(out),r=await buildVault(target,out,{now});
  expect(r.ok).toBe(false);expect(r.conflicts).toContain("Reusable name.md: record no longer generated; retained for review");
  expect(files(out)).toEqual(snapshot);expect(loadNotes(target)).toBeUndefined();
});

test("manifest filenames cannot escape the vault",async()=>{
  const {target,out}=mini();await buildVault(target,out);
  const manifestPath=join(out,".plumb-vault.json"),manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
  const stamp=Object.values(manifest.files)[0];manifest.files={"../escape.md":stamp};writeFileSync(manifestPath,JSON.stringify(manifest));
  const snapshot=files(out);await expect(buildVault(target,out)).rejects.toThrow("invalid file");expect(files(out)).toEqual(snapshot);
});

test("a 0.4 or draft vault upgrades its verified legacy manifest and markers while preserving human text",async()=>{
  const {target,out}=mini();
  expect((await buildVault(target,out)).ok).toBe(true);
  const manifestPath=join(out,".plumb-vault.json");
  const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
  const p=page(out,"part","mini:customer");
  for(const file of Object.keys(manifest.files)){
    let text=readFileSync(join(out,file),"utf8").replaceAll("plumb:human:","de:human:").replace("Generated by Plumb 0.6.0","Generated by design engine 0.4.1");
    if(file===p.file)text=text.replace("<!-- de:human:start -->\n","<!-- de:human:start -->\nKeep this older annotation.\n");
    writeFileSync(join(out,file),text);
    manifest.files[file].generated=sha256(humanRegion(text)!.shell);
  }
  manifest.engine="0.4.1";
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+"\n");
  renameSync(manifestPath,join(out,".de-vault.json"));
  const result=await buildVault(target,out,{now});
  expect(result.ok).toBe(true);expect(result.imported).toBe(1);
  expect(existsSync(join(out,".de-vault.json"))).toBe(false);
  expect(existsSync(manifestPath)).toBe(true);
  const after=readFileSync(join(out,p.file),"utf8");
  expect(after).toContain(HUMAN_START);expect(after).toContain(HUMAN_END);
  expect(humanRegion(after)!.human).toBe("Keep this older annotation.\n");
  expect(loadNotes(target)!.notes.some(n=>n.text.includes("Keep this older annotation."))).toBe(true);
  expect((await buildVault(target,out,{now})).imported).toBe(0);
});
