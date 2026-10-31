import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileSha256 } from "../core/root.ts";
import { readTeamMap, teamMapRefs } from "../core/teams.ts";
import { hash, mapping, yamlText, type Raw, type VerifiedEdition } from "./manifest.ts";

/** Copy only verified source bytes. Frozen input files and edition.yaml are never regenerated. */
export function copyEdition(ed: Pick<VerifiedEdition,"bytes">, frozen: string): void {
  for (const [file,bytes] of ed.bytes) { const p = join(frozen,file); mkdirSync(dirname(p),{recursive:true}); writeFileSync(p,bytes); }
}

/** Write verified shared bytes and merge provenance while retaining the root's live configuration. */
export function writeSharedRoot(root: string, shared: Buffer, manual: Buffer | undefined, editions: {namespace: string; version: string; sha256: string}[], prior: Raw = {}): void {
  mkdirSync(root,{recursive:true});
  writeFileSync(join(root,"seams.yaml"),shared);
  if (manual) writeFileSync(join(root,"manual-work.yaml"),manual);
  const all = new Map<string,Raw>((prior.shared_from?.editions ?? []).map((e: Raw)=>[e.namespace,e]));
  for (const e of editions) all.set(e.namespace,e);
  writeFileSync(join(root,"engine.yaml"),yamlText({name:"shared",title:"Shared design root",...prior,kind:"root",schema:"0.4",
    shared_from:{...prior.shared_from,sha256:hash(shared),editions:[...all.values()].sort((a,b)=>a.namespace.localeCompare(b.namespace))},
  }));
}

/** The historical adapter layout, plus alternate paths when published inputs occupy those names. */
export function adapterPaths(paths: Iterable<string>): { engine: string; model: string; plan: string } {
  const canonical = (path: string) => path.normalize("NFC").toLowerCase();
  const used = new Set([...paths].map(canonical));
  const pick = (name: string) => { let p = name; while (used.has(canonical(p)) || [...used].some(f => f.startsWith(canonical(p) + "/") || canonical(p).startsWith(f + "/"))) p = "adapter-" + p; used.add(canonical(p)); return p; };
  return { engine: pick("engine.yaml"), model: pick("model.engine.yaml"), plan: pick("plan.engine.yaml") };
}

export function writeAdapters(frozen: string, sourceSha: string, values: { engine: Raw; model: Raw; plan: Raw }, paths = adapterPaths([])): void {
  for (const kind of ["engine","model","plan"] as const) writeFileSync(join(frozen,paths[kind]),yamlText(values[kind]));
  writeFileSync(join(frozen,"engine-import.yaml"),yamlText({ source_sha256: sourceSha, adapters: paths,
    files: Object.values(paths).map(path => ({ path, sha256: fileSha256(join(frozen,path)) })),
  }));
}

export function workspaceTeams(root: string) {
  const map = readTeamMap(join(root,"team-map.yaml"));
  const problems = map?.problems ?? [];
  if (problems.length) throw new Error(problems.join("; "));
  const orgFile = join(root,"org.yaml");
  const org = existsSync(orgFile) ? mapping(requireBytes(orgFile),"org.yaml") : undefined;
  const teams = org ? org.teams ?? [] : map?.teams ?? [];
  const ids = new Set(teams.map((t: Raw) => String(t.id)));
  for (const ref of map ? teamMapRefs(map) : []) if (!ids.has(ref.team.replace(/^org:/,""))) throw new Error(`team-map.yaml: ${ref.where} names undeclared team ${ref.team} in ${org ? "org.yaml" : "teams"}`);
  return { map, teams, withOrg: !!org };
}
import { readFileSync as requireBytes } from "node:fs";

export function derive(ed: VerifiedEdition, team: ReturnType<typeof workspaceTeams>) {
  const input = (kind: "engine" | "model" | "plan") => mapping(ed.bytes.get(ed.stamp.plumb[kind])!,ed.stamp.plumb[kind]);
  const engine = input("engine"), model = input("model"), plan = input("plan");
  const unresolved = new Set<string>(), resolved = new Set<string>();
  for (const record of [...(model.elements ?? []),...(plan.units ?? [])]) {
    if (typeof record.owner !== "string" || !record.owner) continue;
    const role = record.owner;
    const entry = team.map?.owners[role.trim()];
    record.attrs = { ...record.attrs, owner_as_written: role, design_role: role };
    record.owner_as_written = role;
    if (!entry?.teams.length) { unresolved.add(role); continue; }
    resolved.add(role); record.owner = entry.teams[0];
    if (entry.teams.length > 1) record.attrs.owner_teams = entry.teams;
    if (entry.verifier) record.verifier = entry.verifier;
    if (entry.decider?.length) record.attrs.decider = entry.decider;
    if (entry.not?.length) record.attrs.not = entry.not;
    if (entry.roles) record.attrs.owner_roles = entry.roles;
  }
  model.teams = team.withOrg ? [] : team.teams;
  const unitRoles = team.map?.unit_roles;
  if (unitRoles) engine.teams = { ...engine.teams,
    role_map: Object.fromEntries(Object.entries(unitRoles).filter(([,v]) => ["owner","verifier","decider"].includes(v))),
    role_teams: Object.fromEntries(Object.entries(unitRoles).filter(([,v]) => !["owner","verifier","decider"].includes(v))),
  };
  Object.assign(engine,{ name: ed.stamp.namespace, namespace: ed.stamp.namespace, schema: "0.4", root: "../shared", pins: ed.stamp.pins,
    importer: { tool: "plumb", version: "1", edition: ed.stamp.version, sha256: ed.sha256 },
  });
  return { engine,model,plan,unresolved,resolved };
}
