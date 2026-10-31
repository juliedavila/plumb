import { parseYaml } from "./yaml.ts";
// Teams and roles: who owns and who verifies each part and unit, which teams wait on which, and how the load spreads.
//
// The model's teams are the registry: an owner or verifier names a declared team (the generic, plan and teams packs
// report one that does not). Parts carry `owner` and `verifier`. A unit inherits both from the parts it changes (its
// fidelity moves); a unit changing parts with different owners lists all of them. A unit may declare its own owner
// (or verifier) only where it differs from its parts: that is recorded as an override. A unit that changes no owned
// part and declares nobody has no owner team: it is "unassigned", a finding counted per gate. Nothing here invents an
// owner: a part with no owner stays without one.
//
// Derived: team A waits on team B when an open unit of A's depends on a unit of B's (the capability graph); the load
// is each team's share of open units, counting owners only (co-owners and teams named in roles add nothing);
// separation of duties is checked as a team-level proxy: a part's verifier is none of its owner teams (owner and
// attrs.owner_teams) and none of the teams in its attrs.not, no owner team is in attrs.not either, and unit role pairs in
// attrs.separates are checked where both roles map to a team (role_map: owner, verifier or decider, where the decider is
// the parts' attrs.decider; role_teams: a role a named team holds). A part that names no verifier is "not assessed".

import { existsSync, readFileSync } from "node:fs";
import type { InstanceConfig, Model, Plan, PlanAnalysis, RoleSource, RootTeamMap, Team, TeamFacts, TeamMapEntry, Unit, UnitLead, UnitRoles } from "../types.ts";
import { natCompare } from "./util.ts";

export const DEFAULT_MAX_SHARE = 0.4;
export type RoleKind = "owner" | "verifier" | "decider";
export const DEFAULT_ROLE_MAP: Record<string, RoleKind> = { proposer: "owner", owner: "owner", verifier: "verifier" };
const ROLE_KINDS = new Set<string>(["owner", "verifier", "decider"]);

/** A part attr that names one team or a list of teams, as a list. */
export function teamList(v: unknown): string[] {
  return (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []).map(String);
}
export const DEFAULT_PAIRS_ATTR = "separates";

/** The teams settings in engine.yaml: `teams: { max_share: 0.4, role_map: { proposer: owner, decision-owner: decider }, role_teams: { evaluator: <team> }, pairs_attr: separates }`. */
export function teamSettings(config: InstanceConfig): { maxShare: number; roleMap: Record<string, RoleKind>; roleTeams: Record<string, string>; pairsAttr: string } {
  const t = (config.teams && typeof config.teams === "object" ? config.teams : {}) as Record<string, unknown>;
  const ms = Number(t.max_share);
  const rm: Record<string, RoleKind> = { ...DEFAULT_ROLE_MAP };
  if (t.role_map && typeof t.role_map === "object") for (const [k, v] of Object.entries(t.role_map as Record<string, unknown>)) if (typeof v === "string" && ROLE_KINDS.has(v)) rm[k] = v as RoleKind;
  const rt: Record<string, string> = {};
  if (t.role_teams && typeof t.role_teams === "object") for (const [k, v] of Object.entries(t.role_teams as Record<string, unknown>)) if (typeof v === "string" && v) rt[k] = v;
  return { maxShare: ms > 0 && ms <= 1 ? ms : DEFAULT_MAX_SHARE, roleMap: rm, roleTeams: rt, pairsAttr: typeof t.pairs_attr === "string" ? t.pairs_attr : DEFAULT_PAIRS_ATTR };
}

function firstUnits(plan: Plan): Unit[] {
  const seen = new Set<string>();
  return plan.units.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)));
}

/** One role of one unit: from its parts, or its own declaration where that differs. */
function resolve(declared: string | undefined, fromParts: string[]): { teams: string[]; source: RoleSource } {
  if (declared) {
    if (!fromParts.length) return { teams: [declared], source: "declared" };
    if (fromParts.length === 1 && fromParts[0] === declared) return { teams: fromParts, source: "parts" };
    return { teams: [declared], source: "override" };
  }
  return fromParts.length ? { teams: fromParts, source: "parts" } : { teams: [], source: "none" };
}

