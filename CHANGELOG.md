# Changelog

## 0.6.3 (2026-11-01)

Git-ref comparisons work for designs in repository subfolders. Commands reject unknown options with command usage. Design builds and checks honor an explicit date for repeatable results. Packages made from a Git work tree include only tracked eligible files, including public policy documents once tracked. Fixture generation checks determinism and parsed content independently of YAML formatting. Getting started instructions state the tested runtime, explain terms and expected results, and reproduce the shipped tracker measurement. Help and workflows describe the supported commands and paths.

## 0.6.2 (2026-10-31)

Re-adding a design with pins regenerates installed dependencies against the current team map. Premise JSON includes qualified structural parts and relationships. Scrub notices identify the deprecated file and explain how to silence them. Documentation supplies adopter portfolio and composite role examples, source placement and build output options. Fictional evidence and release metadata are clarified.

## 0.6.1 (2026-10-31)

Local adoption finds pins inside direct edition folders and prints commands that work without linking. Passing tests capture expected fixture diagnostics. Legacy scrub notices print once per process. YAML errors name their file and position. Team drafts explain unresolved placeholders and briefs identify a shared error class. Pins with unchanged named records stay out of the stale list. Design-declared premise dependencies load as declared links and cascade without reconciliation confirmation. The adopter documentation explains workspace layout, frozen copies, portfolio fields, source confidence and structural reconciliation screening.

## 0.6.0 (2026-10-30)

A design's own unresolved tested_by unit is now an error.
The content hash of a rooted design now covers each composed design's model and plan, so every rooted design's content hash changes once.

Premises can be settled by units in another design. The read-only premises command projects every premise in scope and the shared register. Shared roots hold proposed and confirmed reconciliation links with pinned premise hashes. Confirmed dependencies extend the existing impact walk. Found and stale links have a separate cascade preview. Strategy and portfolio pages show reconciliation debt. The premise MCP tool includes links. The skill guides pair coverage and confirmation of one link at a time.

## 0.5.2 (2026-10-30)

- Wording only: the fictional example portfolio is now "Findings to fixes", led by "the program lead". The standalone test no longer walks `.git` or local `build/` output. No behavior change.

## 0.5.1 (2026-10-30)

- Wording cleanup before publication: comments, test names and examples no longer refer to private history; the standalone test reads its provenance patterns from a local list.
- Wording only: comments, the spec and an example say "in a real deployment" where they described filling in names; the status helper that counts transitive dependents is now `downstream`. No behavior change.

## 0.5.0 (2026-10-30)

- Renamed the product and CLI to Plumb, with `plumb.ts`, a dependency-free package manifest, the `plumb` skill, MCP name and generator metadata.
- Split the engine and fictional examples into `plumb/`; Ratchet and Jig data and translators no longer ship with Plumb; each design's own build supplies its Plumb files. The delivery stream now lives under `examples/`.
- Added edition interface 1 and `plumb design add` for folders and GitHub releases: full manifests, bounded downloads, redirect restrictions, shared-layer agreement, exact recursive pins and cycle checks before workspace writes.
- Resolve role strings through the workspace team map; retain unresolved role text and write a sorted draft map. Identical-stamp additions re-derive live files and frozen adapters while retaining live state and published bytes.
- Use `PLUMB_*` settings with deprecated `DE_*` fallbacks and notices. Prefer `~/.config/plumb/scrub.txt`, falling back to the former configuration path.
- Moved scrub-list parsing into core. Replaced design-specific landscape exemptions with declared `section:` patterns and `allow-in-section:` entries; also accept the older entry marker. Vault scans retain no section exemptions.
- Write `plumb:human` vault markers and `.plumb-vault.json`; verify and upgrade older markers and manifests on regeneration, preserving annotations.
- Package Plumb itself, its docs, skill, fictional examples and tests with MANIFEST and leak scanning. Removed paired-import options and bundled author designs.
- Removed Ratchet-specific diff branches from the product; compare imported designs through bundle JSON.
- Security contract vocabulary is declared through design configuration or contract attributes. Checks and severity remain.
- CLI outputs belong to the invoking workspace's `build/` directory, keeping workspace data out of an installed engine.
