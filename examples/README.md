# The example portfolio

Fictional data for engine 0.4's portfolio features (see SPEC.md for the shared-root contract). Three designs share one root and six teams. Every name is invented: teams are named by what they do, people by role titles, and no organization, sector or product appears.

The 0.4 engine loads, checks and renders this portfolio. Run `bun plumb.ts portfolio build examples/portfolio --today 2026-11-16` from the engine root and open `build/portfolio-example/index.html`. Error findings are deliberate. The build writes its outputs and exits 1. The expectations below are executable regression cases.

## What is here

```
examples/
  shared/                  the root: kind root, namespaces shared and org
    engine.yaml            approver, estimates settings, tracker export, shared_from (the hash of seams.yaml)
    seams.yaml             the shared layer, written by hand as the editions would ship it
    manual-work.yaml       the manual-work catalog: four kinds
    org.yaml               six teams, six activities, one slowdown, one seam exception
    team-map.yaml          roles to teams
    notes.yaml             two notes, one on an org record and one on a shared record
    patches/               P-001 to P-004 accepted, P-005 proposed
    tracker/               mapping.yaml (kind: org), inventory.json, export/ (121 issues with status history),
                           measures/2026-11-01.json (the measure of that export, run on 2 November)
  designs/
    intake/                Findings intake, namespace intake: the platform
    premerge/              Pre-merge checks, namespace premerge: the module, with a released edition 1.0.0
    inventory/             Asset inventory cleanup, namespace inventory: the organization's own, mostly transition work
  portfolio/portfolio.yaml the three designs over the root; portfolio.lock is written by the build
  expected.yaml            the findings below, for tests
tests/fixtures/portfolio/
  base/                    a clean portfolio of two small designs, alpha and beta: a check reports nothing
  variants/<rule>/         one broken variant per new rule: the files it lays over base, and variant.yaml
  make-jira-export.ts      writes examples/shared/tracker/export
  rehash.ts                rewrites every hash and pin after an edit
```

Every date-dependent finding assumes a build on 2026-11-16. Tests should pass `built: 2026-11-16T10:00:00Z`.

## The designs

**Findings intake** (`intake`, 13 parts, 14 units, three milestones). Scanner output and pen-test reports come into one queue. Repeats fold together, an agent drafts each finding's triage, and classes of finding that keep coming back are proven and sent to pre-merge checks. Two parts form a module, `autotriage`, with its own seam. It pins Pre-merge checks 1.0.0. Its current milestone is M1, "Every scanner reports into intake" (target 2026-12-11).

**Pre-merge checks** (`premerge`, 9 parts, 11 units). Checks built from intake's proven classes run on every change. A coding agent proposes fixes and an engineer approves each one. Its third milestone waits on two capabilities intake provides across the seam. Its released edition 1.0.0 (2026-10-28) differs from the working copy in one place: the check runner's workspace. Its current milestone is M1, "Checks run on every merge request" (target 2026-12-04).

**Asset inventory cleanup** (`inventory`, 8 parts, 5 parts that exist only today, 11 units). One owned asset list replaces spreadsheets, scripts and an export. Its first milestone, "Know what we have", is reached (all three units done), so its current milestone is M2, "One owned list" (target 2027-01-15). It sends intake each asset's owner through a seam the organization declared in its root.

The designs never name each other, except in descriptive records: intake's view `across-the-seam` shows three of premerge's parts, and intake's premise IN-4 rests on premerge's PM-2. Everything that crosses is in the shared layer.

## The cases, and what each check should report

### Namespaces, the root and pins

