// flow: value-stream checks. Handoffs between teams are where work waits, so the model must count them honestly,
// keep them few along any path, and record the numbers (WIP limits, waits) that let lead time be summed.
//
// Conventions read from the model:
// - a handoff is a relationship with kind "handoff";
// - "feedback" relationships are loops back and are not part of a forward path;
// - start/end elements are those with attrs.start / attrs.end true; if none are marked, sources/sinks of the flow graph;
// - a person-step is an element whose kind is "person" or "person-step"; a queue has kind "queue".

import type { Finding, Relationship, Rule, RuleContext, RulePack } from "../../src/types.ts";
import { natCompare } from "../../src/core/util.ts";
import { FLOW_KEYS, flowSettings, handoffPaths, hopsOf, isStep, PERSON_KINDS as PERSONS, readFlowValue, streamViews } from "../../src/core/flow.ts";

type F = Omit<Finding, "pack" | "rule" | "severity">;

const STEP_KINDS = new Set(["person", "person-step", "process", "activity", "step"]);
const PERSON_KINDS = PERSONS;
const isHandoff = (r: Relationship) => r.kind === "handoff";

function maxHandoffs(ctx: RuleContext): number {
  const flow = ctx.config.flow as { max_handoffs?: unknown } | undefined;
  const n = Number(flow?.max_handoffs);
  return Number.isFinite(n) && n >= 0 ? n : 4;
}

const handoffCrossesTeams: Rule = {
  id: "handoff-crosses-teams",
  title: "A handoff connects two different teams",
  severity: "warning",
  why: "A handoff is the moment work passes from one team to another; if both ends belong to the same team, or either end has no owner, the handoff count is wrong.",
  check(ctx) {
    const out: F[] = [];
    for (const r of ctx.model.relationships.filter(isHandoff)) {
      const a = ctx.el.get(r.from)?.owner, b = ctx.el.get(r.to)?.owner;
      if (!a || !b) out.push({ at: r.id, atKind: "relationship", message: `handoff ${r.id} has an end with no owner team, so it cannot be counted as crossing teams` });
      else if (a === b) out.push({ at: r.id, atKind: "relationship", message: `handoff ${r.id} stays inside team ${a}; mark it as another kind or fix an owner` });
    }
    return out;
  },
};

const crossTeamCounted: Rule = {
  id: "cross-team-steps-are-handoffs",
  title: "Every step-to-step move between two teams is marked as a handoff",
  severity: "warning",
  why: "Lead time hides in the gaps between teams; a move from one team's step to another team's step that is not marked as a handoff is a wait the count never sees.",
  check(ctx) {
    const out: F[] = [];
    for (const r of ctx.model.relationships) {
      if (isHandoff(r) || r.kind === "feedback") continue;
      const a = ctx.el.get(r.from), b = ctx.el.get(r.to);
      if (!a || !b || !STEP_KINDS.has(a.kind) || !STEP_KINDS.has(b.kind)) continue;
      if (a.owner && b.owner && a.owner !== b.owner)
        out.push({ at: r.id, atKind: "relationship", message: `relationship ${r.id} moves work from team ${a.owner} to team ${b.owner} but is not marked as a handoff` });
    }
    return out;
  },
};

const pathHandoffs: Rule = {
  id: "path-handoff-limit",
  title: "No path from start to end crosses too many handoffs",
  severity: "warning",
  why: "Each handoff adds a queue and a chance to lose context; when one path through the stream crosses more team handoffs than the limit this design sets, that path is the place to simplify first.",
  how: "The limit is engine.yaml flow.max_handoffs (default 4); the path checked is each stream view's path with the most handoffs.",
  check(ctx) {
    const limit = maxHandoffs(ctx);
    const out: F[] = [];
    const team = (id: string) => ctx.team.get(id)?.name ?? id;
    for (const p of handoffPaths(ctx.model, ctx.model.elements.map((e) => e.id), ctx.model.relationships)) {
      if (p.handoffs <= limit) continue;
      const hops = hopsOf(ctx.model, p.path).map((h) => `${team(h.fromTeam)} to ${team(h.toTeam)}`);
      out.push({ at: p.start, atKind: "element", message: `the path ${p.path.join(" → ")} crosses ${p.handoffs} team handoffs (limit ${limit}): ${hops.join(", ")}` });
    }
    return out.sort((a, b) => natCompare(a.at, b.at));
  },
};

