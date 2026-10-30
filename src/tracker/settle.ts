// Each kind of tracker disagreement, in words a person can act on: the condition that makes it appear, and how to
// settle it (which side to change, and how). The Tracker page's Match step shows both under each group, and the
// tracker pack's rules carry the settle line as their "how". One table, so the page and the checks never drift.

export interface SettleGuide { appears: string; settle: string }

/** Plan versus tracker, said once on the Tracker page. */
export const PLAN_VS_TRACKER =
  "The plan is the design's own record of what is done: a unit is done when its done-condition holds, as a person recorded in the plan or in progress.yaml. The tracker is where teams record their work. The engine reads an export of each and never overwrites either, so where they differ it shows both and a person settles it on one side.";

export const SETTLE: Record<"status" | "deps-plan" | "deps-tracker" | "phase" | "owner" | "proposed" | "no-unit" | "no-issue" | "label", SettleGuide> = {
  status: {
    appears: "A linked unit's status in the plan (todo, doing or done) differs from its issue's status in the tracker, read through the status lines of tracker/mapping.yaml.",
    settle: "If the work meets the unit's done-condition, record it in progress.yaml (status, date, by). If the tracker is behind or ahead of the work, move the issue in the tracker and export again. If the tracker's status is mapped to the wrong state, fix its line under status in tracker/mapping.yaml.",
  },
  "deps-plan": {
    appears: "In the plan one linked unit waits on another (it needs a capability the other provides), and in the tracker its issue has no dependency link to the other's issue.",
    settle: "If the dependency is real, draw the link between the two issues in the tracker and export again. If it is not, the unit should not need that capability: change its requires in the plan with a patch.",
  },
  "deps-tracker": {
    appears: "In the tracker one issue links to another as a dependency, and in the plan the two units do not wait on each other.",
    settle: "If the work really waits, add the capability to the plan with a patch (the later unit requires what the earlier provides). If it does not, remove the link in the tracker and export again.",
  },
  phase: {
    appears: "A linked unit's issue sits under another milestone's container (its epic, fix version or label, as tracker/mapping.yaml reads milestones) than the unit's milestone in the plan.",
    settle: "If the issue is filed in the wrong place, move it under its milestone's container in the tracker. If the plan has the unit in the wrong milestone, change its phase with a patch.",
  },
  owner: {
    appears: "The plan gives a linked unit to the teams that own the parts it changes, and the tracker assigns its issue to another team (read through owner_team in tracker/mapping.yaml).",
    settle: "If the tracker is right, the team that does the work should own the part: change the part's owner with a patch, or name the unit's own owner. If the plan is right, reassign the issue in the tracker. Typing a team into the model to match does not settle it.",
  },
  proposed: {
    appears: "An issue with no unit label resembles a unit with no issue: a similar title, the same milestone, or the same team.",
    settle: "If they are the same work, add the copied lines to tracker/links.yaml with who confirmed it and when. If not, leave it: add the unit label to the right issue instead, or export the unit as a new issue.",
  },
  "no-unit": {
    appears: "An issue in a milestone's container matches no unit: no unit label, no confirmed link and no likely match.",
    settle: "If it is work the design needs, add a unit for it with a patch and link it. If it belongs elsewhere, move it out of the milestone's container in the tracker.",
  },
  "no-issue": {
    appears: "A unit has no linked issue, so nobody can see it on the board.",
    settle: "bun plumb.ts tracker export writes an import file for these units; import it into the tracker. If the issue already exists, confirm the link in tracker/links.yaml or add the unit label to the issue.",
  },
  label: {
    appears: "An issue carries a unit label that names no unit in the plan, often a typo.",
    settle: "Correct the label on the issue in the tracker and export again.",
  },
};