- All three designs declare `schema: "0.4"`, a namespace and `root: ../../shared`. The root's `engine.yaml` says `kind: root` and names no root and no pins. Nothing reports.
- Bare ids resolve to the design's own record, then the shared layer's, then an org team. For example `system: people` and `zone: existing` resolve to shared records, and `owner: vuln-mgmt` to an org team. Some references are written namespaced on purpose: premerge's `shared:code-host` and `shared:SH-1`.
- Intake pins premerge 1.0.0 by the sha256 of `designs/premerge/editions/1.0.0/edition.yaml`. Premerge pins nothing, so there is no loop.
- **core/xref-pin-stale, warning, intake.** The working view composes premerge's working copy, and its check runner changed after 1.0.0 (`workspace: per-run` instead of `per-repository`). The check runner is a part the shared layer names (crossings x01 and x06, and intake's exposure list). The finding lists the check runner. Premerge's edition recorded the same hash of seams.yaml the root holds now, so condition (ii) adds nothing. The presenting view composes 1.0.0, where the pin is current and the finding is gone.

### The shared layer: crossings and marks

The shared layer holds one shared part, the code hosting and CI system (`code-host`). Its owner is the role "the developer platform owner", which the team map gives to Developer platform. It rests on the shared premise SH-1. It is not agent-reachable.

Six crossings are written in `seams.yaml`, and the organization adds a seventh, x07, by the accepted patch P-002. All seven are declared, so none is reported. A shipped floor is authoritative: where seams.yaml records one for a contract, the engine adds nothing to it. The engine's own signals give a provisional floor only to what the shipped file never held, such as x07 and its contract. Their marks:

| Crossing | From, to | Contract | Mark | What derives it |
|---|---|---|---|---|
| x01 | intake's class registry to premerge's check runner | ProvenClass | relevant | the authors' floor `agent-input` (it ends at an agent-reachable part) |
| x02 | premerge's stamp signer to intake's merge ledger | MergeStamp | relevant | the authors' floor `signed-record` (evidence content into a partitioned store) |
| x03 | premerge's yield reporter to intake's class tuner | CheckYield | relevant | raised by the shared layer's authors; no check reads it |
| x04 | the code host to intake's deduplication | RepoOwners | not relevant | nothing; marked `relevant: false`, which is valid with an empty floor |
| x05 | the code host to premerge's merge request hook | MergeRequest | relevant | the authors' floor `outsider-text` (`content: untrusted` and untrusted fields) |
| x06 | premerge's check runner to the code host | CheckResult | relevant | the authors' floor `gate-feed` only: the case where the shipped floor is the only reason |
| x07 | inventory's ownership feed to intake's deduplication | AssetOwnership | relevant | raised by the organization's patch P-003; no engine signal reads it |

**shared/mark-valid, shared/crossing-valid and shared/file-intact report nothing.** No mark is lowered, every crossing carries a contract the shared layer defines, nothing carries intake's ClassOracle (the seam's never-cross list), and seams.yaml has the hash the root recorded.

### Seams and exceptions

- `intake-premerge` (in seams.yaml). Its owner role, "the pre-merge checks owner", maps to AppSec platform. Checks: `security/agent-reach` and `security/evidence-partitioned`. Each has subjects across the seam. Its exposure tells intake's own build that coding agents reach premerge's check runner. Its default exception flags CheckYield until intake's M2, accepted by the security risk owner. The exception is in force on 2026-11-16 and has nothing to soften, since every CheckYield crossing is declared.
- `inventory-intake` (added by P-002). Its owner role, "the asset inventory owner", maps to Governance and risk. It has no exception.
- `intake:autotriage`, intake's own module seam (checked by the same rule as shared seams). It sits in intake's model.yaml, between the module `autotriage` (parts tagged `module: autotriage`) and the rest of intake. It names r05 and r07 as its crossings. The organization's exception in org.yaml, keyed `intake:autotriage`, flags TriageHint until 2027-01-29, accepted by the head of vulnerability management.

**org/exception-valid reports nothing.** Both exceptions name an acceptor, an end and a contract their seam carries.

### Seam crossings that nothing declares

**portfolio/seam-crossing-declared, three findings.** Each also shows in its design's own build.

