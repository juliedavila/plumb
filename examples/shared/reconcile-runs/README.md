# Reconciliation evidence

RUN-001 is recorded in runs: of ../premise-links.yaml. Its saved premises projection is RUN-001-premises.json. Its mechanically generated skipped-pair list is RUN-001-skipped.md. Keep each later run beside these files.

The saved premises file was regenerated at release and includes later confirmations. It records the release state rather than only the state seen during RUN-001.

Regenerate the example portfolio lock with `bun plumb.ts portfolio build examples/portfolio --today 2026-11-16`. Keep this fictional build date fixed when refreshing release artifacts. The lone-instance golden test excludes engine version and build time and does not regenerate this lock.
