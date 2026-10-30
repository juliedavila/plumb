# Refresh standing work from tracker files

Use the shared root, not a design. Read the requested portfolio.yaml for the root. A design's tracker reconciliation does a different job and stays in `workflows/jira.md`.

1. Read `<root>/engine.yaml` and `<root>/tracker/mapping.yaml`. An org mapping declares `kind: org` and maps tracker teams and activity buckets. Read its window (`window_days`, in days; measures count days in doing). Preserve the person's mapping choices.
2. `bun plumb.ts tracker discover <root> --from <export-folder>` records the inventory and prints whether it was created, changed or unchanged, with the differences from the previous inventory. The folder path is relative to the current command directory. For the shipped fixture use `examples/shared/tracker/export` from the bundle root.
3. Run `bun plumb.ts tracker draft-mapping <root>` if there is no mapping or discover reports changed mapping vocabulary. Counts and export-source changes alone do not require a new draft. An unchanged inventory with a valid mapping can go straight to measurement. Drafting writes `mapping.draft.yaml` when mapping.yaml exists. Compare it and report choices for the user to settle. Do not replace a valid existing mapping merely because a draft differs.
4. Measure and draft one proposed refresh:

```sh
bun plumb.ts tracker measure examples/shared --from examples/shared/tracker/export --as-of 2026-11-01 --today 2026-11-16 --portfolio examples/portfolio/portfolio.yaml --draft-patch --agent bau-assistant --requested-by "the program lead"
```

Use the user's paths and dates for other exports. `--as-of` is the end of the measurement window. Without it the engine uses the export date, else the newest issue update. `--today` is when measured. The dates above reproduce the fictional fixture, not today's actual work. The engine writes `tracker/measures/<as-of>.json` and one proposed patch containing all measured changes. If the same refresh is already proposed, it names that patch and writes no duplicate. "Nothing to propose" means the measured values are already in force. Do not accept a pre-existing refresh as a shortcut.

5. Run `bun plumb.ts portfolio impact <portfolio> <printed-patch-id>` when a patch is proposed, then `bun plumb.ts portfolio brief <portfolio>`. Report the actual id and file. Do not assume P-006, since earlier work may have used it.

Report window, day unit, time covered and unclassified, the measured shares against stated figures, confidence and provenance. The fixture export includes deliberately future fictional dates. An export without history uses a lower confidence issue-count fallback. No throughput is invented for an empty slice. The page shows measured gaps while the proposal waits. Optional `--limits` proposes WIP limits in the same refresh only when requested. Existing manually set limits are kept.

Done when discovery and measurement ran on the supplied files, the single refresh or existing proposal is identified, and its impact and gaps are reported. Accept or reject it whole only on the user's decision, with who, date and reason. Never call a tracker service or change a design's status to match it.
