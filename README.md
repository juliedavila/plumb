# Plumb 0.6.3

Plumb tracks a complex system as designed against the system as built. Systems worth designing are usually built over years: part of the target already exists, part is in flight, and other long-horizon efforts run alongside it, some touching it and some not. Plumb keeps the [design](#terms), the plan, what stands today and the decisions between them in checked local files, so the distance between as-designed and as-built is a record you can query, part by part.

Plumb is for teams that keep a design for a complex system and track it against what they run. It is pre-1.0: file formats may change between minor versions. Use `plumb migrate` and the [changelog](CHANGELOG.md) when moving between them.

Documents: [Specification](SPEC.md), [Demo](DEMO.md), [Changelog](CHANGELOG.md), [Security](SECURITY.md), [Contributing](CONTRIBUTING.md), [License](LICENSE).

Plumb keeps what was discovered apart from what was confirmed. A crawler, a tracker export or an agent records what it found, with its source and date; a person confirms with their name and the time. Plumb never promotes one to the other. Every proposed change carries an impact report, and people decide what to accept.

A design can be your own or a released [edition](#terms) someone else publishes. `plumb design add` brings a released edition into a workspace after checking every file against its manifest and every [pin](#terms) against the design it names. Ratchet and Jig, published at [github.com/juliedavila/toolroom](https://github.com/juliedavila/toolroom), are example designs you can add this way.

Builds write one HTML page per design that opens from disk, a portfolio page across designs that share a root, or an Obsidian vault. Plumb is written in TypeScript for Bun and has no dependencies. All demo data is fictional.

## Start here

Requires Bun 1.3.14 or later (the version Plumb is tested on). Tested on macOS.

Install Bun using its [installation instructions](https://bun.sh/docs/installation) if needed. Run these commands from the folder holding `plumb.ts`.

1. Run `bun test`. Expected: all tests pass. If it fails, check `bun --version` and read the named failure before continuing.
2. Run `bun plumb.ts portfolio brief examples/portfolio --today 2026-11-16`. Expected: exit 0 and a status brief naming decisions that need a person. If it fails, check the working folder and the input path printed in the error.
3. Run `bun plumb.ts portfolio build examples/portfolio --today 2026-11-16`. Expected: exit 1 by design because the fictional portfolio has findings; it still writes the page at the path it prints, normally `build/portfolio-example/index.html`. If it exits 2 or writes no page, read the error and correct the named path or input.
4. Run `open build/portfolio-example/index.html`. Expected: the portfolio page opens in your browser on macOS. If it fails, open the printed HTML path from your browser's File menu.

`--today` makes the example repeatable. Omit it for today's state. A rendered page is not a clean check.

## Terms

- **Design:** a folder holding the model, plan and live files for one system design. CLI help calls this folder `<instance-dir>`.
- **Edition:** a released, frozen set of design inputs with a version and manifest.
- **Pin:** the exact version and SHA-256 of another design's edition manifest that a design depends on.
- **Stamp:** `edition.yaml`, the release metadata and hashed file list used to verify an edition. A build stamp is the build time in `engine.built`.
- **Presenting:** portfolio mode that selects released editions with current live state.
- **Premise:** a claim the design rests on, with evidence and consequences if it is false.
- **Seam:** a declared boundary between design modules or designs, with rules for what may cross it.
- **Crossing:** a connection across that boundary, declared in the shared layer for connections between designs.
- **BAU:** business as usual, the standing work that consumes team capacity alongside design work.
- **WIP:** work in progress; a WIP limit caps concurrent units of work.

## Build the delivery stream

Run `bun plumb.ts build examples/delivery-stream` and open `build/delivery-stream/index.html`. Expected: exit 0 with warnings for the intentional findings. Read a failure's named input before retrying. Design `build` and `check` accept `--today YYYY-MM-DD` for ages, status and dated organization checks, with a repeatable build stamp at noon UTC.

## Verify legacy output

An instance without schema, namespace, root or pins retains the 0.3 behavior. Historical golden tests permit only the engine version and build time to differ. Run `bun test tests/lone-golden.test.ts` to check this contract.

## Files and ownership

| Layer | Files and purpose |
|---|---|
| Shared root | `engine.yaml` declares `kind: root` and `schema: "0.4"`. `seams.yaml` holds namespace `shared`. `manual-work.yaml` holds its work vocabulary. `team-map.yaml` maps design roles to teams. |
| Optional organization | Root `org.yaml` holds namespace `org`: teams, leads, row owners, capacity, activities, slowdowns and seam exceptions. |
| Design | `engine.yaml` declares schema, namespace, root and exact edition pins. `model.yaml` holds parts, relationships, contracts, views and claims. `plan.yaml` holds phases and units. |
| Portfolio | `portfolio.yaml` selects a root and designs. Generated `portfolio.lock` records the resolved working and presenting builds. |
| Live state | A design's `progress.yaml`, `milestones.yaml`, `current.yaml`, notes, tracker files, reports, deck and tour survive reimports. |
| Decisions | Root or design `patches/*.yaml`. Proposed patches have no effect until accepted with `decision: { by, at, reason }`. |
| Released designs | `editions/<version>/edition.yaml` and frozen inputs. Building an edition uses today's live state. |


Place this `portfolio.yaml` at the Plumb workspace root. Paths are relative to that file; replace the namespaces with your installed designs.

```yaml
name: initiatives
title: Initiatives
root: instances/shared
designs:
  - { namespace: intake, from: instances/intake }
  - { namespace: premerge, from: instances/premerge }
horizon_months: 12
```

Portfolio fields are read from `portfolio.yaml`:

| Field | Type | Default | Effect |
|---|---|---|---|
| schema | string | absent | Records the portfolio schema label. |
| name | string | portfolio folder name | Names the portfolio and default output folder. |
| title | string | name | Labels the portfolio page and brief. |
| root | string | required | Shared root folder, relative to this file. |
| designs | list of mappings | required, nonempty | Selects the composed designs. |
| designs[].namespace | string | required | Names the design namespace. |
| designs[].from | string | required | Design folder, relative to this file. |
| presenting | string | released | Read as metadata. This field does not select a mode. [Presenting](#terms) mode selects newest released editions. |
| working | string | latest | Read as metadata. This field does not select a mode. Working mode uses live design files. |
| horizon_months | number | 12 | Positive values are rounded down for the roadmap month horizon. Zero or negative values use 12. |

Paths in engine.yaml are relative to its folder. Paths in portfolio.yaml are relative to the portfolio folder. A design imports only its root. Structural dependencies across designs pass through shared capabilities and [crossings](#terms). [Premise](#terms) dependencies use declared or reconciled links. A pin records the exact version and SHA-256 of another design's edition.yaml. It does not grant access to that design's records.

Use `namespace:id` outside the current design, or `namespace:kind/id` where a kind is needed. Bare ids resolve to the design, then shared, then org for team fields. Two homes are an error. Descriptive views, claim links and notes can name outside records. Composition resolves them together.

Without org.yaml each imported design keeps its own teams. With it, teams live once in org and designs name them. Reimport after adding the org layer so the generated files have one home for teams. Never edit a shipped shared file. A root patch changes shared or org records while retaining the original shared hash.

## Commands

| Command | Result |
|---|---|
| `bun plumb.ts build <design> [--out <dir>] [--edition <version>] [--today YYYY-MM-DD]` | Write bundle.json and index.html. Print the model hash for a patch's `provenance.based_on`. |
| `bun plumb.ts check <design> [--edition <version>] [--today YYYY-MM-DD]` | Print findings. Error findings exit 1. |
| `bun plumb.ts brief <design>` | Read-only status, changes since a report, questions, proposals and work that can start. |
| `bun plumb.ts plan <design>` | Ready work, blockers, milestone progress and critical path. |
| `bun plumb.ts premises <instance-or-root-or-portfolio> [--json]` | Read every premise and reconciliation link in scope. |
| `bun plumb.ts premise <design> [claim]` | Claims ranked by exposure, or what depends on one claim if it is false. |
| `bun plumb.ts impact <design> <patch>` | Verdict, reasons, changed records and introduced or resolved findings. |
| `bun plumb.ts diff <design> --from <bundle.json> [--to <bundle.json>] [--save]` | Compare generated builds. Save a comparison when requested. |
| `bun plumb.ts report <design> [--presented]` | Save a snapshot. Mark presented only after the user says it was shown. |
| `bun plumb.ts build <root> [--out <dir>]` | Write root.json with org state, estimate history, marks, proposals and findings. |
| `bun plumb.ts check <root>` | Check the shared root itself. |
| `bun plumb.ts portfolio brief <portfolio>` | Read-only portfolio status and decisions needing a person. |
| `bun plumb.ts portfolio build <portfolio> [--out <dir>] [--presenting] [--today YYYY-MM-DD]` | Write the portfolio page, data, design pages and lock. |
| `bun plumb.ts portfolio check <portfolio>` | Check references, seams, composed security, dependencies and capacity. |
| `bun plumb.ts portfolio impact <portfolio> <root-patch>` | Evaluate a root proposal across all composed designs. |
| `bun plumb.ts migrate <design> [--to 0.4] [--root <dir>] [--moved <file>] [--dry-run]` | Review and apply schema or moved-id migrations. |
| `bun plumb.ts release <design> --label <version>` | Freeze a local design. Refuse an existing label. |
| `bun plumb.ts dev <design-or-portfolio> [--port 4317] [--out <dir>]` | Serve locally with live rebuilds. An external target needs an output directory. |
| `bun plumb.ts vault <instance or portfolio> --out <dir> [--packaging] [--today YYYY-MM-DD]` | Write an Obsidian vault and sync human annotations as proposal notes. |
| `bun plumb.ts publish <out-dir> <design-or-portfolio>...` | Write a static folder. It does not deploy it. |

Build output defaults to the invoking directory’s `build/<name>/` for designs and shared roots, `build/<name>-<version>/` for editions, and `build/portfolio-<name>/` (with `-presenting` in presenting mode) for portfolios. Pass `--out <dir>` to any build command to choose its output folder. Portfolio builds also write `portfolio.lock` beside `portfolio.yaml`.

Working portfolios use latest design files. `--presenting` selects newest released editions with today's progress, milestones, current state and tracker data. Only accepted patches frozen with an edition change its released design. Presenting is not a snapshot of old status.

Compare generated bundle JSON or this instance at a git ref with `plumb diff`.

## Estimates, workload and risk

Capacity is a [WIP](#terms) limit in concurrent units. Each org number records `value`, `source`, `by`, `as_of` and `confidence`. Sources are person, agent, tracker and derived. Confidence is low, medium or high. Activity shares are fractions from zero to one. Accepted patches supply history. Measured values keep a person's stated figure beside them.

Activities consume part of a team's capacity. Units in progress across designs consume the rest. Relief names a unit or milestone and may retire or reduce an activity. The allowance is a premise until its condition is reached. Unit work types ship as defaults and can be overridden in progress.yaml with `flow_item: feature`, defect, risk or debt.

Slowdowns record a temporary lower share, what will wait, the risk, acceptors, start and end. Exceptions record a [seam](#terms), contracts, acceptor, end and why. An organization's exception list replaces that seam's shipped default. An empty list declines it. Exceptions relax only the seam rule. Composed security findings keep their severity. Security marks have a floor from the shipped checks that patches cannot lower. Raise relevance with `security.raised: { by, why }`.

Use `skill/plumb/workflows/org-decisions.md` for proposals. Root changes are reviewed with portfolio impact. Accepting a risk and accepting a patch are separate decisions.

## Reconcile premises across designs

Run `bun plumb.ts premises examples/portfolio --json` to read every premise beside its falsifier, load, settling units, hash and reconciliation links. Text output groups premises by design. The command writes nothing and also accepts a design or shared root. A root alone shows its shared register.

Keep `premise-links.yaml` in the shared root beside `team-map.yaml`. The skill workflow `skill/plumb/workflows/reconcile-premises.md` compares pairs and proposes found links with quoted evidence. A person confirms one link at a time with clauses picked from the premises and their current hashes. Changed text makes that confirmation stale. The engine never confirms a discovery.

Design premises can declare cross-design dependencies in `rests_on.claims`, for example `claims: [inventory:IV-1]`. Plumb loads these as depends-on links with status `declared`, never writes them to premise-links.yaml, and includes them in the impact walk alongside current confirmed links. A lone build marks absent-design targets external. A found link duplicating a declaration produces a warning naming both. Current confirmed dependencies extend the existing impact walk. Found and stale dependencies appear under “Would cascade if confirmed”. Contradictions and duplicates stay review flags. Strategy shows links and reconciliation debt. The portfolio shows debt counts. A settling unit can use `namespace:unit-id` to name work in another design. Its status counts when that design is composed.

## Current state

A design's current.yaml records baseline and disposition for its own parts. Discoveries carry `found: { by, from, as_of, confidence }`. A person confirms with `confirmed: { by, at }`. Confirmation needs that person's word. A missing disposition stays undecided. It is a warning while discovered and an error once confirmed. The engine never infers it.

Today-only parts use `add`. Replace and retire decisions need retirement work, expressed by a unit moving the part to `retired`. A replacement can be shared. Shared parts' own current state has no home in 0.4.

## Tracker files

The engine reads exported files and never calls a tracker service. Discover first, review the mapping, then reconcile a design's units or measure a root's standing work.

```sh
bun plumb.ts tracker discover examples/shared --from examples/shared/tracker/export
bun plumb.ts tracker draft-mapping examples/shared
bun plumb.ts tracker measure examples/shared --today 2026-11-02 --draft-patch --agent bau-assistant --requested-by "the program lead"
```

An existing mapping is kept and the draft goes to mapping.draft.yaml. One [BAU](#terms) measurement refresh produces one proposed patch for the whole refresh, or identifies an identical existing proposal. The fixture already has P-005 waiting. The command above reuses the shipped `tracker/measures/2026-11-01.json`: the export sets the window end, and `--today` sets when it was measured. It writes nothing new on a clean copy. It shows measured gaps before acceptance. Issue history gives time in doing. Without history the engine uses a lower confidence issue-count fallback.

For one design, use `tracker discover`, `tracker draft-mapping`, `tracker reconcile` and, when requested, `tracker export`. Confirm matches in links.yaml only on the user's word. A tracker disagreement never overwrites plan status.

Discover reports whether the inventory was created, changed or unchanged and lists the differences. Draft a mapping on first use or when mapping vocabulary changes. Counts and export-source changes alone do not require a new draft when the existing mapping is valid.

## The page and decisions

Overview leads with status and needs attention. Model shows zones, curated views, relationships and current state. Plan shows milestones, ready work, blockers and paths to green. Strategy shows the premises and what would be at stake if false. Changes shows patch verdicts. Checks, Teams, Tracker and Notes hold the working details. The portfolio joins next milestones, load, estimates, slowdowns and seams across designs.

The portfolio roadmap places dated milestones on the month grid. Undated milestones form a strip of phase tiles in plan order, with status and open work. A design with both has its dated row followed by its undated phases. The strip wraps on narrow screens.

Hover a reference for a card. Click for a drawer. Follow links across kinds. Filters carry across pages. Focus selects a team or lead. Tour teaches the interface. Present opens a design's deck. Keyboard help is `?`. Names lead on decision surfaces. Ids and rule details stay available in cards and speaker notes.

Design patches use add, modify and remove ops. `set` replaces named fields and merges `attrs` one level. Removing a part cascades to its relationships and references. Impact separates resolved findings from findings that vanished with a removed subject. A verdict is fail for new errors, caution for review conditions, or pass. Notes and decisions quote their sources. The skill explains the file shapes and review steps.

Progress and milestone overrides carry who, when and why. A missing reason on a milestone override is rejected. `deck.yaml` decisions come only from the user's words. Reports compare with the last presented snapshot, else the last saved one. Notes are local files. Under the dev server, guarded local endpoints can write notes and mark reports presented. Offline pages remain read only.

<!-- mcp:start -->
The optional MCP server reads one design bundle. From this root, add it once:

```sh
claude mcp add plumb -- bun "$PWD/src/mcp/server.ts" "$PWD/build/delivery-stream/bundle.json"
```

Tools include overview, find, element, unit, what_can_start, most_unblocking, critical_path, findings, impact, path, tracker, premise, notes and flow. They are read only. A rebuilt bundle is reloaded before the next answer. Portfolio and org work uses the CLI and files through the skill.
<!-- mcp:end -->

## Package Plumb for another machine

Package a new or empty directory outside the source tree:

```sh
bun plumb.ts package <out-dir>
```

The package contains Plumb, its packs, templates, skill, docs, tests and fictional examples. Inside a Git work tree, only tracked files are eligible; outside one, the same file and directory exclusions apply to all working files. No workspace designs are bundled. Add released designs with the edition interface described below. MANIFEST records every shipped file hash and size. Home paths, real email addresses and external scrub-list patterns block packaging. The optional MCP server ships with `--with-mcp`.

On the destination machine run `bun test`, build the fictional examples, then add your designs and write a team map in their shared root. Copy `skill/plumb` into your agent's skills folder or ask it to read that skill directly.

## Add a released design

`bun link` is optional. Without linking, run `bun <path-to-plumb>/plumb.ts` from any workspace. Paths in command arguments are relative to where you run the command. Plumb source may live anywhere outside `upstream/` and `org/`. From an adopter workspace, run `bun <path-to-plumb>/plumb.ts build plumb/instances/intake`. When using the adopter skills, the Plumb workspace is `<adopter workspace>/plumb`, beside `upstream/` and `org/`.

```sh
bun plumb.ts design add premerge@1.0.0 --from tests/fixtures/editions --workspace ./workspace --with-pins
```

For your own source, replace the placeholders below with a repository the person names or a local clone path:

```sh
bun plumb.ts design add intake@1.0.0 --from github:<owner>/<repo> --workspace ./workspace
bun plumb.ts design add intake@1.0.0 --from "<path to a clone>" --workspace ./workspace
```

A local clone root works as `--from`: Plumb finds `editions/<namespace>/<version>/edition.yaml` beneath it. A direct edition folder also works. Pins may live in `<from>/pins/<namespace>/edition.yaml` or `<from>/pins/<namespace>/<version>/edition.yaml`.

An edition must ship `edition.yaml` with `plumb.interface: 1` and hashed engine-format inputs. Plumb verifies every listed file, the manifest digest, shared seams and manual-work bytes, and exact pins before writing. Missing pins print a usable command when a matching nearby folder exists, otherwise explain which folder must hold the edition; `--with-pins` verifies and adds dependencies first. Each added edition has its own frozen copy under `instances/<namespace>/editions/<version>/`. This is expected. The adopter's `upstream/` remains its read-only copy. Frozen published files stay byte-identical. With `--with-pins`, re-adding also regenerates every installed transitive pin against the current team map. Re-adding an identical [stamp](#terms) re-derives its live files and frozen adapters while retaining progress, notes, current state, tracker, reports, patches, deck and tour.

A role string naming several parties maps to every team it names. Map the exact role string to all applicable team ids, for example:

```yaml
teams:
  - { id: platform, name: Platform team }
  - { id: security, name: Security team }
owners:
  "Platform team + Security team": { teams: [platform, security] }
```

Roles resolve through `instances/shared/team-map.yaml`. Optional `org.yaml` holds the teams once. Unresolved owners retain their role text; Plumb writes a sorted `team-map.draft.yaml` for you to complete. It never replaces the written team map. An owner row with `teams: []` is accepted as an unresolved placeholder. Keep rows you cannot map yet and fill them from supplied evidence. A first build with an unfinished map reports one error per unmapped owner role reference, so one role used by several records can produce several errors. The brief names the error class and count when all errors share a class. GitHub editions default to the tag `<namespace>-v<version>` and path `editions/<namespace>/<version>`; `--ref` and `--path` override their location. Files are limited to 32 MB and each edition to 256 MB; redirects cannot leave the source host. The hashes prove that every file matches the edition's own manifest. No signature stands behind that manifest, so an edition is as trustworthy as the repository and tag it comes from.

## Configuration

`PLUMB_SCRUB_LIST` selects the external scrub list. The default is `~/.config/plumb/scrub.txt`. The former `DE_SCRUB_LIST` setting and `~/.config/design-engine/scrub.txt` path remain fallbacks and print a deprecation note when used. The legacy path notice prints at most once per process. Plumb optionally reads one of two default home files: `~/.config/plumb/scrub.txt` when it exists, otherwise `~/.config/design-engine/scrub.txt` when it exists. It does not read other home files. An explicit `PLUMB_SCRUB_LIST` or fallback `DE_SCRUB_LIST` can select another path, including a home path. Existence checks precede reads. `PLUMB_GITHUB_RAW` overrides the GitHub raw base URL (`DE_GITHUB_RAW` is the deprecated fallback).

Scrub lists contain case-insensitive regexes, optionally followed by ` => replacement`. `section: <regex>` declares Markdown heading text under which entries marked `allow-in-section:` may appear. The older `landscape:` entry marker is also read. Without a section declaration, a marked entry is allowed nowhere. Vault packaging applies every pattern everywhere.

Home scrub files are optional; a fresh machine prints no home-path deprecation notice.

## Open a design in Obsidian

```sh
bun plumb.ts vault examples/portfolio --out build/vault-example --packaging
bun plumb.ts vault examples/delivery-stream --out build/vault-delivery-stream
```

In Obsidian, choose Open folder as vault and select the output folder. Open the portfolio or design index note. Notes use readable record names, such as `Scanner feeds.md`. Only colliding names gain a short identity suffix, such as `Scanner feeds (a1b2c3d4).md`. Every generated link includes the record name as display text: `[[Scanner feeds|Scanner feeds]]`. Frontmatter aliases contain the record name and qualified id, so search and link suggestions find either. Names retain spaces and Unicode; characters reserved for paths or wikilinks are replaced with spaces. Case and Unicode normalization collisions are distinguished too.

Parts, relationships, contracts, units, milestones, teams and findings have typed YAML properties. Graph, backlinks, search and Bases can use those files without plugins. Filter by `id`, `kind`, `design`, `status`, `state`, `owner_team` or a unit's `phase`. Scalar record properties keep their types. Discovery uses flat `found_by`, `found_agent`, `found_from`, `found_as_of` and `found_confidence` properties; confirmation uses `confirmed_by` and `confirmed_at`. Missing provenance is null. Attributes and structured record details appear as readable lists under Record details, with descriptions and checks in the body. Frontmatter contains no raw `attrs` or `record` blobs.

This vault is generated output. The checked engine files remain the source of truth. Current-state properties distinguish `discovered`, `confirmed` and `unrecorded`. Discovery and confirmation provenance stay separate. Discovered-only parts carry a visible warning in their body.

Write annotations only between `<!-- plumb:human:start -->` and `<!-- plumb:human:end -->` under Human notes. Run the same command again to preserve the text and import each non-empty revision as an open proposal note in the appropriate `notes.yaml`. Identical revisions import once. Existing engine notes and answers appear under Engine notes. Review these through the existing note workflow. A proposal note never edits a model, current-state record, progress entry or patch decision. Emptying the human region does not delete an imported note.

The manifest `.plumb-vault.json` checks generated text independently of the human region and maps filenames to record identities. When a name changes, regeneration moves the verified note and carries its human region by identity. This also upgrades vaults with the original id-based filenames and handles names gaining or losing a collision suffix. All generated links are refreshed. An edit outside that region, a missing note, an unmanaged file or a record removed from the generated set stops regeneration and reports the affected filename. The existing vault is retained. Preserve any annotations before restoring generated text or building a fresh folder. Obsidian's `.obsidian` settings are left alone. Source changes can remove findings, so a fresh output folder may be needed after those changes. Nothing is deleted automatically; moves use a temporary sibling folder to handle name swaps safely.

The same inputs and options produce the same bytes. Vault builds omit the wall clock. Pass `--today YYYY-MM-DD` to include date-relative checks and status against a reproducible date. Without it, time-relative checks have no current date. New proposal notes record their actual import time in the source notes file. Once imported, that source state is part of the next deterministic build.

Use `--packaging` before sharing a generated vault. It reuses the package leak check and scans all generated content, including preserved human text and the manifest. Scrub-list names, home paths and every email address block output. The command reports filenames, line numbers and match categories without quoting matches. It says when no scrub list was found. Existing `.obsidian` application settings are scanned too and are preserved without changes. Share a fresh generated folder rather than an existing Obsidian settings directory. A leak found before writing also prevents annotation import. As with site builds, error findings exit 1 after writing the vault.
