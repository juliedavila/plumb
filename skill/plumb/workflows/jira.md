# Refresh Jira: discover, map, reconcile, export

`<design>/` is the design's folder: `examples/delivery-stream` in this bundle, `instances/<namespace>` in an adopter workspace.

**Scope.** `<design>/tracker/`. The engine reads Jira files the user exported. It never calls Jira, and you do not either. The plan is never changed to match Jira: a disagreement is reported, and a person settles it.
**Inputs.** A folder of raw Jira REST JSON responses the user saved, any file names, Cloud (v3) or Data Center (v2):

| Response | Endpoint (Cloud) |
|---|---|
| Server info | `/rest/api/3/serverInfo` |
| Projects, issue types, fields, statuses, link types | `/rest/api/3/project`, `/issuetype`, `/field`, `/status`, `/issueLinkType` |
| Issues, every page | `/rest/api/3/search/jql` with `expand=changelog` (the changelog gives measured waits) |

If the folder is missing or any of these is absent, list what is missing and ask for it.
**Output.** What changed in the reconciliation, then the items that need a person.

## Steps (run in this order. each reads what the one before wrote)

1. **Discover.** `bun plumb.ts tracker discover <design> --from <export-folder>` writes `tracker/inventory.json` and records where the export is, relative to the instance, so later steps find it. It reports created, changed or unchanged and lists differences from the previous inventory. Report those and its notes (levels above Epic, two fields that look like a team, statuses in an unexpected category).
2. **Map.** `bun plumb.ts tracker draft-mapping <design>` writes `tracker/mapping.yaml`, or `tracker/mapping.draft.yaml` when a mapping exists. The mapping is the user's file: show the draft's choices, and change `mapping.yaml` only with the user's word on each change. Run this step if there is no mapping or discover reports changed mapping vocabulary. Skip drafting when discover reports unchanged mapping vocabulary and the existing mapping is valid, including when only counts or export-source metadata changed.
3. **Reconcile.** `bun plumb.ts tracker reconcile <design>` writes `tracker/reconcile.json` and prints the groups: linked, likely matches, units with no issue, issues with no unit, and the status, milestone, owner and dependency disagreements.
4. **Confirm matches**, only those the user confirms by unit: add each to `tracker/links.yaml`, then run step 3 again.

```yaml
U-24:
  issue: SEC-142
  confirmed_by: the platform lead
  confirmed_at: "2026-11-03"
```

5. **Export** (only when the user asks for issues to be created): `bun plumb.ts tracker export <design>` writes `tracker/jira-import.csv` for units with no issue, each labelled `de-unit:<id>` so the next reconcile links it exactly. Likely matches are held back so the import makes no duplicates. The user imports the file into Jira. you do not.
6. `bun plumb.ts brief <design>` for the tracker line and the statuses after the refresh.

## What to say

The reconcile counts as printed. each disagreement as "<unit title> (`U-n`) is <plan status> in the plan. <issue> is <Jira status> in Jira". The likely matches to confirm with their reasons. And the newest issue update in the export, so the user knows how fresh it is. Never describe a Jira status as the plan's.

## Done when

Reconcile ran on the user's export, `tracker/reconcile.json` is current, and the user has every disagreement and every match waiting for confirmation.
