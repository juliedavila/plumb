// teams: who owns and who verifies the work, read from the model's team registry (src/core/teams.ts).
// Added to every instance whose model declares teams. Owner values that name no declared team are reported by the
// generic pack (parts) and the plan pack (units); this pack adds the verifier role, the unassigned work, the team
// load, and separation of duties as a team-level proxy.

import type { Finding, Rule, RuleContext, RulePack } from "../../src/types.ts";
import { analyzePlan } from "../../src/core/plan.ts";
import { teamFacts, teamList, teamSettings, unitRoles } from "../../src/core/teams.ts";
import { isNamespaced } from "../../src/core/namespace.ts";

type F = Omit<Finding, "pack" | "rule" | "severity">;
const pct = (x: number) => `${Math.round(x * 100)}%`;

const verifierExists: Rule = {
  id: "verifier-team-exists",
  title: "A verifier names a declared team",
  severity: "error",
  why: "The verifier is who checks the work; a value that is not a team in the registry means nobody real checks it, and a typed name cannot stand in for a team.",
  check(ctx: RuleContext): F[] {
    const out: F[] = [];
    const known = (t: string) => ctx.team.has(t) || (!!ctx.ns && isNamespaced(t)); // a namespaced team is core/xref-resolves's to judge
    for (const e of ctx.model.elements) {
      if (e.verifier && !known(e.verifier)) out.push({ at: e.id, atKind: "element", message: `element ${e.id} names verifier team "${e.verifier}", which is not a declared team` });
      for (const [k, what] of [["decider", "decider"], ["not", "excluded"], ["owner_teams", "co-owner"]] as const)
        for (const t of teamList(e.attrs?.[k])) if (!known(t)) out.push({ at: e.id, atKind: "element", message: `element ${e.id} names ${what} team "${t}", which is not a declared team` });
    }
    for (const u of ctx.plan.units) if (u.verifier && !known(u.verifier)) out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} names verifier team "${u.verifier}", which is not a declared team` });
    return out;
  },
};

const unitHasOwner: Rule = {
  id: "unit-has-owner",
  title: "Every open unit has an owner team",
  severity: "warning",
  why: "A unit inherits its owner from the parts it changes. When those parts have no owner team and the unit names none, nobody answers for the work: it is unassigned, and the plan cannot say who it waits on.",
  check(ctx: RuleContext): F[] {
    const roles = unitRoles(ctx.model, ctx.plan);
    const out: F[] = [];
    const seen = new Set<string>();
    for (const u of ctx.plan.units) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      if (u.status === "done" || roles[u.id]?.owners.length) continue;
      const parts = (u.elements ?? []).filter((m) => ctx.el.has(m.id)).length;
      out.push({ at: u.id, atKind: "unit", message: parts
        ? `unit ${u.id} has no owner team: the ${parts === 1 ? "part it changes has" : `${parts} parts it changes have`} none, and it names none`
        : `unit ${u.id} has no owner team: it changes no part and names none` });
    }
    return out;
  },
};

const teamLoad: Rule = {
  id: "team-load",
  title: "No team owns too large a share of the open work",
  severity: "warning",
  why: "When one team owns most of what is left, the plan's pace is that team's pace, and every other team ends up waiting on it.",
  how: "The share is engine.yaml teams.max_share (default 0.4) of the open units.",
  check(ctx: RuleContext): F[] {
    const f = teamFacts(ctx.model, ctx.plan, ctx.config, analyzePlan(ctx.plan));
    const open = ctx.plan.units.filter((u) => u.status !== "done").length;
    if (open < 5) return []; // too little open work for a share to mean anything
    return f.load.filter((l) => l.share > f.maxShare)
      .map((l) => ({ at: l.team, atKind: "team" as const, message: `team ${l.team} owns ${l.open} of the ${open} open units (${pct(l.share)}), more than the ${pct(f.maxShare)} this instance allows` }));
  },
};

const PART_MESSAGE: Record<"owner" | "co-owner" | "excluded" | "excluded-owner", (part: string, team: string) => string> = {
  owner: (p, t) => `part ${p} is owned and verified by the same team, ${t}`,
  "co-owner": (p, t) => `part ${p} is co-owned and verified by the same team, ${t}`,
  excluded: (p, t) => `part ${p} is verified by ${t}, a team it must stay independent of`,
  "excluded-owner": (p, t) => `part ${p} is owned by ${t}, a team it must stay independent of`,
};

const separation: Rule = {
  id: "separation-of-duties",
  title: "The verifier is independent of the owners (a team-level proxy)",
  severity: "warning",
  why: "Independence between the people who build and the people who check is what makes a check worth having. The model holds teams, not people, so this is a proxy: different teams is necessary for that independence, not sufficient. It reads each part's owners, verifier and the teams it must stay independent of, and the roles each unit must keep apart where both map to a team. A part that names no verifier is not assessed, never passed.",
  how: "A part's co-owners are attrs.owner_teams, its exclusions attrs.not and its decider attrs.decider. A unit's role pairs are attrs.separates; engine.yaml teams.role_map says which role is an owner, a verifier or the decider, and teams.role_teams names the team that holds a role.",
  check(ctx: RuleContext): F[] {
    const f = teamFacts(ctx.model, ctx.plan, ctx.config, { deps: {} });
    const roleMap = teamSettings(ctx.config).roleMap;
    return [
      ...f.separation.parts.map((p) => ({ at: p.part, atKind: "element" as const, message: PART_MESSAGE[p.reason](p.part, p.team) })),
      ...f.separation.pairs.map((p) => ({ at: p.unit, atKind: "unit" as const, message: `unit ${p.unit} must separate ${p.roles[0]} and ${p.roles[1]} (${roleMap[p.roles[0]] ?? "held by a named team"} and ${roleMap[p.roles[1]] ?? "held by a named team"}), and team ${p.team} holds both` })),
    ];
  },
};

export const pack: RulePack = {
  name: "teams",
  title: "Teams and roles",
  description: "Owners and verifiers come from the team registry; units inherit them from the parts they change. Work with no owner team, the team load and separation of duties (as a team-level proxy) are checked here.",
  rules: [verifierExists, unitHasOwner, teamLoad, separation],
};
