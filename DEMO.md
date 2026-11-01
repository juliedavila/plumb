# Plumb 0.6.3 demo

Requires Bun 1.3.14 or later (the version Plumb is tested on). Tested on macOS.

All data in this demo is fictional. Run from the Plumb folder with Bun.

```sh
bun test
bun plumb.ts portfolio brief examples/portfolio --today 2026-11-16
bun plumb.ts portfolio build examples/portfolio --today 2026-11-16
```

Open `build/portfolio-example/index.html`. Three designs share an organization: findings intake, pre-merge checks and asset inventory cleanup. The deliberate findings remain visible: missing retirement work, an undeclared crossing and a team over capacity. The build writes its page and exits 1 because it has errors.

Read the next milestones, team load and slowdown assumptions. Open a design page and follow a part through relationships, work, premises and checks. The proposed tracker refresh stays a proposal until a person decides it. Review its impact:

```sh
bun plumb.ts portfolio impact examples/portfolio P-005 --today 2026-11-16
bun plumb.ts portfolio build examples/portfolio --presenting --today 2026-11-16
```

Presenting selects released editions while reading today's live status. The example retains its intentional findings in either mode.

The smaller delivery stream demonstrates a lone design:

```sh
bun plumb.ts build examples/delivery-stream
bun plumb.ts brief examples/delivery-stream
bun plumb.ts impact examples/delivery-stream P-001
```

Open `build/delivery-stream/index.html`. Follow handoffs, compare proposed changes, open a team or lead in Focus, and use Learn the interface or the authored tour. The deck and status panels share computed facts. Mark a report presented only after the person says it was shown.

Add a fictional released pair to a separate workspace:

```sh
bun plumb.ts design add premerge@1.0.0 --from tests/fixtures/editions --workspace build/repair-workspace --with-pins
```

The intake dependency is verified and added first. Inspect the byte-identical release folders, shared provenance and sorted draft team map. Unresolved roles remain as written. Declare teams and role mappings in the workspace's `instances/shared/team-map.yaml`, then run the same addition again to apply them. Existing live files survive.

```sh
bun plumb.ts vault examples/portfolio --out build/vault-example --packaging --today 2026-11-16
```

Open that folder as an Obsidian vault. Write an annotation between `<!-- plumb:human:start -->` and `<!-- plumb:human:end -->`, then regenerate. Each new non-empty revision becomes an open proposal note. Human text stays in the vault; generated-text conflicts stop regeneration for review.

```sh
bun plumb.ts package <out-dir>
```

Use a new or empty output directory outside the source tree. Review the leak verdict and MANIFEST. The package contains fictional examples and tests. Add your released designs on the destination with `plumb design add`.
