# Propose an organization decision

Create a proposed patch in the portfolio root's `patches/`. Never edit org.yaml or seams.yaml. Read portfolio.yaml to find the root, then run `bun plumb.ts build <root>`. Use its printed model hash for `provenance.based_on`. The portfolio brief's root build hash fingerprints root inputs, patch records and notes. The model hash fingerprints structural shared and organization inputs with wording omitted. The hashes serve different purposes and need not match. Never copy the brief's root build hash into `based_on`. Read the root's org.yaml, accepted patches and generated root.json to find the value currently in force. A proposed patch is not in force.

Use the next unused P-NNN id in this root. Ask only for required information the user has not supplied. Build the patch with this envelope and the appropriate ops below:

Use the user's title and patch `why` when supplied. Otherwise write a short title naming the requested change and a neutral `why` that restates the supplied facts. Do not invent a planning review, motive, benefit or tradeoff. This permission covers proposal wording. It does not supply a missing risk acceptance, exception rationale or decision reason.

```yaml
id: P-006
title: Update the team's capacity
status: proposed
provenance:
  author: agent
  agent: { name: design-assistant, tool: Claude Code }
  requested_by: the program lead   # the role the user names; leave the line out when nobody is named
  created: "2026-11-16"
  based_on: <root model hash prefix>
why: The requested WIP limit is 7 concurrent units.
ops:
  - op: modify
    kind: team
    id: appsec-platform
    set:
      capacity: { value: 7, source: person, by: the AppSec platform lead, as_of: "2026-11-16", confidence: medium }
```

## Estimate

Get the team or activity id, value, source, who stated or estimated it, as-of date, confidence and reason. Sources are `person`, `agent`, `tracker` or `derived`. Confidence is `low`, `medium` or `high`. Capacity is a WIP limit in concurrent units. An activity's share is a fraction from zero to one. A team update is `kind: team` with `set.capacity`. An activity update is `kind: activity` with `set.share`. Supply the entire estimate mapping because it is replaced. Keep any existing `stated` figure beside a tracker value. Do not hand-write history. The engine assembles history from accepted patches. An agent's estimate uses `source: agent` and `by: agent:<name>`.

## Slowdown

Get the activity, what changes, share during the slowdown with estimate provenance, start, milestone or calendar end, risk, acceptors and acceptance date. Read current slowdowns to avoid reusing an id. Add a slowdown with a whole record:

```yaml
ops:
  - op: add
    kind: slowdown
    value:
      id: SD-2
      activity: pentest-coordination
      what: Defer routine coordination until the intake milestone.
      share_during: { value: 0.05, source: person, by: the AppSec platform lead, as_of: "2026-11-16", confidence: medium }
      from: "2026-11-16"
      until: intake:M2
      max_until: "2027-03-31"
      risk: { rises: Routine findings wait longer for validation., refs: [intake:finding-queue], level: medium }
      accepted_by: [the security risk owner, the business risk owner]
      accepted_at: "2026-11-16"
      review_by: "2027-01-15"
```

`max_until` and `review_by` are optional supplied dates. Do not invent them. `risk.level` is low, medium or high. A dated end or an unresolved milestone is not evidence of relief. Report the capacity as a proposed allowance and the risk beside it. Acceptance of a risk does not itself accept the patch.

## Exception

Get the exact seam, contracts, risk acceptor, end and why. A seam may be `intake:autotriage`. Read root.json to distinguish a shipped default from an organization list. Adding the organization's list replaces that seam's shipped defaults. A list is complete, not an implicit addition to the defaults.

```yaml
ops:
  - op: add
    kind: exception
    value:
      seam: intake-premerge
      exceptions:
        - contracts: [CheckYield]
          accepted_by: the security risk owner
          until: "2027-01-29"
          why: The teams are settling this feed and accept a warning until the review date.
```

If an org list already exists, use `op: modify`, `kind: exception`, `id: <seam>`, `set: { exceptions: [the complete new list] }`. A list of `[]` declines the shipped default. Removing the org exception record restores the shipped default. Never lower a security floor. A raised mark uses a root contract patch with `security.raised: { by, why }`.

## Validate and report

Run `bun plumb.ts check <root>`, then `bun plumb.ts portfolio impact <portfolio> <patch-id>`. The check validates parsing of all patches. Impact evaluates this proposal and prints the verdict and reasons. Report those, the before and proposed value, provenance, row owner, risk and what still needs a person. An existing unrelated finding may leave the check red.

Only on the user's decision set accepted or rejected with `decision: { by, at, reason }`, then rebuild the portfolio and report findings. Done when the proposal parses, its impact is reported and no acceptance has been invented.
