// Rules runner: build the shared indexes once, load packs by name, run every rule, sort findings.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Finding, InstanceConfig, Model, Note, Plan, Relationship, Rule, RuleContext, RulePack, TrackerInput } from "../types.ts";
import { byId, natCompare } from "./util.ts";

export const ENGINE_ROOT = resolve(import.meta.dir, "../..");
export const PACKS_DIR = join(ENGINE_ROOT, "packs");

export function buildContext(config: InstanceConfig, model: Model, plan: Plan, tracker?: TrackerInput, extra: { notes?: Note[]; patchIds?: string[]; patches?: { id: string; why: string }[]; ns?: RuleContext["ns"] } = {}): RuleContext {
  const index = <T, K extends keyof T>(xs: T[], k: K) => {
    const m = new Map<string, T>();
    for (const x of xs) if (!m.has(String(x[k]))) m.set(String(x[k]), x); // first wins; generic flags duplicates
    return m;
  };
  const out = new Map<string, Relationship[]>(), inn = new Map<string, Relationship[]>();
  for (const r of [...model.relationships].sort(byId)) {
    if (!out.has(r.from)) out.set(r.from, []);
    if (!inn.has(r.to)) inn.set(r.to, []);
    out.get(r.from)!.push(r);
    inn.get(r.to)!.push(r);
  }
  return {
    config, model, plan,
    el: index(model.elements, "id"), rel: index(model.relationships, "id"), con: index(model.contracts, "name"),
    team: index(model.teams, "id"), unit: index(plan.units, "id"), phase: index(plan.phases, "id"),
    out, inn,
    ...(tracker ? { tracker } : {}),
    ...(extra.notes ? { notes: extra.notes } : {}),
    ...(extra.patchIds ? { patchIds: extra.patchIds } : {}),
    ...(extra.patches ? { patches: extra.patches } : {}),
    ...(extra.ns ? { ns: extra.ns } : {}),
  };
}

export function compareFindings(a: Finding, b: Finding): number {
  return natCompare(a.pack, b.pack) || natCompare(a.rule, b.rule) || natCompare(a.at, b.at) || natCompare(a.message, b.message);
}

export function findingKey(f: Finding): string {
  return `${f.pack}\u0000${f.rule}\u0000${f.at}\u0000${f.message}`;
}

export interface LoadedPacks { packs: RulePack[]; errors: { name: string; message: string }[] }

const cache = new Map<string, RulePack>();

/** Load packs/<name>/index.ts by name (dynamic import). A pack that fails to load is reported, not thrown. */
export async function loadPacks(names: string[], dir = PACKS_DIR): Promise<LoadedPacks> {
  const packs: RulePack[] = [], errors: LoadedPacks["errors"] = [];
  for (const name of names) {
    const path = join(dir, name, "index.ts");
    try {
      let p = cache.get(path);
      if (!p) {
        if (!existsSync(path)) throw new Error(`no pack at ${path}`);
        const mod = await import(path);
        p = mod.pack as RulePack;
        if (!p || !Array.isArray(p.rules)) throw new Error(`${path} does not export \`pack: RulePack\``);
        cache.set(path, p);
      }
      packs.push(p);
    } catch (e) {
      errors.push({ name, message: (e as Error).message });
    }
  }
  return { packs, errors };
}

/** Run every rule of every pack. A rule that throws becomes an error finding on the instance. */
export function runRules(packs: RulePack[], ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  for (const p of packs) {
    for (const rule of p.rules) {
      try {
        for (const f of rule.check(ctx)) out.push({ pack: p.name, rule: rule.id, severity: rule.severity, ...f });
      } catch (e) {
        out.push({ pack: p.name, rule: rule.id, severity: "error", at: ctx.config.name, atKind: "instance", message: `rule crashed: ${(e as Error).message}` });
      }
    }
  }
  return dedupeFindings(out).sort(compareFindings);
}