| Relationship | What it is | Severity | Why |
|---|---|---|---|
| inventory v01 | the code host to inventory's repository crawler, carrying RepoMetadata | error | Security-relevant: it is marked `content: untrusted`, and RepoMetadata has untrusted fields (topics and readme text anyone with commit access writes). |
| intake r08 | the module's triage hints to intake's finding queue, carrying TriageHint | warning | It crosses the module seam, which does not name it. TriageHint has untrusted fields, so it is security-relevant, and the organization's exception on `intake:autotriage` softens the error to a warning until 2027-01-29. |
| premerge p12 | premerge's yield reporter to the code host, carrying YieldBadge | warning | Not security-relevant: the code host is not agent-reachable and grants no authority, YieldBadge has no untrusted fields, and it is not evidence. |

No crossing between two designs is undeclared. A design could only draw one by naming the other design, which core/xref-resolves forbids.

### Estimates with provenance and history

Every org number carries value, source, by, as_of and confidence.

- **History.** AppSec platform's capacity has its own `history` (7 in May) and its base value (6 in August), and the accepted patch P-001 changes it to 5 (2026-09-14). Vulnerability management's capacity has two history entries, 5 and 4. Vulnerability management's and Detection and response's triage and on-call shares change by the accepted patch P-004, the first tracker refresh, which keeps each person's figure as `stated`.
- **Stale.** **org/estimate-stale, warning, Developer platform's capacity.** It was stated on 2026-07-20, 119 days before the build date. Every other estimate in force is younger than 90 days.
- **Row owner.** Governance and risk's capacity was stated by the program lead, not by its row owner, the governance and risk lead. The page marks it.
- **Pending.** P-005 is a proposed refresh by the agent org-scout. It would set every activity's share to its measured value and keep each stated figure beside it.
- **org/estimate-valid reports nothing.**

### Measured from the tracker

`tracker/export/` holds 121 issues in four projects (SEC, INC, GRC, PLAT), each with its status history. 116 carry the Owning team field, and the measure leaves the other five out and counts them. Every bucket of `tracker/mapping.yaml` is reached, and each matcher kind is used once: labels, type, project, components, parent and field. Three issues test precedence:

- An issue labelled `de-unit:intake:U-06` that also carries `vuln-triage` is design work, since design work comes first.
- An issue labelled with the bare `de-unit:U-04` is not design work, since a bare label belongs to a lone instance. It lands in unclassified.
- An INC issue with the component Customer assurance is incident on-call, since the project matcher comes before the component matcher.

A measure over the 90 days ending at the export date (2026-08-03T00:00Z to 2026-11-01T00:00Z, every status change at 00:00 UTC) should give these shares of each team's days in In Progress and In Review. Three issues began before the window and are clipped. Issues still open at the export date count their days to the window's end.

| Team | Days in doing | Activity shares | Unclassified | Coverage | Issues | Confidence |
|---|---|---|---|---|---|---|
| Vulnerability management | 400 | vuln-triage 0.38 | 40 days | 0.90 | 32 | high |
| AppSec platform | 200 | pentest-coordination 0.12, scanner-rule-upkeep 0.20 | 20 days | 0.90 | 22 | medium |
| Detection and response | 200 | incident-oncall 0.52 | 20 days | 0.90 | 26 | medium |
| Governance and risk | 150 | audit-evidence 0.24, questionnaires 0.28 | 15 days | 0.90 | 18 | medium |
| Developer platform | 80 | none | 12 days | 0.85 | 10 | medium |
| Product engineering | 60 | none | 9 days | 0.85 | 8 | low |

Flow calibration has enough data for two teams. Vulnerability management has 26 finished issues over 94 days of history, and an observed WIP of 4.44 (400 days over 90) against its limit of 3. Detection and response has 23 finished, and an observed WIP of 2.22 against 4. The other four teams have 18, 17, 7 and 4 finished, under the floor of 20, so the page says how many each has. The exact cycle time depends on whether a clipped issue's days before the window count; with in-window days it is 11.8 days for Vulnerability management and 7.6 for Detection and response.

