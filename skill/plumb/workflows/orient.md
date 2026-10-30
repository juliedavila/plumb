# Orient

Read current state and report what needs a person. Choose the portfolio the user named. Ask which target only if the context leaves more than one plausible target.

## Portfolio

1. Read `<portfolio>/portfolio.yaml` for the root and designs.
2. Run `bun plumb.ts portfolio brief <portfolio>`. It is read only. The engine judges against the machine's date. When the user works as of another date (a report day, or a dated exercise), pass `--today <YYYY-MM-DD>` to every portfolio command (brief, build, impact, check) and to a design build. Allowances, running slowdowns and patch verdicts change with it. Root `build` and `check` take no `--today`, so their staleness ages use the machine date. Use `--presenting` only when requested. Presenting uses released design files with today's live state. Working uses the working copies.
3. Run `bun plumb.ts portfolio build <portfolio>`. It writes the page, each design's page, `portfolio.json` and `portfolio.lock`, even with error findings. Exit 1 means checks failed. Report it.
4. Read the output paths it prints. Open the portfolio's `index.html`. Default output is `build/portfolio-<name>/`, with `-presenting` for presenting mode. Read `name` from portfolio.yaml.

Report the brief's opening sentence, each design's next milestone (from `portfolio.json`, under `page.roadmap`) and its blocker. No field holds the blocker: work it out from the build's findings and the roadmap row's waits. A blocker is a team over its allowance on the milestone's path, a wait on another design, or an error in the design's own build. Say none when nothing holds it back), proposed root patches, estimate gaps, slowdowns, exceptions and the team most contended. Keep discovered current state distinct from confirmed state. Use the output's counts. The example deliberately has findings. Do not call it clean because it rendered.

The brief's root build hash identifies root inputs, patch records and notes. It is not the model hash for a patch's `provenance.based_on`. For a root proposal, follow `org-decisions.md` and take the model hash from `bun plumb.ts build <root>`.

## One design

1. `bun plumb.ts brief <inst>` builds in memory and writes nothing.
2. If `build/<name>/bundle.json` exists, run `bun plumb.ts diff <inst> --from build/<name>/bundle.json` before rebuilding. If it does not, say there is no earlier build. The brief compares with the last presented report, else the last saved report. If neither exists, say there is no report baseline.
3. `bun plumb.ts build <inst>`. Report any error and the output path.

Reply with the current status first, then changes since a named baseline, the items needing a person with ids, and up to three units that can start. Finish with the generated page path. Done when the commands ran and every reported count has a source.
