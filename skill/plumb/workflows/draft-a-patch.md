# Draft a patch

`<design>/` is the design's folder: `examples/delivery-stream` in this bundle, `instances/<namespace>` in an adopter workspace.

**Scope.** One new file, `<design>/patches/P-<NNN>-<slug>.yaml`, with `status: proposed`. No other file changes: the model and plan change only when a person accepts the patch.
**Inputs.** The change the user asked for, in their words, and who asked (a role).
**Output.** The patch file, and its impact report summarised to the user: the verdict, what it adds, removes and changes, the findings it introduces and resolves.

## Steps

1. `bun plumb.ts brief <design>`: note the model hash (12 characters). That is `based_on`. It is the model in force: proposals not yet accepted do not change it, so several proposals drafted together share one `based_on`. (`bun plumb.ts build <design>` prints the same value on its `model:` line. Never use its `hash:` line, which changes with notes and patches.)
2. Find the records the change touches in `<design>/model.yaml` and `plan.yaml`, by id. For an imported design, `milestones.yaml` and `progress.yaml` sit beside a generated plan. A patch never edits them.
3. The id: one more than the highest `P-<NNN>` in `<design>/patches/`, three digits (the delivery stream ships `P-001` and `P-002`, so its next is `P-003`). The slug: three to five words of the title, lowercase, joined by hyphens. The example below uses `P-003`. Use the id this step gives.
   If the user supplies no title, name the requested change in plain words. If they supply no patch `why`, restate the requested facts neutrally. One factual sentence is enough. Do not invent a motive, benefit or tradeoff, or attribute your wording to a person.
4. Write the file:

```yaml
id: P-003
title: Fold release approval into the deploy gate
status: proposed
provenance:
  author: agent
  agent: { tool: Claude Code, model: <the model you run as> }
  requested_by: the delivery lead        # the role the user names; leave the line out when nobody is named
  request: "<the user's request, in their words>"
  created: "<today, YYYY-MM-DD>"
  based_on: <the model hash from step 1>
why: >-
  <State the supplied problem and requested change. Include a tradeoff only if supplied. Every part, contract, unit or id the why
  names is one an op below adds, removes or modifies.>
ops:
  - { op: remove, kind: element, id: release-approval }
  - op: add
    kind: relationship
    value: { id: h16, from: manual-test, to: deploy-service, kind: handoff, label: Passing test report, carries: [TestReport] }
  - op: modify
    kind: contract
    id: TestReport
    set: { consumed_by: [manual-test, deploy-service] }
```

   Ops are `add` (with `value`, the whole record), `modify` (with `id` and `set`) and `remove` (with `id`), on `element`, `relationship`, `contract` (its id is its name), `team`, `system`, `zone`, `unit`, `phase`, `view` and `claim`. Removing an element also removes the relationships that touch it and its ids from contracts, views and units. The impact report lists that cascade.

   **How `modify` merges.** `set` replaces each field it names and leaves the others (`null` unsets a field), except `attrs`, which merges one level: `set: { attrs: { wip_limit: 8 } }` changes `wip_limit` and keeps every other attribute the part has. To remove one attribute, set it to `null` inside `attrs`.

   **Flow values carry their provenance.** When an op sets `wait_days`, `work_days` or `wip_limit` (in `attrs`), set `flow_source` and `flow_as_of` beside it in the same `attrs`: `estimated` for a value the request proposes (a patch's number is never `measured`), and today's date. Without them the new value keeps the old value's source and date, which would call a guess a measurement. The `flow/flow-values` check reports a value with neither.

```yaml
  - { op: modify, kind: element, id: sprint-backlog, set: { attrs: { wip_limit: 8, flow_source: estimated, flow_as_of: "2026-11-03" } } }
```

   The impact report says when a flow value is the patch's own estimate ("This patch sets the WIP limit at …: its own estimate, with no measurement behind it"). Repeat that to the user.
5. `bun plumb.ts impact <design> P-003` (your patch's id). Read its `## Verdict` section.
6. If the verdict names something the why claims and no op backs, or a check the patch breaks that the user did not ask to break, revise the ops or the why and run step 5 again. Stop after three revisions and report where it stands.

## What to say

The verdict word as printed (`fail`, `caution` or `pass`) and its reasons, word for word. The records added, removed and modified. The findings introduced and resolved. Then: "It is proposed. Accepting it is your call: say so and I will set `status: accepted` with `decision: { by, at, reason }`."

## Done when

The file parses (`bun plumb.ts check <design>` shows no `core/patch-loads` error for it), `bun plumb.ts impact` printed its verdict, and the user has the verdict with its reasons.

For a root estimate, slowdown, exception or shared record, use `org-decisions.md` and `bun plumb.ts portfolio impact <portfolio> <patch>`. Design patch kinds do not include org activities or exceptions. Never edit shipped shared files.