The engine counts a finished item's whole history in its cycle time, since the cycle is the item's own, so Vulnerability management's is 11.9 days. Its finishing rate times that cycle time gives 3.4, more than a fifth short of its observed 4.4: its work in progress went from 1 at the window's start to 5 at its end, so the suggestion says the average describes a changing load. Detection and response's gives 1.9 against 2.2, within a fifth, so its numbers agree. Read against the limits in force: Vulnerability management carries more than its limit of 3 ("Either the limit is not being held, or it sits below what the team carries"), and Detection and response carries less than its 4. Neither limit changes: a measure proposes a WIP limit only when asked (`--limits`), inside the refresh.

The rules for an activity take only issues of that activity's own team, top to bottom. In this export no team's issue matches another team's rule, so that changes nothing here; where one does, the issue stays its own team's unclassified time and the measure says which rule it matched.

`tracker/measures/2026-11-01.json` is that measure as `bun plumb.ts tracker measure` writes it: every team's numbers, and one line per issue counted with the bucket it landed in. The root's build reads it: each activity's share gets its measured series and its gap from the figure a person stated (triage: stated 25%, measured 38%, 13 points apart), each calibrated team's limit its observed WIP, and each team its unclassified band. P-005 is what `--draft-patch` drafts from it.

**tracker/mapping-matches-inventory reports nothing.** Every project, type, label, component, parent, field, field value and status the mapping names is in `inventory.json`.

### BAU activities and relief

| Activity | Team | Type, flow item | Share in force on 2026-11-16 | Relieved by |
|---|---|---|---|---|
| Manual vulnerability triage and validation | Vulnerability management | bau, risk | 0.34 measured (P-004), 0.10 while the slowdown runs | intake U-09 reduces it to 0.12; intake U-14 retires it |
| Penetration test coordination | AppSec platform | bau, risk | 0.10 | nothing |
| Incident on-call | Detection and response | bau, defect | 0.40 measured (P-004) | nothing |
| Audit evidence collection | Governance and risk | bau, risk | 0.10, since inventory's M1 is reached (0.25 before) | inventory M1 reduces it to 0.10 |
| Scanner rule upkeep | AppSec platform | bau, debt | 0.17 | intake U-10 reduces it to 0.08 |
| Customer security questionnaires | Governance and risk | stream, feature | 0.20 | nothing |

- **Relief by a milestone that is reached.** Audit evidence collection is relieved by inventory's M1. The page should show the projected 10% beside the measured 24%: the payoff has not landed.
- **Relief by a unit.** The other reliefs land when their unit is done, in the month of its milestone's target.
- **Manual-work links.** Three activities link a kind from manual-work.yaml: triage to `finding-triage`, audit evidence to `evidence-gathering` and scanner rules to `rule-tuning`. Units that relieve `finding-triage` are intake U-09 and U-14, which the activity names, and premerge U-11, which it does not. Premerge U-11 shows as "not linked". `retest-after-fix` is relieved by premerge U-05, and no activity links it. Each relief rests on a premise: intake IN-2, IN-3 and IN-4, premerge PM-1 and PM-2, inventory IV-2.

### The slowdown bet

SD-1 slows manual triage to critical and high findings from 2026-11-15 until intake's M2 (target 2027-01-29). The latest it may run is 2027-03-31. During it the triage share is 0.10 instead of 0.34, which frees 0.72 of a slot for Vulnerability management. Meanwhile medium and low findings wait about 30 days for triage instead of about 5. The security risk owner and the business risk owner accepted it on 2026-11-10, and it is due for review on 2027-01-15. It is in force on 2026-11-16. **org/slowdown-valid and org/slowdown-overdue report nothing.**

### Capacity

Allowance is capacity times one less the shares in force. Doing counts units in doing in every design, one slot per owner team.

| Team | Capacity in force | Allowance | Doing | Open units on the next milestones' paths | Result |
|---|---|---|---|---|---|
| AppSec platform | 5 | 3.65 | 1 | 3: intake U-02, U-03; premerge U-03 | within |
| Vulnerability management | 3 | 2.70 | 3: intake U-04, U-05, U-06 | 4: intake U-04 to U-07 | over, on a path |
| Detection and response | 4 | 2.40 | 2: inventory U-10, U-11 | none | within, 0.4 free |
| Product engineering | 2 | 2.00 | 3: premerge U-04, U-05, U-06 | none | over, later work only |
| Developer platform | 3 (stale) | 3.00 | 1: premerge U-02 | 3: premerge U-02; inventory U-05, U-07 | within |
| Governance and risk | 4 | 2.80 | 1: inventory U-04 | 3: inventory U-04, U-06, U-08 | within |

