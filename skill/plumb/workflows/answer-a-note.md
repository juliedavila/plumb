# Answer a question pinned in notes.yaml

**Scope.** One note in `instances/<name>/notes.yaml`. Only that note's lines change.
**Inputs.** The note's id (`N-3`), or the record it is pinned to. `bun plumb.ts brief <inst>` lists every open question.
**Output.** The note answered in the file, and the answer repeated to the user with its sources.

## Steps

1. Read the note in `instances/<name>/notes.yaml`: its `target` (`kind` and `id`) and its `text`.
2. Get the facts from the engine, by the target's kind:

   | Target kind | Command |
   |---|---|
   | claim | `bun plumb.ts premise <inst> <claim-id>` |
   | unit, phase (a milestone) | `bun plumb.ts plan <inst>`, then `build/<name>/bundle.json` (`status.milestones`, `analysis`) |
   | patch | `bun plumb.ts impact <inst> <patch-id>` |
   | element, relationship, contract | `instances/<name>/model.yaml`, and `bun plumb.ts check <inst>` for its findings |
   | finding (`pack/rule@at`) | `bun plumb.ts check <inst>` |

   Run `bun plumb.ts build <inst>` first when `build/<name>/bundle.json` is missing or older than the instance's files.
3. Write the answer from what those printed. When they do not answer the question, the answer says what is known and what is not, and which file or person would settle it.
4. Edit that note only: add `answer`, `answered_by: agent`, `sources`, set `status: answered`, and set `updated` to the current time in UTC (read it with `bun -e 'console.log(new Date().toISOString())'`). Leave `id`, `target`, `kind`, `text`, `author` and `created` as they are.

```yaml
  - id: N-1
    target: { kind: claim, id: CL-01 }
    kind: question
    text: "Which milestone first produces evidence that could move its grade?"
    status: answered
    answer: "Its first test lands in “Repair intake is measured against the existing process”, through U-55, U-63 and U-67."
    answered_by: agent
    sources: ["bun plumb.ts premise instances/premerge CL-01"]
    author: person
    created: "2026-10-21T15:02:00Z"
    updated: "2026-10-22T16:40:00Z"
```

`sources` lists each command you ran or file and field you read, one string each. To add a new note instead, append an item with the next free `N-` id and `author: agent`.

## When a proposed patch would remove the note's record

If `bun plumb.ts brief <inst>` lists a proposed patch whose impact removes the record the note is pinned to (its Removed or Cascade section names the note's `target.id`), answer the question as the design stands today, and add one sentence: "Proposed patch P-00N would remove this record. if it is accepted, this note is left pinned to nothing." Do not move the note to another record, and do not edit the patch. Tell the user too, since accepting the patch makes the `notes` check warn about the note.

## Done when

All of these, each checked, not assumed:

1. `bun plumb.ts build <inst>` prints no warning naming `notes.yaml`.
2. `bun plumb.ts brief <inst>` no longer lists the note under "Open questions in notes.yaml".
3. In `instances/<name>/notes.yaml`, the note reads `status: answered`, `answered_by: agent`, a non-empty `answer`, at least one `sources` entry, and an `updated` later than `created`. its `id`, `target`, `text`, `author` and `created` are unchanged.
4. The user has the answer and its sources.

Root notes live in `<root>/notes.yaml` and may target either org or shared records with canonical ids. Read `bun plumb.ts build <root>` output and its root.json, plus `bun plumb.ts portfolio brief <portfolio>`, for root questions. Edit only the requested note.
