import { expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Keep this one explicit exception list; source uses escapes so the guard checks itself too.
const exceptions = ["README.md","SPEC.md","packs/security/index.ts"];
const vocabulary = /ra\u0074chet|\bj\u0069g\b/i;
const attribution = "ported from the Ra\u0074chet design's model checks";
function files(dir: string, prefix=""): string[] {
  return readdirSync(dir).flatMap(name=>{
    // Git's own store and local build output are not the shipped tree.
    if(name===".git"||(!prefix&&name==="build"))return [];
    const p=join(dir,name),rel=prefix?`${prefix}/${name}`:name;
    const st=lstatSync(p);
    if(st.isSymbolicLink())throw new Error(`${rel}: standalone tree contains a symbolic link`);
    return st.isDirectory()?files(p,rel):[rel];
  });
}
test("the standalone tree has no private-design data, vocabulary or tool imports",()=>{
  const root=join(import.meta.dir,".."),hits:string[]=[];
  for(const file of files(root)){
    if(file==="CHANGELOG.md")continue;
    let text=readFileSync(join(root,file),"utf8");
    if(exceptions.includes(file)){
      if(file==="packs/security/index.ts"){
        expect(text.split(attribution).length-1).toBeLessThanOrEqual(1);
        text=text.replace(attribution,"");
      }else text=text.replace(/^.*example designs.*$/gmi,"");
    }
    if(vocabulary.test(file)||vocabulary.test(text))hits.push(file);
    if(/\b(?:from\s*|import\s*\(|require\s*\()["'][^"']*\/tools\//.test(text))hits.push(`${file}: imports tools`);
  }
  expect(hits).toEqual([]);
});
test("the standalone tree contains no terms from the local provenance list",()=>{
  const path=process.env.PLUMB_PROVENANCE_LIST ?? join(homedir(),".config/plumb/provenance.txt");
  if(!existsSync(path)){
    console.log("provenance list not found; check skipped");
    return;
  }
  const patterns=readFileSync(path,"utf8").split(/\r?\n/).map(line=>line.trim())
    .filter(line=>line && !line.startsWith("#")).map(line=>new RegExp(line));
  const root=join(import.meta.dir,".."),hits:string[]=[];
  for(const file of files(root)){
    if(file==="CHANGELOG.md")continue;
    const text=readFileSync(join(root,file),"utf8");
    if(patterns.some(pattern=>pattern.test(text)))hits.push(`${file}: private provenance`);
  }
  expect(hits).toEqual([]);
});