/** Every unit's owner and verifier teams. */
export function unitRoles(model: Model, plan: Plan): Record<string, UnitRoles> {
  const el = new Map(model.elements.map((e) => [e.id, e]));
  const order = new Map(model.teams.map((t, i) => [t.id, i]));
  const sortTeams = (xs: string[]) => [...new Set(xs)].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || natCompare(a, b));
  const out: Record<string, UnitRoles> = {};
  for (const u of firstUnits(plan)) {
    const parts = (u.elements ?? []).map((m) => el.get(m.id)).filter((e) => !!e);
    const o = resolve(u.owner, sortTeams(parts.map((e) => e!.owner).filter((x): x is string => !!x)));
    const v = resolve(u.verifier, sortTeams(parts.map((e) => e!.verifier).filter((x): x is string => !!x)));
    out[u.id] = { owners: o.teams, ownerSource: o.source, verifiers: v.teams, verifierSource: v.source };
  }
  return out;
}

export function teamFacts(model: Model, plan: Plan, config: InstanceConfig, analysis: Pick<PlanAnalysis, "deps">): TeamFacts {
  const set = teamSettings(config);
  const roles = unitRoles(model, plan);
  const units = firstUnits(plan);
  const byId = new Map(units.map((u) => [u.id, u]));
  const phases = [...plan.phases].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || natCompare(a.id, b.id));
  const isOpen = (u: Unit) => u.status !== "done";

  const unassigned = phases.map((p) => {
    const us = units.filter((u) => u.phase === p.id && !roles[u.id].owners.length);
    return { phase: p.id, units: us.map((u) => u.id), open: us.filter(isOpen).length };
  });

  // waits on: an open unit of team A depends on a unit of team B (A ≠ B)
  const edges = new Map<string, { from: string; to: string; count: number; pairs: [string, string][] }>();
  for (const u of units) {
    if (!isOpen(u)) continue;
    for (const d of analysis.deps[u.id] ?? []) {
      if (!byId.has(d) || d === u.id) continue;
      for (const a of roles[u.id].owners) for (const b of roles[d]?.owners ?? []) {
        if (a === b) continue;
        const k = `${a}\u0000${b}`;
        if (!edges.has(k)) edges.set(k, { from: a, to: b, count: 0, pairs: [] });
        const e = edges.get(k)!;
        e.count++; e.pairs.push([u.id, d]);
      }
    }
  }
  const waitsOn = [...edges.values()].sort((x, y) => y.count - x.count || natCompare(x.from, y.from) || natCompare(x.to, y.to));

  const openUnits = units.filter(isOpen);
  const openBy = new Map<string, number>();
  for (const u of openUnits) for (const t of roles[u.id].owners) openBy.set(t, (openBy.get(t) ?? 0) + 1);
  const load = [...openBy].map(([team, open]) => ({ team, open, share: openUnits.length ? Math.round((open / openUnits.length) * 1000) / 1000 : 0 }))
    .sort((x, y) => y.open - x.open || natCompare(x.team, y.team));

  const gateCounts = new Map<string, Record<string, { owner: number; verifier: number }>>();
  const bump = (team: string, phase: string, role: "owner" | "verifier") => {
    if (!gateCounts.has(team)) gateCounts.set(team, {});
    const g = gateCounts.get(team)!;
    g[phase] ??= { owner: 0, verifier: 0 };
    g[phase][role]++;
  };
  for (const u of units) { for (const t of roles[u.id].owners) bump(t, u.phase, "owner"); for (const t of roles[u.id].verifiers) bump(t, u.phase, "verifier"); }
  const order = new Map(model.teams.map((t, i) => [t.id, i]));
  const byGate = [...gateCounts].map(([team, gates]) => ({ team, gates }))
    .sort((x, y) => (order.get(x.team) ?? 1e9) - (order.get(y.team) ?? 1e9) || natCompare(x.team, y.team));

  // separation of duties, team level: a verifier is none of the part's owner teams and none of its exclusions, and no
  // owner team is excluded either; a part with no verifier is not assessed
  const sepParts: TeamFacts["separation"]["parts"] = [];
  let checkedParts = 0;
  const ownParts = model.elements.filter((e) => !e.home); // a 0.4 design's outside parts are another home's to own
  for (const e of ownParts) {
    const owners = [...new Set([...(e.owner ? [e.owner] : []), ...teamList(e.attrs?.owner_teams)])];
    const not = teamList(e.attrs?.not);
    const judged = !!(e.owner && e.verifier);
    if (judged) checkedParts++;
    const v = e.verifier;
    const fail = judged && v === e.owner ? { team: v!, reason: "owner" as const }
      : judged && owners.includes(v!) ? { team: v!, reason: "co-owner" as const }
      : v && not.includes(v) ? { team: v, reason: "excluded" as const }
      : owners.find((o) => not.includes(o)) ? { team: owners.find((o) => not.includes(o))!, reason: "excluded-owner" as const } : undefined;
    if (fail) sepParts.push({ part: e.id, ...fail });
  }
  const failedParts = sepParts.filter((p) => p.reason !== "excluded-owner" || model.elements.some((x) => x.id === p.part && x.owner && x.verifier)).length;
  const passedParts = checkedParts - failedParts;
  const notAssessedParts = ownParts.length - checkedParts;
  const el = new Map(model.elements.map((e) => [e.id, e]));
  const deciders = (u: Unit) => [...new Set((u.elements ?? []).flatMap((m) => teamList(el.get(m.id)?.attrs?.decider)))];
  const teamsFor = (u: Unit, role: string): string[] | undefined => {
    const k = set.roleMap[role];
    if (k === "owner") return roles[u.id].owners;
    if (k === "verifier") return roles[u.id].verifiers;
    if (k === "decider") return deciders(u);
    return set.roleTeams[role] ? [set.roleTeams[role]] : undefined;
  };
  const pairs: TeamFacts["separation"]["pairs"] = [];
  let checkedPairs = 0, unmappedPairs = 0, unassignedPairs = 0;
  for (const u of units) {
    const raw = u.attrs?.[set.pairsAttr];
    if (!Array.isArray(raw)) continue;
    for (const pr of raw) {
      if (!Array.isArray(pr) || pr.length !== 2) continue;
      const [r1, r2] = pr.map(String) as [string, string];
      const t1 = teamsFor(u, r1), t2 = teamsFor(u, r2);
      if (!t1 || !t2) { unmappedPairs++; continue; }
      if (!t1.length || !t2.length) { unassignedPairs++; continue; }
      checkedPairs++;
      const same = t1.find((t) => t2.includes(t));
      if (same) pairs.push({ unit: u.id, roles: [r1, r2], team: same });
    }
  }

  return {
    units: roles,
    unownedParts: ownParts.filter((e) => !e.owner).map((e) => e.id),
    unassigned, waitsOn, load, maxShare: set.maxShare, byGate,
    separation: { parts: sepParts, pairs, checkedParts, passedParts, failedParts, notAssessedParts, checkedPairs, unmappedPairs, unassignedPairs },
  };
}

