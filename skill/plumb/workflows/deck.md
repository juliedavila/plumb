# Prepare and present the deck, then mark it presented

`<design>/` is the design's folder: `examples/delivery-stream` in this bundle, `instances/<namespace>` in an adopter workspace.

**Scope.** `<design>/deck.yaml` (the decisions slide only, at the user's word) and one report snapshot in `<design>/reports/`, written by the command. Every other slide is computed from the build.
**Inputs.** The instance. The decisions the user wants on the slide, in their words.
**Output.** A deck that builds without deck warnings, the user presenting it, then a presented snapshot.

## "Get the deck ready" means

All of: the brief read (step 1), the decisions slide holding only what the user decided (step 2), a build with no deck warning (step 3), and a short summary to the user: the overall status sentence, each milestone not green with its first reason, what changed since the baseline, and the decisions on the slide. Nothing is presented or marked until the user says so.

**The baseline** of the "What changed" slide is the last report marked presented, else the last one saved. With neither, the slide says this is the first report. tell the user, and that `bun plumb.ts report <design>` (or Mark as presented after the meeting) sets one.

## Prepare

1. `bun plumb.ts brief <design>`: status, milestones and what changed since the last presented report are what the slides will say. Tell the user, before they present, of any milestone that changed colour and any new error finding.
2. **Decisions.** The decisions slide shows only the `items` under the `decisions` slide in `deck.yaml`:

```yaml
  - template: decisions
    items:
      - decision: Name an owner team for each part that has none
        why: Work on those parts has no owner, and later work waits on some of it.
        refs: [teams/unit-has-owner]
```

   Write or change an item only from the user's words. The engine's candidate decisions are in that slide's speaker notes. offer them, never add them unasked. `refs` name records by id (units, claims, patches, `pack/rule` keys). A decision whose `refs` name a patch shows that patch's verdict beside it on the slide.
3. `bun plumb.ts build <design>`. **Speaker notes go stale.** The author's own notes in `deck.yaml` (each slide's `notes:`) are written by hand. after a status change they can name a status the build no longer has, and the build warns. Read every warning naming `deck.yaml`, quote it to the user with the slide it is on, and change the note only with their words. Any warning naming `deck.yaml` (an unknown template, a ref the build does not hold, a milestone with no `delivers` or `means`, a decision or a speaker note whose words contradict a patch's verdict or a milestone's status) is fixed before presenting. say which, and change the words only as the user agrees.

## Present (the user does this)

`open build/<name>/index.html`, then press `P`. Arrows move, `N` opens the speaker notes in their own window, `F` asks for full screen, Esc leaves. To have a **Mark as presented** button, serve it instead: `bun plumb.ts dev <design>` and open the address it prints. The button is on the end screen after the last slide and in the notes window, never on a slide the room reads.

## Mark it presented

Only after the user says the deck was shown:

`bun plumb.ts report <design> --presented`

It saves `reports/<time>.json` marked presented. The next deck's "what changed" compares with it. Run it once per meeting. When the user pressed Mark as presented on the page, the snapshot is already saved: do not run it again.

## Done when

The build prints no deck warning, the user has the summary above, and, after the meeting, the command printed "marked as presented" or the user pressed **Mark as presented** (on the end screen after the last slide, or in the speaker notes window).