export function dedupeFindings(fs: Finding[]): Finding[] {
  const seen = new Set<string>();
  return fs.filter((f) => (seen.has(findingKey(f)) ? false : (seen.add(findingKey(f)), true)));
}

// Core's own pseudo-pack: problems found while loading packs or applying accepted patches.
export const CORE_PACK: RulePack = {
  name: "core",
  title: "Engine",
  description: "Problems the engine itself hit while building: a pack that would not load, a patch file it could not read, or an accepted patch op that could not apply.",
  rules: [
    {
      id: "pack-loads", title: "Every listed pack loads", severity: "error",
      why: "The instance lists the rule packs that check it; if one cannot load, its checks silently stop running, so the build says so loudly instead.",
      check: () => [],
    },
    {
      id: "patch-loads", title: "Every patch file reads as a patch", severity: "error",
      why: "A patch file that does not parse, is not a mapping, has an unknown status or an ops field that is not a list would otherwise be skipped or misread without a word; the build names the file instead.",
      check: () => [],
    },
    {
      id: "patch-ids-unique", title: "Every patch has its own id", severity: "error",
      why: "Patches are applied in id order and referred to by id; two files with one id make the order and every reference to them ambiguous.",
      check: () => [],
    },
    {
      id: "patch-applies", title: "Every accepted patch applies cleanly", severity: "error",
      why: "An accepted patch is part of the design of record; an op that names an unknown id or adds a duplicate means the compiled model is not what the patch author intended.",
      check: () => [],
    },
    {
      id: "yaml-keys-unique", title: "No key is written twice in one mapping", severity: "error",
      why: "The YAML reader keeps the second of two equal keys and drops the first without a word, so a unit with two owner lines, or a part with two zones, silently loses one. The build names the file and the line instead.",
      check: () => [],
    },
    {
      id: "override-valid", title: "Every status override says what, why and who", severity: "error",
      why: "A milestone's status override replaces what the plan computes, in front of the people deciding. One with no valid status, no reason or no one named would change the status in silence, so it is refused and named instead.",
      check: () => [],
    },
    {
      id: "unit-keeps-a-part", title: "Every unit keeps a part to move", severity: "error",
      why: "A patch that removes every part a unit moves leaves the unit with nothing to change, while the plan still counts it and other work may wait on it. That is a broken plan, not a missing owner.",
      check: () => [],
    },
  ],
};

