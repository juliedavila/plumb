import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { adapterPaths, copyEdition, derive, workspaceTeams, writeAdapters, writeSharedRoot } from "./adapters.ts";
import { designId, hash, mapping, regularFile, yamlText, type Raw, type VerifiedEdition } from "./manifest.ts";
import { invocation, shellArg, localPath } from "../core/invocation.ts";
import { EditionSource, type SourceOptions } from "./source.ts";

export interface AddOptions extends SourceOptions { workspace?: string; withPins?: boolean }
export interface AddedDesign { namespace: string; version: string; sha256: string; resolved: number; unresolved: number; draft?: string }

/** Preflight every destination component: an existing workspace cannot redirect a write through a symlink. */
function writablePath(path: string, workspace: string): void {
  let cursor = workspace;
  if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`${workspace}: refusing a symbolic-link workspace`);
  const parts = relative(cursor,resolve(path)).split("/");
  for (const [i,piece] of parts.entries()) {
    cursor = join(cursor,piece);
    if (!existsSync(cursor)) continue;
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`${path}: refusing a symbolic-link destination (${cursor})`);
    const stat = lstatSync(cursor);
    if (i < parts.length-1 && !stat.isDirectory() || i === parts.length-1 && !stat.isFile()) throw new Error(`${path}: destination has an incompatible file or directory at ${cursor}`);
  }
}
const read = (file: string): Raw => mapping(readFileSync(file),file);

/** All manifests, pins, shared bytes, maps and destinations are checked before the first workspace write. */
export async function addDesign(namespace: string, version: string, options: AddOptions): Promise<AddedDesign[]> {
  designId(namespace,version);
  const workspace = resolve(options.workspace ?? process.cwd()), instances = join(workspace,"instances"), root = join(instances,"shared");
  const source = new EditionSource(options);
  try {
    const planned = new Map<string,VerifiedEdition>(), visiting = new Set<string>();
    const order: VerifiedEdition[] = [];
    const command = (ns: string,v: string) => {
      const from = source.pinFrom(ns,v);
      return from ? `Run: ${invocation()} design add ${ns}@${v} --from ${shellArg(from.startsWith("github:") ? from : localPath(from))} --workspace ${shellArg(localPath(workspace))}` : `No nearby pin folder found. The --from folder must directly hold edition.yaml for ${ns}@${v} and its listed files.`;
    };
    const present = (ns: string) => {
      const file = join(instances,ns,"edition.yaml");
      return existsSync(file) ? { stamp: read(file), sha256: hash(readFileSync(file)) } : undefined;
    };
    const visit = async (ns: string,v: string,expected?: string,installedDir?: string): Promise<void> => {
      if (visiting.has(ns)) throw new Error(`edition.yaml: pin cycle ${[...visiting,ns].join(" -> ")}`);
      const prior = planned.get(ns);
      if (prior) {
        if (prior.stamp.version !== v || expected && prior.sha256 !== expected) throw new Error(`edition.yaml: conflicting pin for ${ns}@${v}`);
        return;
      }
      visiting.add(ns);
      let ed: VerifiedEdition;
      if (installedDir) {
        const { manifest, verifyBytes } = await import("./manifest.ts");
        const first = regularFile(installedDir,"edition.yaml");
        const stamp = manifest(first,ns,v);
        const bytes = new Map<string,Buffer>([["edition.yaml",first],...stamp.files.map(f => [f.path,regularFile(installedDir,f.path)] as [string,Buffer])]);
        ed = verifyBytes(stamp,bytes,installedDir);
      } else ed = await source.read(ns,v,expected !== undefined);
      if (expected && ed.sha256 !== expected) throw new Error(`${ns}@${v}/edition.yaml: pinned SHA-256 mismatch`);
      const frozen = join(instances,ns,"editions",v,"edition.yaml");
      if (existsSync(frozen) && hash(readFileSync(frozen)) !== ed.sha256) throw new Error(`${frozen}: refusing a different edition stamp for the same version`);
      const live = present(ns);
      if (live?.stamp.version === v && live.sha256 !== ed.sha256) throw new Error(`${ns}/edition.yaml: refusing a different edition stamp for the same version`);
      planned.set(ns,ed);
      for (const pin of ed.stamp.pins) {
        const installed = present(pin.namespace);
        if (installed && (installed.stamp.version !== pin.version || installed.sha256 !== pin.sha256))
          throw new Error(`${pin.namespace}/edition.yaml: installed version/hash conflicts with pin ${pin.namespace}@${pin.version}`);
        if (!installed && !planned.has(pin.namespace) && !options.withPins)
          throw new Error(`${ns}/edition.yaml: missing pin ${pin.namespace}@${pin.version}. ${command(pin.namespace,pin.version)}`);
        await visit(pin.namespace,pin.version,pin.sha256,installed ? join(instances,pin.namespace,"editions",pin.version) : undefined);
      }
      visiting.delete(ns);
      if (!installedDir) order.push(ed);
    };
    await visit(namespace,version);
    const first = order[0];
    const rootFile = join(root,"engine.yaml"), priorRoot = existsSync(rootFile) ? read(rootFile) : {};
    if (existsSync(rootFile) && priorRoot.kind !== "root") throw new Error(`${rootFile}: existing shared config is not kind: root`);
    const provenance = priorRoot.shared_from?.editions?.map((e: Raw) => `${e.namespace}@${e.version}`).join(", ") || "the existing workspace root";
    for (const ed of planned.values()) for (const [key,file] of [["shared","seams.yaml"],["manual_work","manual-work.yaml"]] as const) {
      const ref = ed.stamp[key], baseline = first.stamp[key];
      const bytes = ref ? ed.bytes.get(ref.path)! : undefined, base = baseline ? first.bytes.get(baseline.path)! : undefined;
      if (Boolean(bytes) !== Boolean(base) || bytes && !bytes.equals(base!)) throw new Error(`${ref?.path ?? file}: shared layer differs between ${ed.stamp.namespace} and ${first.stamp.namespace}`);
      const existing = join(root,file);
      if (existsSync(existing) && (!bytes || !readFileSync(existing).equals(bytes))) throw new Error(`${file}: shared layer differs from ${provenance}`);
      if (existsSync(rootFile) && bytes && !existsSync(existing)) throw new Error(`${file}: shared layer from ${provenance} is missing`);
    }
    const teams = workspaceTeams(root);
    const derived = order.map(ed => ({ ed, data: derive(ed,teams), paths: adapterPaths(ed.bytes.keys()) }));
    const unresolved = new Set<string>();
    const draft = join(root,"team-map.draft.yaml");
    if (existsSync(draft)) for (const role of Object.keys(read(draft).owners ?? {})) if (!teams.map?.owners[role]?.teams.length) unresolved.add(role);
    for (const {data} of derived) for (const role of data.unresolved) unresolved.add(role);
    const writes: string[] = [rootFile,join(root,"seams.yaml"),join(root,"manual-work.yaml"),...(unresolved.size || existsSync(draft) ? [draft] : [])];
    for (const {ed,paths} of derived) {
      const dir = join(instances,ed.stamp.namespace!), frozen = join(dir,"editions",ed.stamp.version);
      writes.push(...["engine.yaml","model.yaml","plan.yaml","edition.yaml","notes.yaml"].map(f=>join(dir,f)),...[...ed.bytes.keys()].map(f=>join(frozen,f)),...Object.values(paths).map(f=>join(frozen,f)),join(frozen,"engine-import.yaml"));
    }
    for (const path of writes) writablePath(path,workspace);
    // Commit verified bytes and derived files. All live state outside the three generated files is retained.
    writeSharedRoot(root,first.bytes.get(first.stamp.shared!.path)!,first.stamp.manual_work ? first.bytes.get(first.stamp.manual_work.path) : undefined,
      [...planned.values()].map(ed=>({namespace:ed.stamp.namespace!,version:ed.stamp.version,sha256:ed.sha256})),priorRoot);
    if (unresolved.size || existsSync(draft)) writeFileSync(draft,"# Declare teams below, or in org.yaml. Map each owner role to declared team ids.\n# Copy rows into team-map.yaml. Keep teams: [] for roles you cannot map yet.\n# Empty mappings remain unresolved and builds report their owner findings.\n" + yamlText({ teams: [], owners: Object.fromEntries([...unresolved].sort().map(role=>[role,{teams:[]}])) }));
    return derived.map(({ed,data,paths}) => {
      const dir = join(instances,ed.stamp.namespace!), frozen = join(dir,"editions",ed.stamp.version);
      mkdirSync(frozen,{recursive:true}); copyEdition(ed,frozen);
      for (const kind of ["engine","model","plan"] as const) writeFileSync(join(dir,`${kind}.yaml`),yamlText(data[kind]));
      writeAdapters(frozen,ed.sha256,data,paths);
      writeFileSync(join(dir,"edition.yaml"),ed.bytes.get("edition.yaml")!);
      if (!existsSync(join(dir,"notes.yaml"))) writeFileSync(join(dir,"notes.yaml"),"notes: []\n");
      return {namespace:ed.stamp.namespace!,version:ed.stamp.version,sha256:ed.sha256,resolved:data.resolved.size,unresolved:data.unresolved.size,...(unresolved.size ? {draft} : {})};
    });
  } finally { rmSync(source.stage,{recursive:true,force:true}); }
}