- **portfolio/team-over-capacity, error, Vulnerability management.** Even with the slowdown it holds 3 units in doing against an allowance of 2.7, and it owns open units on the path to intake's current milestone.
- **portfolio/team-over-capacity, warning, Product engineering.** It holds 3 units in doing against 2, all in premerge's M2. It owns nothing on any design's current path.
- No current milestone's path reaches another design, so reading a path within one design or across the composed plan gives the same result.
- **The most contended team is Vulnerability management.** It has 4 open units on the paths against an allowance of 2.7, a ratio of 1.48. Next are Governance and risk at 1.07 and Developer platform at 1.00.
- **Capacity returns.** Vulnerability management's triage share goes to 0.12 when intake's M2 lands, then to zero with U-14 in M3. AppSec platform's scanner share goes to 0.08 with intake U-10 in M2.
- **org/shares-exceed-capacity reports nothing.** The highest sum is Governance and risk's 0.45, before its relief.

### Flow items

Every unit carries a flow item, so **portfolio/unit-has-flow-item reports nothing**. intake U-10 is `debt` in the plan and overridden to `risk` in progress.yaml, so the page says "set here". Open units by flow item: intake 7 feature and 6 risk; premerge 1 feature, 7 risk and 2 debt; inventory 4 feature and 4 debt. Activities: three risk, one defect, one debt, one feature.

### Current state (inventory only)

`designs/inventory/current.yaml` holds three confirmed records (alert enrichment, the legacy CMDB export, the ownership spreadsheet) and four discovered ones (the repository crawler, the nightly scan scripts, the cloud tag sync job, the ownership macros). Five are parts that exist only today, each naming the system `inventory`. **core/current-valid reports nothing.**

**plan/retire-before-replace, three findings:**

| Part | Record | Severity | Why |
|---|---|---|---|
| Ownership spreadsheet | confirmed, replace by the ownership feed | error | No unit moves it to retired. |
| Cloud tag sync job | discovered, replace by the reconciler | warning | Its retiring unit, U-09, is in M3, after M2, where U-04 brings the reconciler to built. The message says it rests on a discovered record, found by current-state-scout on 3 Nov. |
| Ownership macros | discovered, replace by the reconciler | warning | Its retiring unit, U-08, is in M2 like U-04, but does not depend on U-04, so the macros could go before the reconciler arrives. |

The legacy CMDB export is clean: U-06 retires it in M2, where U-04 builds the asset list, and U-06 depends on U-04. The nightly scan scripts are clean: their disposition is retire and U-07 retires them.

Transition work: 7 of inventory's 11 units move a part whose disposition is transition, replace or retire, or move a part to retired (U-01, U-06 to U-11). Two are in doing, U-10 and U-11. U-01's count rests on a discovered disposition. `plan/fidelity-moves-up` accepts the four moves to `retired`, since each part's disposition is replace or retire.

### Patches on the root

| Patch | Status | What it does |
|---|---|---|
| P-001 | accepted | AppSec platform's capacity 6 to 5 |
| P-002 | accepted | the organization's seam: contract AssetOwnership, crossing x07, capability cap.asset-owners, seam inventory-intake |
| P-003 | accepted | raises the mark on AssetOwnership |
| P-004 | accepted | the first tracker refresh: triage 0.34 and on-call 0.40, with the stated figures kept |
| P-005 | proposed | the latest refresh: all six shares as measured above, the ops `bun plumb.ts tracker measure examples/shared --draft-patch --agent org-scout` drafts |

