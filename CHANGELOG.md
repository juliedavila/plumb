# Changelog

## 0.6.0

A design's own unresolved tested_by unit is now an error.
The content hash of a rooted design now covers each composed design's model and plan, so every rooted design's content hash changes once.

Premises can be settled by units in another design. The read-only premises command projects every premise in scope and the shared register. Shared roots hold proposed and confirmed reconciliation links with pinned premise hashes. Confirmed dependencies extend the existing impact walk. Found and stale links have a separate cascade preview. Strategy and portfolio pages show reconciliation debt. The premise MCP tool includes links. The skill guides pair coverage and confirmation of one link at a time.

## 0.5.2

- Wording only: the fictional example portfolio is now "Findings to fixes", led by "the program lead". The standalone test no longer walks `.git` or local `build/` output. No behavior change.

## 0.5.1

- Wording cleanup before publication: comments, test names and examples no longer refer to private history; the standalone test reads its provenance patterns from a local list.
- Wording only: comments, the spec and an example say "in a real deployment" where they described filling in names; the status helper that counts transitive dependents is now `downstream`. No behavior change.

## 0.5.0

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
