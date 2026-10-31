# Reconcile premises across designs

Scope: compare premises across the requested designs and their shared premise register. Write `premise-links.yaml` in the shared root beside `team-map.yaml`, and run evidence in `reconcile-runs/` beside that links file.
Inputs: the requested instance, root or portfolio, `plumb premises <scope> --json`, the existing links file and the person's words for any confirmation.
Done: every considered or skipped pair is accounted for in one run record, proposals and review flags are shown, and a rebuild reports confirmed impact and the would-cascade preview separately. An unconfirmed proposal can remain found at completion.

These instructions apply to Opus 5.5 and Sonnet 5 alike. Use the commands and evidence below regardless of agent harness defaults. Run `bun plumb.ts` from the product folder, or `plumb` when linked. Use Bun only. Do not install dependencies or call the network.

Run `plumb premises <scope> --json`. Save the output as evidence for this run. Read the existing links file first. Resolve the shared root from the portfolio's `root`, or the design's engine file. Root scope includes its shared register and any designs explicitly composed by the caller. Use a portfolio to compare multiple designs. Never search sibling folders for additional designs. Never write links inside `seams.yaml` or an edition.

Compare every unordered pair whose premises have different design namespaces, including shared premises against design premises. If the requested scope has only one design, report that limit. Either consider every pair or record exactly how pairs were chosen. Count considered and skipped pairs. For each skipped pair, present a finding naming both premises, the reason and a command or file source. Save those findings in an evidence file named from this run's id, for example `reconcile-runs/RUN-003-skipped.md` beside the links file. The run's `rule` states how pairs were chosen and names that file. A skipped pair is never a silent default. Do not call a sample complete coverage.

Propose `depends-on` only when falsifying the `to` premise would move a specific clause of the `from` premise's load or if_it_flips/fallback. Quote that falsifier and name the moved clause in `found.reasoning`. Use exact text from the projection. Offer quoted candidate clauses for the person to pick. Do not manufacture a missing falsifier or load. Report missing text as a finding with its file source.

Propose `contradicts` and `duplicates` only as review flags. They never cascade, merge premises or change impact when confirmed. Explain the possible conflict or overlap, quoting the premises and naming the sources. Keep it a proposal for review.

Choose an unused `PL-<digits>` id and preserve existing records. Write each proposal with `from`, `to`, `type`, and `found: { by: "agent:premise-reconciler", at: <run date>, reasoning: <quoted evidence>, sources: [<command or file>] }`. Do not add `confirmed` at proposal time. An agent discovery stays separate from a person's confirmation.

Write one run record for each run, including a run with no proposals. Use an unused id and include `by`, `at`, `designs`, `pairs_considered`, `pairs_skipped`, `rule` and `proposed`. Counts are integers at least zero. `rule` describes the exact selection and names the run's skipped-pair evidence file when any pairs were skipped. `proposed` lists the new link ids, or an empty list. Preserve earlier runs.

Rebuild the scope. Present proposals grouped by the work and premises they would cascade to. Run `plumb premises <scope> --json` and read each premise's `preview` for the extra reach through found steps, keeping the tags on each path visible. For a single premise, run `plumb premise <design> <claim-id>` and read “Would cascade if confirmed”. Show review flags separately. Do not claim that a preview is confirmed impact.

Write `confirmed` only on a person's explicit word for that one link. Never bulk-confirm. Get the person's name or role and confirmation date. “Today” means the current date. The person must pick a `falsifier_clause` quoted from the `to` premise's own falsifier and a `moved_clause` quoted from the `from` premise's own load or if_it_flips/fallback. Offer candidate substrings from the text. Do not silently choose clauses on their behalf. Preserve `found`.

Run `plumb premises <scope> --json` again immediately before writing confirmation. If the premise text has changed, present it again for that link. Copy the current 12 hex hashes into `confirmed.pins.from` and `.to` as quoted strings, for example `"0123abcd4567"`. Quote all-digit hashes too, so YAML cannot parse them as numbers. Record `confirmed: { by, at, falsifier_clause, moved_clause, pins: { from: "0123abcd4567", to: "012345678901" } }` with the actual current hashes. An agent cannot confirm. A stale confirmation stays stale until a person reviews that individual link again. Never refresh pins automatically.

Run `plumb build <instance-or-root>` or `plumb portfolio build <portfolio>` and then `plumb premises <scope> --json`. Report findings, confirmed impact and the additional would-cascade preview. Explain which side changed for any stale link. The engine reads this evidence and never writes or promotes it.