const queueWip: Rule = {
  id: "queue-has-wip-limit",
  title: "Every queue declares a WIP limit",
  severity: "warning",
  why: "A queue with no limit on work in progress grows without anyone noticing; declaring its limit makes the queue's capacity a design decision instead of an accident.",
  how: "A part of kind queue needs attrs.wip_limit.",
  check(ctx) {
    return ctx.model.elements.filter((e) => e.kind === "queue" && typeof e.attrs?.wip_limit !== "number")
      .map((e) => ({ at: e.id, atKind: "element" as const, message: `queue ${e.id} (${e.name}) declares no numeric attrs.wip_limit` }));
  },
};

const personWait: Rule = {
  id: "person-step-has-wait",
  title: "Every person-step declares its wait",
  severity: "warning",
  why: "Most lead time is waiting, not working; when every step done by a person says how long a change waits before it, the waits along a path can be added up into a lead time.",
  how: "A person or process step needs attrs.wait_days.",
  check(ctx) {
    return ctx.model.elements.filter((e) => PERSON_KINDS.has(e.kind) && typeof e.attrs?.wait_days !== "number")
      .map((e) => ({ at: e.id, atKind: "element" as const, message: `person-step ${e.id} (${e.name}) declares no numeric attrs.wait_days` }));
  },
};

const flowValues: Rule = {
  id: "flow-values",
  title: "Flow numbers are well formed, sourced and current",
  severity: "warning",
  why: "Lead time, flow efficiency and a patch's days saved are only as true as the waits, work and WIP limits under them. Each must be a number of at least zero, say where it comes from and when, be recent, and be there at every step of a stream view, so an estimate is never shown as a measurement.",
  how: "Each of attrs.wait_days, work_days and wip_limit is a number of at least zero, with flow_source (measured, estimated or declared) and flow_as_of (a date), or engine.yaml flow.source and flow.as_of for parts that give none; a value older than flow.max_age_days (default 90) at build time is reported.",
  check(ctx) {
    const s = flowSettings(ctx.config);
    const out: F[] = [];
    for (const e of ctx.model.elements) for (const key of Object.values(FLOW_KEYS)) {
      const r = readFlowValue(e, key, ctx.today, s);
      for (const p of r.problems) out.push({ at: e.id, atKind: "element", message: `part ${e.id} (${e.name}): ${p}` });
    }
    // missing on a stream view's steps: a process step's wait (person-steps and queues have rules of their own)
    const seen = new Set<string>();
    for (const v of streamViews(ctx.model, ctx.config)) for (const id of v.elements) {
      const e = ctx.el.get(id);
      if (!e || seen.has(id) || !isStep(e) || PERSON_KINDS.has(e.kind)) continue;
      seen.add(id);
      if (!readFlowValue(e, FLOW_KEYS.wait, ctx.today, s).present) out.push({ at: e.id, atKind: "element", message: `step ${e.id} (${e.name}) is in stream view ${v.id} but declares no wait_days` });
    }
    return out.sort((a, b) => natCompare(a.at, b.at) || natCompare(a.message, b.message));
  },
};

export const pack: RulePack = {
  name: "flow",
  title: "Value-stream flow",
  description: "Checks for a value stream: handoffs between teams are counted, no path crosses too many of them, queues have WIP limits, person-steps record their waits, and every flow number is well formed, sourced, dated and current.",
  rules: [handoffCrossesTeams, crossTeamCounted, pathHandoffs, queueWip, personWait, flowValues],
};