export async function designCli(args: string[]): Promise<number> {
  const usage = `usage: ${invocation()} design add <namespace>@<version> --from <folder | github:<owner>/<repo>> [--workspace <dir>] [--with-pins] [--ref <git ref>] [--path <path in repo>]`;
  if (args[0] !== "add" || !/^[^@]+@[^@]+$/.test(args[1] ?? "")) throw new Error(usage);
  const options: Raw = {};
  for (let i=2;i<args.length;i++) {
    const key = args[i];
    if (key === "--with-pins") { options.withPins = true; continue; }
    if (!["--from","--workspace","--ref","--path"].includes(key) || !args[i+1] || args[i+1].startsWith("--")) throw new Error(`${usage}\nunknown or incomplete option ${key}`);
    if (options[key.slice(2)] !== undefined) throw new Error(`duplicate option ${key}`);
    options[key.slice(2)] = args[++i];
  }
  if (!options.from) throw new Error(usage);
  const [ns,version] = args[1].split("@");
  const added = await addDesign(ns,version,options as AddOptions);
  for (const d of added) console.log(`Added ${d.namespace}@${d.version} (${d.sha256.slice(0,12)}); ${d.resolved} roles resolved, ${d.unresolved} unresolved${d.draft ? `; draft: ${d.draft}` : ""}.`);
  const workspace = resolve(options.workspace ?? process.cwd());
  const portfolios = join(workspace,"portfolios");
  const nested = existsSync(portfolios) ? readdirSync(portfolios).find(p=>existsSync(join(portfolios,p,"portfolio.yaml"))) : undefined;
  const portfolio = existsSync(join(workspace,"portfolio.yaml")) ? workspace : nested ? join(portfolios,nested) : undefined;
  if (portfolio) console.log(`Next: ${invocation()} portfolio build ${shellArg(localPath(portfolio))}`);
  else console.log(`Next: ${invocation()} build ${shellArg(localPath(join(workspace,"instances",ns)))}`);
  return 0;
}
