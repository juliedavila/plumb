// org: checks on the organization's records in the shared root's org layer. They
// run in the root's own build and in a portfolio build, never in a design's own build, and read what
// src/core/org.ts found (ctx.root): this pack only says what each rule is and why it matters.
import type { Finding, Rule, RuleContext, RulePack } from "../../src/types.ts";

type F = Omit<Finding, "pack" | "rule" | "severity">;
const found = (rule: string) => (ctx: RuleContext): F[] => (ctx.root?.problems ?? []).filter((p) => p.rule === `org/${rule}`).map(({ at, atKind, message }) => ({ at, atKind, message }));

const estimateValid: Rule = {
  id: "estimate-valid", title: "Every org number says what it is, who gave it, when and how sure", severity: "error",
  why: "A capacity or a share changes what every page computes. One with no source, no date or no confidence cannot be weighed, and one out of range cannot be true, so it counts as not stated rather than quietly steering the load.",
  how: "Each estimate needs value, source (person, agent, tracker or derived), by, as_of (YYYY-MM-DD) and confidence (low, medium or high). A share is between 0 and 1; a capacity is a whole number of at least 1. A relief that reduces a share gives the share after it as an estimate in `to`.",
  check: found("estimate-valid"),
};

const estimateStale: Rule = {
  id: "estimate-stale", title: "Org numbers are recent", severity: "warning",
  why: "Capacity and the share of time that keeping the lights on takes drift as people move. A number nobody has looked at in a quarter may no longer be true, so the page shows its age and asks for it again.",
  how: "An estimate in force whose as_of is older than the root's estimates.stale_after_days (default 90) at the build date.",
  check: found("estimate-stale"),
};

const sharesExceed: Rule = {
  id: "shares-exceed-capacity", title: "Standing work leaves a team some capacity", severity: "warning",
  why: "When a team's activities take all of its capacity, it has nothing left for design work, so any unit it owns waits however the plan is ordered.",
  how: "The shares of a team's activities, as org.yaml and the accepted root patches write them, sum to 1 or more. A relief or a slowdown only lowers a share.",
  check: found("shares-exceed-capacity"),
};

const slowdownValid: Rule = {
  id: "slowdown-valid", title: "A slowdown is a written, accepted bet", severity: "error",
  why: "Slowing down standing work frees capacity at the cost of risk. It counts only when it says what slows, by how much, from when until when, what risk rises, and who accepted that risk when; otherwise it is not applied.",
  how: "org.yaml slowdowns: what, activity, share_during (an estimate), from, until (a milestone or a date), risk.rises, accepted_by and accepted_at.",
  check: found("slowdown-valid"),
};

const slowdownOverdue: Rule = {
  id: "slowdown-overdue", title: "A slowdown ends or is reviewed on time", severity: "warning",
  why: "A slowdown is a bet with an end. Once its ending milestone is late, or it runs past the latest it may run, or its review date passes, the risk it raises has outlived what was accepted.",
  how: "Its ending milestone's target has passed and the milestone is not reached, or max_until or review_by has passed, at the build date.",
  check: found("slowdown-overdue"),
};

const exceptionValid: Rule = {
  id: "exception-valid", title: "A seam exception names who accepts the risk, its end, and what it covers", severity: "error",
  why: "An exception flags a seam crossing instead of blocking the build. That is a risk decision, so it must name the person who accepts the risk, when it ends, and contracts its seam actually carries; one that does not is not applied.",
  how: "org.yaml seam_exceptions (or a seam's shipped default_exceptions): contracts, accepted_by, until (a milestone or a date). The organization's list for a seam replaces the shipped default; an empty list declines it.",
  check: found("exception-valid"),
};

export const pack: RulePack = {
  name: "org",
  title: "Org layer",
  description: "The organization's own records in the shared root: capacity and shares as estimates with provenance, standing work, deliberate slowdowns and seam exceptions.",
  rules: [estimateValid, estimateStale, sharesExceed, slowdownValid, slowdownOverdue, exceptionValid],
};
export default pack;