/**
 * Each unit's lead: its own `lead` where it sets one ("set"), else its owner team's lead ("team"), else none. A unit
 * with several owner teams inherits from the first (the order unitRoles gives, which the page lists first) and `of`
 * says how many there are, so the page can say so. A missing lead is never a finding: who leads is filled in where the
 * people are known, and an owner field counted as a target would be filled for the count.
 */
export function unitLeads(model: Model, plan: Plan, roles: Record<string, UnitRoles> = unitRoles(model, plan)): Record<string, UnitLead> {
  const team = new Map(model.teams.map((t) => [t.id, t]));
  const out: Record<string, UnitLead> = {};
  for (const u of firstUnits(plan)) {
    if (u.lead) { out[u.id] = { lead: u.lead, source: "set" }; continue; }
    const owners = roles[u.id]?.owners ?? (u.owner ? [u.owner] : []);
    const first = owners[0], lead = first ? team.get(first)?.lead : undefined;
    out[u.id] = lead ? { lead, source: "team", team: first, ...(owners.length > 1 ? { of: owners.length } : {}) } : { source: "none" };
  }
  return out;
}

// ---------- the team map in the shared root ----------
// One map in the root turns the owner strings and roles that every design and the shared layer write into teams, in
// the shared owner-to-team mapping: `owners: { "<string or role>": { teams, verifier?, decider?, not?, roles? } }`, an
// optional `unit_roles`, and an optional `teams:` list for a root with no org layer (each design then keeps its own
// teams, written by its importer from this map). With an org layer the teams live in org.yaml and the map only says
// which team holds each role. Reading never throws: what it cannot read is a problem in words.

