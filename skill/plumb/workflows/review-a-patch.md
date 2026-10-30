# Review a patch

**Scope.** One patch file, read only, until the user decides. Then only that file's `status` and `decision` change.
**Inputs.** The patch id. `bun plumb.ts brief <inst>` lists the proposed ones.
**Output.** The verdict, reported as the engine gives it, with what the patch does and what it costs.

## Steps

1. `bun plumb.ts impact <inst> <patch-id>`.
2. Read the patch file: its `why`, `ops` and `provenance.based_on`.
3. `bun plumb.ts brief <inst>` for the current model hash. When `based_on` is not its prefix, the patch was written against an older model: say so.

## What to report, in this order

1. **Verdict**: the word after `## Verdict:` (`fail`, `caution` or `pass`) and each reason under it, word for word.

   | Verdict | Means | Your recommendation |
   |---|---|---|
   | fail | It introduces an error finding | Do not accept as written. give its Revise line |
   | caution | It passes the checks, and a person must look: findings that leave only with a removed record, a unit its text names that is not done, or a record its why names that no op touches | Name each such item. acceptance is the user's call |
   | pass | It passes the checks and nothing needs flagging | Acceptance is the user's call |

   A `pass` prints one line under the verdict, "Nothing needs flagging: …", and a Revise line saying nothing is asked of it. Report it as: "Verdict: pass. Nothing needs flagging." Do not invent reasons or risks the engine did not print. you may add your own view only labelled as yours ("My own read, not the engine's: …").

2. **What it changes**: the Added, Removed, Modified and Cascade sections, by name and id.
3. **Findings**: introduced, resolved, and gone with the removed record. A finding gone with its record is not a fix. say so.
4. **Units affected**: the list as printed.
5. **Stale**: the `based_on` result from step 3.

## Several patches

Review them one at a time, in id order, with steps 1 to 3 each, then give a table before any detail:

| Patch | Title | Verdict | Main reason (as printed) | Stale? |
|---|---|---|---|---|

Then each patch's section in the order above. Say when two patches touch the same record (the same id in their Added, Removed or Modified sections): accepting one changes the other's verdict, so the second is reviewed again after the first is decided.

## Presenting the choice

End with the user's options, word for word from the impact report, and nothing chosen for them:

- **Accept**: "say accept, with your role and your reason".
- **Reject**: the Reject line as printed.
- **Revise**: the Revise line as printed (for a `fail` or `caution`, the clause it asks for).

## When the user decides

Set `status: accepted` or `status: rejected` in the patch file and add:

```yaml
decision: { by: <the role who decided>, at: "<YYYY-MM-DD>", reason: "<their reason, in their words>" }
```

Then `bun plumb.ts build <inst>`. An accepted patch is compiled into the model on every build. A fail-verdict patch accepted makes the build exit 1, and you say so.

## Done when

The user has the verdict word and every reason as printed, and, when they decided, the file carries the status and a decision with `by`, `at` and `reason`.

For a root patch, run `bun plumb.ts portfolio impact <portfolio> <patch-id>` and `bun plumb.ts portfolio brief <portfolio>`. Read the root patch file. The portfolio impact evaluates load and composed findings. A root patch is never reviewed with `plumb impact <root>`. Accept or reject a tracker refresh whole. After a decision, rebuild the portfolio.
