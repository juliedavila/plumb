# Record a unit's status or a milestone override

`<design>/` is the design's folder: `examples/delivery-stream` in this bundle, `instances/<namespace>` in an adopter workspace.

**Scope.** `<design>/progress.yaml` (unit status) or `<design>/milestones.yaml` (milestone override), one entry per change. These files sit beside the plan and survive a re-import, so they work the same for an imported plan and a hand-written one. Never edit `plan.yaml` for this.
**Inputs.** From the user, in this conversation: which unit or milestone, the new status, the reason, the date, and who set it (a role). for a milestone, a review-by date when the user gives one. Ask for any required field that is missing. do not fill one in.

- **Which unit.** When the user names the work loosely ("the export is done"), find the units whose title matches in `bun plumb.ts plan <design>` and confirm before writing: "You mean Export stage timestamps to flow metrics (`U-06`)?" With more than one candidate, list them and ask. Never pick one yourself.
- **The reason.** The user's own statement can stand as the reason. quote it ("Export runs nightly since Monday"). Ask only when they gave none: "done" alone is a status, not a reason.
- **The date** is the day it happened, as the user says it. "today" is today's date. **Who** is a role ("the platform lead"), never a person's name. ask for the role when the user gives a name.
**Output.** The entry, and the build's status for that milestone afterwards.

## A unit's status

`status` is `todo`, `doing` or `done`. Add or replace the unit's entry under `units:` in `<design>/progress.yaml` (create the file with the `units:` line if it does not exist):

```yaml
units:
  U-24: { status: done, date: "2026-11-03", by: the platform lead, reason: "Recheck runs before every grant in staging." }
```

## A milestone override

A person's red, amber or green, shown beside the computed one. The key is the milestone's phase id (`PH-2`, `SHORTEN`). Add `override` under it in `<design>/milestones.yaml`, keeping its other fields:

```yaml
milestones:
  PH-2:
    override: { status: amber, reason: "The operator is named. The start waits on the budget decision on 14 Nov.", date: "2026-11-03", by: the decision owner, review_by: "2026-11-14" }
```

`review_by` (YYYY-MM-DD) is optional: once it passes, the page, the deck and the brief say the review is due. To withdraw an override, delete its `override` line. Who answers for the milestone goes in `accountable: <a role>` beside `override`, at the user's word. The page names that role on every step that needs an owner. Who confirms the status independently goes in `confirmed_by: <a role>`. With it, the card reads "Status set by: <accountable> · Confirmed by: <confirmed_by>".

## Check it

`bun plumb.ts build <design>`, then `bun plumb.ts brief <design>`:

- A `core/progress-valid` or `core/override-valid` error means the entry is not applied. its message names the missing field. Fix it from the user's words, never with a guess.
- Report the milestone's row from the brief: shown status, computed status, first reason. When the override differs from the computed status, say both. When its Override cell says "Check it:", report that sentence word for word (a green set while an earlier milestone it waits on is red, a computed status that worsened since the override was set, or a review date passed). The override still stands until the user changes it.

## Tracker disagreements the new status creates

After the build, run `bun plumb.ts check <design>` and look for `tracker/status-agrees` on the unit you changed. When the plan now says `done` and the tracker's issue is still "In Progress" (or the other way round), tell the user in one line, as the engine prints it, and that the milestone stays amber for it until one side changes. Do not edit the tracker files to match: the user settles it in the tracker and re-exports.

## Done when

The build prints neither error for the entry, and the user has the milestone's shown and computed status.

## Override a default work type

In schema 0.4 a unit ships its default `flow_item`. At the user's word, set `units: { <id>: { flow_item: risk } }` in progress.yaml, keeping the entry's other fields. Values are feature, defect, risk and debt. This changes the organization's work classification and keeps the edition's default visible. Rebuild and report the new work mix.