// The engine's own 0.4 rules. They fire only on a 0.4 feature, so the
// core pack a lone instance lists keeps its rules: an instance read as 0.4 lists these too; any other lists only the
// ones that fired on it (schema-known, for a 0.4 key in an instance that does not declare 0.4).
export const CORE_RULES_04: Rule[] = [
  {
    id: "schema-known", title: "The instance is written to a schema this engine reads", severity: "error",
    why: "The engine reads schemas 0.3 and 0.4. A newer schema stops the build, because reading it as an older one would silently drop what it says. A 0.4 key in an instance that does not declare 0.4 is a warning: declaring the schema says how every file is meant to be read.",
    how: "engine.yaml schema; the 0.4 keys are namespace, root and pins in engine.yaml, a current.yaml file, and flow_item or relieves on a unit. bun plumb.ts migrate writes the schema.",
    check: () => [],
  },
  {
    id: "deprecated-key", title: "No file uses a key a newer one replaced", severity: "warning",
    why: "A renamed key is read through its new name for one minor version and then no longer read, so a file that still uses the old name would lose that setting in silence at the next version. The warning names the file and the line while there is time to rename it.",
    how: "The renamed keys are listed in src/migrate/keys.ts with the version that removes each; bun plumb.ts migrate renames them in place.",
    check: () => [],
  },
  {
    id: "xref-resolves", title: "Every reference across designs resolves", severity: "error",
    why: "A design names its own records and its shared root's, and never another design's, so designs stay apart and none can quietly depend on another's internals. Views, the claims a record rests on and notes may point across, since they describe and create no dependency. A reference into the shared or org layer must name a record the root holds, and the root's references into a design must name records that design holds.",
    how: "A bare id resolves to the design's own record, then the shared layer's, then for a team the org layer's; <namespace>:<id> names one directly. A bare id that resolves nowhere is reported by the rule that checks its field, and by this one in engine.yaml settings.",
    check: () => [],
  },
  {
    id: "xref-pin-stale", title: "A pinned edition is the one composed, unchanged", severity: "warning",
    why: "A design that ships with another is checked against one exact edition of it. When the build composes a different edition, or a file under the pinned version changed, or the shared file moved on since this design was released, the records the two designs meet at may have changed, and the finding lists which.",
    how: "A pin is a namespace, a version and the sha256 of that edition's edition.yaml (or a prefix of 12 or more). A record whose only change is its wording or owner is not counted as changed.",
    check: () => [],
  },
  {
    id: "xref-no-cycle", title: "Designs import one root and pin exact editions, with no loop", severity: "error",
    why: "Each design imports one shared root and nothing else, and pins exact editions of the designs it ships with. A loop of exact pins has no solution, a root that imports something is no longer the root, and two designs with one namespace make every reference between them ambiguous.",
    how: "engine.yaml namespace, root and pins; the root's engine.yaml says kind: root and has neither root nor pins.",
    check: () => [],
  },
  {
    id: "one-home", title: "Every record has one home", severity: "error",
    why: "A record defined both in a design and in the shared layer, or teams declared in a design whose root holds the organization's teams, gives one name two meanings, and which one a reference reaches depends on resolution order rather than intent.",
    how: "Compared by kind: parts, relationships, contracts, systems, zones, claims and seams against the shared layer; capabilities against the shared layer's providers; a design's teams against the root's org.yaml.",
    check: () => [],
  },
  {
    id: "current-valid", title: "Every current-state record is whole and inside the design", severity: "error",
    why: "A current-state record says where one of the design's parts stands today and what happens to it. A record with an unknown level or disposition, a replacement that names nothing, or a part outside the systems the design places parts in would mislead every check that reads it. Only a person confirms a record: a confirmation an agent wrote does not count, and the record stays discovered.",
    how: "current.yaml, one record per part: baseline (a ladder level; the first by default), disposition (new, retain, transition, replace or retire; missing is undecided, a warning while discovered and an error once confirmed), replaced_by for replace, add for a part that exists only today (it names a system the design's own parts are placed in, its own or a shared one), found (by, from, as_of, confidence) and confirmed (by a person, at a date). A by of agent:<name> names an agent.",
    check: () => [],
  },
];

/**
 * The packs as a design runs and lists them. A 0.4 design gets each pack's `rules04`: a rule with a base rule's id
 * replaces it, the rest are added. A lone instance gets the packs as they are, so its rule set, and the hash of it
 * every snapshot keeps, stays as it was. Never mutates the loaded (cached) packs.
 */
export function packsFor(packs: RulePack[], is04: boolean): RulePack[] {
  if (!is04) return packs;
  return packs.map((p) => {
    if (!p.rules04?.length) return p;
    const extra = new Map(p.rules04.map((r) => [r.id, r]));
    const rules = p.rules.map((r) => extra.get(r.id) ?? r);
    for (const r of p.rules04) if (!p.rules.some((x) => x.id === r.id)) rules.push(r);
    return { ...p, rules };
  });
}

/** The core pack as a bundle lists it: the base rules, with the 0.4 rules for a 0.4 instance (or those that fired). */
export function corePack(is04: boolean, findings: Finding[] = []): RulePack {
  const fired = new Set(findings.filter((f) => f.pack === "core").map((f) => f.rule));
  const extra = CORE_RULES_04.filter((r) => is04 || fired.has(r.id));
  return extra.length ? { ...CORE_PACK, rules: [...CORE_PACK.rules, ...extra] } : CORE_PACK;
}