const asTeamList = (v: unknown): string[] => (Array.isArray(v) ? v : v != null && v !== "" ? [v] : []).map((x) => String(x).trim()).filter(Boolean);

/** Read <root>/team-map.yaml, or undefined when there is none. */
export function readTeamMap(path: string): RootTeamMap | undefined {
  if (!existsSync(path)) return undefined;
  const bytes = readFileSync(path, "utf8");
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const out: RootTeamMap = { file: "team-map.yaml", sha256, owners: Object.create(null), teams: [], problems: [] };
  let raw: unknown;
  try { raw = parseYaml(bytes,path); } catch (e) { out.problems.push(`team-map.yaml: YAML parse error: ${(e as Error).message}`); return out; }
  if (raw === null || raw === undefined) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) { out.problems.push("team-map.yaml: must be a mapping with owners (and optionally unit_roles and teams)"); return out; }
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.teams)) for (const t of r.teams) {
    if (!t || typeof t !== "object" || Array.isArray(t) || (t as Record<string, unknown>).id == null) { out.problems.push("team-map.yaml: a team needs at least an id"); continue; }
    const x = t as Record<string, unknown>;
    const lead = x.lead != null && String(x.lead).trim() ? String(x.lead).trim() : undefined;
    out.teams.push({ id: String(x.id), name: String(x.name ?? x.id), ...(x.description != null ? { description: String(x.description) } : {}), ...(lead ? { lead } : {}) } as Team);
  }
  if (r.owners != null && (typeof r.owners !== "object" || Array.isArray(r.owners))) out.problems.push("team-map.yaml: owners must be a mapping from owner strings or roles to { teams }");
  else for (const [k, v] of Object.entries((r.owners ?? {}) as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) { out.problems.push(`team-map.yaml: owner "${k}" must be a mapping like { teams: [<team>] }`); continue; }
    const e = v as Record<string, unknown>;
    const teams = asTeamList(e.teams);
    if (!teams.length && !(Array.isArray(e.teams) && e.teams.length === 0)) { out.problems.push(`team-map.yaml: owner "${k}" names no team`); continue; }
    const entry: TeamMapEntry = { teams };
    if (e.verifier != null && String(e.verifier).trim()) entry.verifier = String(e.verifier).trim();
    const decider = asTeamList(e.decider), not = asTeamList(e.not);
    if (decider.length) entry.decider = decider;
    if (not.length) entry.not = not;
    if (e.roles && typeof e.roles === "object" && !Array.isArray(e.roles)) entry.roles = Object.fromEntries(Object.entries(e.roles as Record<string, unknown>).map(([a, b]) => [a, String(b)]));
    out.owners[k.trim()] = entry;
  }
  if (r.unit_roles && typeof r.unit_roles === "object" && !Array.isArray(r.unit_roles))
    out.unit_roles = Object.fromEntries(Object.entries(r.unit_roles as Record<string, unknown>).map(([a, b]) => [a, String(b)]));
  return out;
}

/** The teams an owner string or role maps to (the first owns), or none when the map does not list it. */
export function ownerTeams(map: RootTeamMap | undefined, role: string | undefined): string[] {
  return role ? map?.owners[role.trim()]?.teams ?? [] : [];
}

/** Every team id a map names (owners, verifiers, deciders, exclusions, roles, unit roles that are teams), with where. */
export function teamMapRefs(map: RootTeamMap): { team: string; where: string }[] {
  const out: { team: string; where: string }[] = [];
  for (const [k, e] of Object.entries(map.owners)) {
    for (const t of e.teams) out.push({ team: t, where: `owner "${k}"` });
    if (e.verifier) out.push({ team: e.verifier, where: `owner "${k}" verifier` });
    for (const t of e.decider ?? []) out.push({ team: t, where: `owner "${k}" decider` });
    for (const t of e.not ?? []) out.push({ team: t, where: `owner "${k}" not` });
    for (const t of Object.keys(e.roles ?? {})) out.push({ team: t, where: `owner "${k}" roles` });
  }
  for (const [role, t] of Object.entries(map.unit_roles ?? {})) if (!["owner", "verifier", "decider"].includes(t)) out.push({ team: t, where: `unit role "${role}"` });
  return out;
}