**P-005's portfolio verdict should be caution.** On-call at 0.52 cuts Detection and response's allowance from 2.4 to 1.92, under its 2 units in doing, which are later work. That adds one warning, portfolio/team-over-capacity on Detection and response, and no error. Its other changes move no team over: AppSec platform's allowance falls to 3.4 and Governance and risk's to 2.48, and the slowdown holds triage at 0.10 today.

### Notes

`shared/notes.yaml` pins a question to the activity vuln-triage (org) and a note to the contract CheckYield (shared).

## The findings, all together

A portfolio check of `examples/portfolio` on 2026-11-16, working view, should report exactly these ten. `expected.yaml` holds the same list. Today's packs (generic, plan, security, teams, premises) find nothing else on the composed designs, with the four moves to `retired` supported by the current-state rules.

| Rule | Severity | Subject |
|---|---|---|
| core/xref-pin-stale | warning | intake's pin on premerge 1.0.0 (lists the check runner) |
| portfolio/seam-crossing-declared | error | inventory v01 |
| portfolio/seam-crossing-declared | warning | intake r08 (excepted) |
| portfolio/seam-crossing-declared | warning | premerge p12 |
| portfolio/team-over-capacity | error | Vulnerability management |
| portfolio/team-over-capacity | warning | Product engineering |
| org/estimate-stale | warning | Developer platform's capacity |
| plan/retire-before-replace | error | inventory's ownership spreadsheet |
| plan/retire-before-replace | warning | inventory's cloud tag sync job |
| plan/retire-before-replace | warning | inventory's ownership macros |

The presenting view drops the first, since it composes premerge 1.0.0.

## Broken variants

`tests/fixtures/portfolio/base` is a clean portfolio: designs alpha and beta, one seam, a plain shared part and an agent-reachable one, two teams within capacity. A check reports nothing. Each folder under `variants/` holds the files it lays over the base and a `variant.yaml` naming the one finding a portfolio check should then report. A test copies the base, copies the variant over it and checks.

| Variant | What it breaks | Rule | Severity |
|---|---|---|---|
| xref-resolves | alpha's contract names beta's part b-out as a producer | core/xref-resolves | error |
| xref-resolves-from-root | an org relief names alpha:AU-9, which alpha does not hold | core/xref-resolves | error |
| xref-pin-stale | alpha pins beta 1.0.0, and beta's working copy changed b-in, which a crossing names | core/xref-pin-stale | warning |
| xref-no-cycle | alpha pins beta and beta pins alpha | core/xref-no-cycle | error |
| deprecated-key | alpha's tour targets a milestone with the old key `gate` | core/deprecated-key | warning |
| schema-known | beta declares schema 0.5 | core/schema-known | error |
| one-home | alpha declares teams while its root has an org layer | core/one-home | error |
| one-root | beta names a second root, a copy of the first | portfolio/one-root | error |
| seam-crossing-declared | beta's own edge carries a contract with untrusted fields into the agent sandbox | portfolio/seam-crossing-declared | error |
| no-cross-effort-cycle | alpha's AU-2 and beta's BU-1 wait on each other through shared capabilities | portfolio/no-cross-effort-cycle | error |
| team-over-capacity | team A's capacity drops to 1, under its unit in doing on alpha's next path | portfolio/team-over-capacity | error |
| unit-has-flow-item | beta's BU-2 has no flow item | portfolio/unit-has-flow-item | warning |
| estimate-valid | team B's capacity has no confidence | org/estimate-valid | error |
| estimate-stale | team B's capacity is from 2026-06-01 | org/estimate-stale | warning |
| shares-exceed-capacity | team B's activities take 0.6 and 0.4 | org/shares-exceed-capacity | warning |
| slowdown-valid | a slowdown names no one who accepted it | org/slowdown-valid | error |
| slowdown-overdue | a slowdown in force is past its review date | org/slowdown-overdue | warning |
| exception-valid | the organization's exception names no acceptor | org/exception-valid | error |
| mark-valid | a root patch marks Task not relevant, below its floor | shared/mark-valid | error |
| crossing-valid | a root patch puts Spec on the never-cross list, and s1 carries it | shared/crossing-valid | error |
| file-intact | seams.yaml edited by hand | shared/file-intact | error |
| current-valid | a current-state record confirmed by an agent | core/current-valid | error |
| retire-before-replace | a confirmed replace with no retiring unit | plan/retire-before-replace | error |

