// Deterministic interface 1 releases of the fictional repair-shop fixture.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { filesDigest } from "../../src/core/edition.ts";
import { hash, yamlText } from "../../src/design/manifest.ts";

export function makeEditions(out = join(import.meta.dir,"editions")): void {
  const roles: Record<string,string> = { counter: "counter operations", shop: "repair operations" };
  let intakeHash = "";
  for (const ns of ["intake","premerge"]) {
    const dir = join(out,ns,"1.0.0");
    const y = (path: string) => Bun.YAML.parse(readFileSync(join(import.meta.dir,"mini",path),"utf8")) as any;
    const engine = {...y("engine.yaml"),name:ns,title:ns === "intake" ? "Repair intake" : "Repair preparation",schema:"0.4",namespace:ns,packs:["generic","plan"]};
    const model = y("model.yaml"), plan = y("plan.yaml");
    model.teams = [];
    for (const record of [...model.elements,...plan.units]) {
      if (record.owner) { record.owner = roles[record.owner]; record.owner_as_written = record.owner; }
      if (record.status) record.status = "todo";
    }
    const bytes = new Map<string,string>([
      ["plumb/engine.yaml",yamlText(engine)], ["plumb/model.yaml",yamlText(model)], ["plumb/plan.yaml",yamlText(plan)],
      ["shared/seams.yaml",yamlText({namespace:"shared",version:"1.0.0",systems:[],zones:[],parts:[],contracts:[],crossings:[],capabilities:[],seams:[]})],
      ["shared/manual-work.yaml",yamlText({manual_work:[{id:"ticket-triage",name:"Ticket triage",description:"Sort repair tickets by requested service."}]})],
    ]);
    const files = [...bytes].map(([path,bytes])=>({path,sha256:hash(bytes)})).sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
    const stamp = {line:ns,namespace:ns,version:"1.0.0",released:true,date:"2026-10-28",build:"fictional-1",schema:{design_engine:"0.4"},
      plumb:{interface:1,engine:"plumb/engine.yaml",model:"plumb/model.yaml",plan:"plumb/plan.yaml"},
      shared:{path:"shared/seams.yaml",sha256:hash(bytes.get("shared/seams.yaml")!)},
      manual_work:{path:"shared/manual-work.yaml",sha256:hash(bytes.get("shared/manual-work.yaml")!)},
      pins:ns === "premerge" ? [{namespace:"intake",version:"1.0.0",sha256:intakeHash}] : [], files,digest:filesDigest(files)};
    for (const [path,text] of bytes) { mkdirSync(join(dir,path,".."),{recursive:true}); writeFileSync(join(dir,path),text); }
    const text = yamlText(stamp); writeFileSync(join(dir,"edition.yaml"),text);
    if (ns === "intake") intakeHash = hash(text);
  }
}
if (import.meta.main) makeEditions();
