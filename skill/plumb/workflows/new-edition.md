# Add a verified released design

Read the requested namespace, exact version, edition source and workspace. Preserve current bundle JSON as a comparison baseline before upgrading a working design.

```sh
plumb design add <namespace>@<version> --from <source> --workspace <workspace>
```

A folder may hold edition.yaml directly, `<namespace>/<version>/edition.yaml`, or `editions/<namespace>/<version>/edition.yaml`. A repository source uses `github:<owner>/<repo>`. GitHub defaults to `<namespace>-v<version>` and `editions/<namespace>/<version>`; `--ref` and `--path` locate other releases. The edition must provide Plumb interface 1. Never edit published inputs, manifests, shared seams or manual-work bytes to make verification pass.

Plumb verifies manifests, hashes, shared-layer agreement and exact pins before workspace writes. Missing pins print an exact command. Use `--with-pins` when the requested addition includes its dependencies; dependencies come from the same source and cycles are refused. Installation writes `instances/<namespace>/` and records provenance in `instances/shared/engine.yaml`.

Read the summary's role counts. Complete unresolved entries from `instances/shared/team-map.draft.yaml` in the hand-written `team-map.yaml`, using the organization's supplied teams. With org.yaml, teams live there; otherwise declare teams in the map. Re-add the identical stamp to regenerate live files and frozen adapters. Plumb retains progress, current state, milestones, notes, tracker, reports, deck, tour and patches. A different stamp under the same version is refused.

Build each added design with `plumb build instances/<namespace>`. If a portfolio selects it, build that portfolio in working and presenting modes. Compare old and new bundle JSON with `plumb diff <design> --from <old.json> --to <new.json> --save` when requested. For a moved-id map, review `plumb migrate <design> --moved <map> --dry-run` before applying the authorized migration.

Done when verified additions build and compose as requested, unresolved roles and remaining findings are reported, and existing live state is preserved. Do not invent progress, confirmations or acceptance decisions.
