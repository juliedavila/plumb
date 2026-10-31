---
name: plumb
description: "Plumb tracks a complex system as designed against as built. Work a Plumb 0.6 portfolio or instance from local files. Orient, reconcile premises across designs, propose estimates and slowdowns, declare seam exceptions, confirm current state on a person's word, refresh BAU from tracker exports, review patches, record status and prepare a deck. Open generated designs in Obsidian and write vault annotations. Use in a folder holding plumb.ts. Do not change engine code or published edition files."
---

# Plumb 0.6.0

Run `bun plumb.ts` from the product folder, or `plumb` from the workspace when linked. Use paths to designs, roots and portfolios. Read the workflow for the requested task before writing.

## Locations

| Target | Path in this bundle |
|---|---|
| Fictional example portfolio | `examples/portfolio` |
| Example shared root | `examples/shared` |
| Example designs | `examples/designs/intake`, `examples/designs/premerge`, `examples/designs/inventory` |
| Lone example | `examples/delivery-stream` |

Read `portfolio.yaml` for its `root` and `designs[].from`. Those paths are relative to the portfolio folder. A design's `engine.yaml` `root` is relative to the design. The root declares `kind: root` and holds namespaces `shared` and optionally `org`. Designs import only the root. Own ids may be bare. Outside ids use `namespace:id`.

A standalone package has no installed designs. Add released editions with `plumb design add`. Roles resolve through a workspace team map, and teams live in its optional org.yaml. Re-add identical stamps after changing the team map. The fictional examples are a separate teaching scenario.

## Tasks

| Request | Read |
|---|---|
| What changed, where it stands, what needs a person | `workflows/orient.md` |
| Estimate update, slowdown or seam exception | `workflows/org-decisions.md` |
| Reconcile premises across designs | `workflows/reconcile-premises.md` |
| Discover or confirm current state | `workflows/current-state.md` |
| Refresh BAU shares from exported tracker files | `workflows/refresh-bau.md` |
| Open the design in Obsidian or write a note in the vault | `workflows/obsidian.md` |
| Answer a note | `workflows/answer-a-note.md` |
| Propose a design change | `workflows/draft-a-patch.md` |
| Review or decide a patch | `workflows/review-a-patch.md` |
| Unit status, work type or milestone override | `workflows/record-status.md` |
| Reconcile a design's units with tracker issues | `workflows/jira.md` |
| Prepare or mark a deck presented | `workflows/deck.md` |
| Add or upgrade a released design | `workflows/new-edition.md` |

## Writing rules

Write only the requested design's live files, or its root's proposed `patches/P-<NNN>-<slug>.yaml`. Choose an unused id by reading existing patches in that folder. Proposed patches change nothing until accepted. Never edit `org.yaml` or `seams.yaml` for a routine change. Never edit published editions, engine code, packs or tests.

You may edit a requested note, a progress entry, milestone words or override, and the deck's decisions from the user's words. You may write `current.yaml` discoveries with `found`. For premise reconciliation, write the shared root's `premise-links.yaml` and run evidence in `reconcile-runs/` through `workflows/reconcile-premises.md`. Add `confirmed` only on a person's explicit word. Confirmations and risk acceptances may use the supplied local person's name or role. Shipped examples use fictional roles. Never invent a person, acceptance, date or reason.

When a proposal has no supplied title or patch `why`, write a short title naming the requested change and a neutral `why` that restates the supplied facts. This is agent wording, not a quotation or an attributed motive. Do not invent a benefit, meeting, tradeoff or risk acceptance. For example, use “Set AppSec platform capacity to 7” and “The requested WIP limit is 7 concurrent units.” A required decision reason or exception rationale still needs the person's words.

Accept or reject a patch only when the user has decided it in this conversation. Record `decision: { by, at, reason }`. Existing authorization applies. Root decisions use portfolio impact, not `plumb impact <root>`. Build and tracker commands may write generated files. Use Bun and TypeScript only. Do not install dependencies or call the network. Raw tracker data arrives as exported files.

Every number and verdict comes from a command or a named file. Label estimates and discovered records. Say when a baseline is absent. Report failures as failures. An exception changes only the seam rule. Composed security findings retain their severity. Plain sentences lead with the result. No em dashes or semicolon chains.

## Install

Copy `skill/plumb` into `.claude/skills/` from the bundle root, then start Claude Code there. Where automatic skills are off, ask the agent to read this file and its requested workflow.
