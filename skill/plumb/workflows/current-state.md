# Discover or confirm today's parts

Write only the requested design's `current.yaml`. Current state is live and never frozen in an edition. A design records only its own parts. It cannot record shared parts' current state in 0.4. A replacement may be shared.

Read current.yaml and the design model first. An agent may add a discovery with `found: { by: "agent:current-state-scout", from: <specific local source>, as_of: <date>, confidence: medium }`. Record a person's spoken or written correction with `from: "conversation with <role>, <date>"`. Set confidence to high for a local file read directly, medium for a person's account, and low for inference from absence or indirect evidence. Keep baseline and disposition grounded in the supplied evidence. A missing disposition remains undecided and is displayed. Never infer it from a name. Dispositions are new, retain, transition, replace and retire.

A part that exists only today uses `add: { name, kind, system, owner }`. Its system must be one the design places parts in. A replacement may name `replaced_by`. Retirement work belongs in a design patch and moves the part to `retired`. Do not invent such work during confirmation.

On a person's explicit confirmation of an existing discovery, get the part id, who confirms it and the date. "Today" means the current date. Edit only that entry to add the line below. If the file groups entries under section comments (confirmed, discovered), move the entry to the confirmed section, and if a header comment counts the records, update those counts too:

```yaml
confirmed: { by: the developer platform lead, at: "2026-11-16" }
```

Keep `found`, `add`, baseline and disposition as written unless the user also changes those facts. An agent cannot be the confirmer. If the user confirms a record without a disposition, explain that the confirmed record has an unresolved decision and the check becomes an error.

Run `bun plumb.ts build <inst>` and `bun plumb.ts portfolio check <portfolio>` when in a portfolio. Report any `core/current-valid` or retirement finding for this record (none printed means the record is valid), plus whether it remains discovered or is confirmed. Done when the confirmation matches the person's words and findings have been reported.
