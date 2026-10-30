// Role strings mapped to declared teams; legacy split helpers also serve older adapters.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Model, Plan, Team } from "../types.ts";
import { unitRoles } from "../core/teams.ts";


export interface OwnerEntry { teams: string[]; verifier?: string; decider?: string[]; not?: string[]; roles?: Record<string, string> }
/** How unit role names map for the separation check: engine.yaml teams.role_map and teams.role_teams. */
export interface UnitRoleMap { roleMap: Record<string, "owner" | "verifier" | "decider">; roleTeams: Record<string, string> }
export interface TeamMap { teams: Team[]; owners: Record<string, OwnerEntry>; unitRoles?: UnitRoleMap }
export interface TeamRow { id: string; name: string; parts: number; alsoOn: number; units: number }
export interface TeamReport { strings: number; mapped: number; unresolved: string[]; rows: TeamRow[] }

/** Read the team map. Absent: an empty map (every string is split automatically and reported). */
export function loadTeamMap(path: string): TeamMap {
  if (!existsSync(path)) return { teams: [], owners: {} };
  const raw = Bun.YAML.parse(readFileSync(path, "utf8")) as any;
  const teams: Team[] = (Array.isArray(raw?.teams) ? raw.teams : []).map((t: any) => ({ id: String(t.id), name: String(t.name ?? t.id), ...(t.description ? { description: String(t.description) } : {}), ...(t.lead != null && String(t.lead).trim() ? { lead: String(t.lead).trim() } : {}) }));
  const ids = new Set(teams.map((t) => t.id));
  const owners: Record<string, OwnerEntry> = Object.create(null);
  for (const [k, v] of Object.entries((raw?.owners ?? {}) as Record<string, any>)) {
    const ts: string[] = (Array.isArray(v?.teams) ? v.teams : []).map(String);
    const decider = asList(v?.decider), not = asList(v?.not);
    const bad = [...ts, ...(v?.verifier ? [String(v.verifier)] : []), ...decider, ...not, ...Object.keys(v?.roles ?? {})].filter((t) => !ids.has(t));
    if (!ts.length || bad.length) throw new Error(`team-map.yaml: owner "${k}" ${!ts.length ? "names no team" : `names undeclared team ${bad.join(", ")}`}`);
    owners[k.trim()] = { teams: ts, ...(v.verifier ? { verifier: String(v.verifier) } : {}), ...(decider.length ? { decider } : {}), ...(not.length ? { not } : {}), ...(v.roles ? { roles: Object.fromEntries(Object.entries(v.roles).map(([a, b]) => [a, String(b)])) } : {}) };
  }
  const ur = raw?.unit_roles;
  if (ur == null) return { teams, owners };
  const unitRoles: UnitRoleMap = { roleMap: {}, roleTeams: {} };
  for (const [role, to] of Object.entries((ur ?? {}) as Record<string, unknown>)) {
    const t = String(to);
    if (t === "owner" || t === "verifier" || t === "decider") unitRoles.roleMap[role] = t;
    else if (ids.has(t)) unitRoles.roleTeams[role] = t;
    else throw new Error(`team-map.yaml: unit role "${role}" maps to "${t}", which is neither owner, verifier, decider nor a declared team`);
  }
  return { teams, owners, unitRoles };
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v : v != null && v !== "" ? [v] : []).map(String);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "") || "team";

/** Split an owner string the map does not know: "+" and ";" separate teams, a parenthetical is that team's role. */
export function splitOwner(s: string): { name: string; role?: string }[] {
  return s.split(/\s*(?:\+|;)\s*/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(.*?)\s*\(([^)]*)\)\s*(.*)$/);
    const name = (m ? `${m[1]} ${m[3]}` : p).trim().replace(/\s+/g, " ");
    return m ? { name, role: m[2].trim() } : { name };
  });
}

export function normaliseOwners(strings: string[], map: TeamMap) {
  const owners = new Map<string, OwnerEntry>();
  const extra: Team[] = [];
  const byName = new Map(map.teams.map((t) => [t.name.toLowerCase(), t.id]));
  const ids = new Set(map.teams.map((t) => t.id));
  const unresolved: string[] = [];
  let mapped = 0;
  for (const s of [...new Set(strings)]) {
    const known = map.owners[s];
    if (known) { owners.set(s, known); mapped++; continue; }
    unresolved.push(s);
    const teams: string[] = [], roles: Record<string, string> = {};
    for (const p of splitOwner(s)) {
      let id = byName.get(p.name.toLowerCase());
      if (!id) {
        id = slug(p.name);
        if (!ids.has(id)) { ids.add(id); byName.set(p.name.toLowerCase(), id); extra.push({ id, name: p.name[0].toUpperCase() + p.name.slice(1), description: "Split automatically from an owner string the team map does not list." }); }
      }
      if (!teams.includes(id)) teams.push(id);
      if (p.role) roles[id] = p.role;
    }
    owners.set(s, { teams, ...(Object.keys(roles).length ? { roles } : {}) });
  }
  const used = new Set<string>();
  for (const o of owners.values()) {
    for (const t of [...o.teams, ...(o.verifier ? [o.verifier] : []), ...(o.decider ?? []), ...(o.not ?? []), ...Object.keys(o.roles ?? {})]) used.add(t);
  }
  for (const t of Object.values(map.unitRoles?.roleTeams ?? {})) used.add(t);
  const teams = [...map.teams, ...extra].filter((t) => used.has(t.id));
  return {
    teams, owners,
    /** Each team: parts it owns, parts it co-owns, open units it owns (through the parts they change). */
    report(model: Model, plan: Plan): TeamReport {
      const roles = unitRoles(model, plan);
      const open = new Set(plan.units.filter((u) => u.status !== "done").map((u) => u.id));
      const rows = teams.map((t) => ({
        id: t.id, name: t.name,
        parts: model.elements.filter((e) => e.owner === t.id).length,
        alsoOn: model.elements.filter((e) => e.owner !== t.id && ((e.attrs?.owner_teams as string[] | undefined) ?? []).includes(t.id)).length,
        units: Object.entries(roles).filter(([u, r]) => open.has(u) && r.owners.includes(t.id)).length,
      })).sort((a, b) => b.units - a.units || b.parts - a.parts);
      return { strings: owners.size, mapped, unresolved, rows };
    },
  };
}