Each `variant.yaml` also says where else the finding shows, or what keeps other rules quiet. Two need an implementation choice to stay single:

- `no-cross-effort-cycle`: neither design's own plan has a cycle. A composed run of the plan pack would also report it, so the plan pack must not run composed.
- `xref-no-cycle`: no pinned edition exists. The loop must be reported from the pins before any pin is resolved, so no stale-pin finding follows.

Today's packs, run over each variant with its two designs composed into one model, find nothing else, apart from that composed plan-pack cycle.

## File shapes and interpretation

The examples use the following file shapes and interpretation rules.

1. seams.yaml lists `parts`, `claims`, `contracts`, `crossings`, `capabilities` (`provided_by` a list), `seams` (`exposure` keyed by the side whose own build reads it) and `names`. The catalog is its own file, manual-work.yaml, keyed `manual_work`.
2. A module seam sits in the design's own model.yaml under `seams:`, with `between: [core, <module>]` and `crossings: [{ id, carries }]`. Parts carry `module: <name>`. The organization's exception for it is keyed `<namespace>:<seam id>`.
3. Pins hold the full sha256 of the pinned edition.yaml.
4. An edition folder holds the frozen engine.yaml, model.yaml, plan.yaml and copies of seams.yaml and manual-work.yaml, with edition.yaml listing `files`, `digest`, `shared` and `manual_work` (rehash.ts writes it as `de release` would). The frozen engine.yaml keeps `root: ../../shared`, which resolves from the instance folder, not the edition folder.
5. `shared_from` in the root's engine.yaml holds `{ editions, sha256 }`, the sha256 of seams.yaml only.
6. Shipped floors use the authors' rule codes (`agent-input`, `signed-record`, `outsider-text`, `gate-feed`). A shipped floor is authoritative, an empty one included, and the engine adds nothing to it. The engine's signals give a provisional floor, labelled "engine signal: <which>", only to contracts and crossings the shipped file never held. The base fixture's Task ships the floor `agent-input`, as the shipped checks derive for what reaches the agent sandbox. Contracts also carry a `fields` list, and crossings a `point`, carried through.
7. Root patches use `kind: relationship` for a crossing, and `kind: capability`, `seam`, `contract`, `team` and `activity`. A raise is `modify contract` with `set: { security: { raised: { by, why } } }`. An agent's provenance names it: `agent: { name: org-scout, tool: Claude Code }`.
8. A tracker-sourced share keeps the person's figure in `stated`. `relieved_by.at` names a unit (`intake:U-09`) or a milestone (`inventory:M1`). A slowdown's `until` is a milestone; an exception's `until` is a milestone or a date.
9. A progress.yaml entry with only `flow_item` needs no date or `by`.
10. The tracker window ends at the export's date, 2026-11-01T00:00Z.
11. intake's and premerge's parts keep the design role they were written with as a plain key, `design_role`. The team map lists those roles beside the shared layer's.

## Regenerating

- `bun tests/fixtures/portfolio/make-jira-export.ts` writes `examples/shared/tracker/export/`, the same bytes each time. Then `bun plumb.ts tracker discover examples/shared --from examples/shared/tracker/export` writes `tracker/inventory.json`.
- After a change to the export or the mapping, remove `tracker/measures/2026-11-01.json` and run `bun plumb.ts tracker measure examples/shared --today 2026-11-02` to write it again. With the old file in place, a changed measure is kept beside it as `2026-11-01-2.json`, and the same measure writes nothing. A package leaves measures out, as it does report snapshots.
- `bun tests/fixtures/portfolio/rehash.ts`, after any edit to a seams.yaml or to premerge, rewrites the root hashes, refreezes premerge 1.0.0 and the variant's beta 1.0.0, and rewrites the pins. It never touches `variants/file-intact`.
