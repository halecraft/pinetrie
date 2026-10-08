# ADR-0084 — A resolution's prompt always fits what pi keeps when it compacts

- **Status:** Accepted
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/pi/TECHNICAL.md`
- **Evidence:** S106
- **Amends:**
  - ADR-0033: a resolution's prompt fits what pi keeps when it compacts; over
    it, the hunks give way to conflict sections, then names, then a count,
    before the reasons do.

**Context.** A resolution run starts with a land message carrying every
conflicted file whole (ADR-0033). A 37-file conflict made one of about
250 000 tokens (S106). pi never compacts the newest message, so the run
could not start, and the thread was left with the message at its tip and a
merge no later catch-up would merge again. The 60 000-character budget
bounded only the reasons, in characters, a unit pi does not count in.

**Decision.**
- **The budget is pi's.** `packages/pi` passes its compaction settings to
  every harness (`PINETRIE_COMPACTION`), and the land message's budget is
  their `keepRecentTokens`, measured with pi's `estimateTokens`
  (`LAND_BUDGET`). A message within it is kept whole when pi compacts.
- **The whole message is measured.** `planResolution` measures each message
  it considers, whole, and returns the fullest that fits.
- **The files show one way for every file, the fullest that fits:** whole,
  by their conflict sections, by name, or only as a count. The way is chosen
  with each side's newest reason kept; then each side keeps as many newest
  reasons as fit. The code gives way before the reasons: the agent can read
  the files in its lane again, and its own reasons may be compacted away.
- **The smallest message is settled before the merge.** The count message
  needs only the skill, the person's text and whose work comes in, so it
  states no number of files and is measured first (`resolutionFloor`). If
  it does not fit, the catch-up is refused with the lane untouched
  (`planCatchUp`). `planResolution` takes the floor, so it always has a
  message that fits.
- **`jj resolve --list` is the list of what is left.** Every prompt says so,
  and the `resolve-conflicts` skill starts from it.
- ADR-0010 holds: in every way but the count, each file keeps both labelled
  sides; the count lists no file, so it drops no file's side.

**Consequences.**
- A large conflict costs the agent reads in its lane, and likely a
  compaction during the run. That is safe, since the list lives in jj.
- A long thread may still compact before the run starts. That is ordinary
  compaction, which can now succeed.
- A catch-up can be refused when the skill and the card's text alone
  overflow the budget, with the lane as it was.
- The `compaction` option equals pi's default today. A change to it moves
  the budget with it.
- A thread already stuck behind an oversized message is not rescued (S106,
  "Recovering a thread already stuck").

**Alternatives rejected.**
- **A character constant in the host, with a share for the files.** It holds
  only while someone keeps it in step with pi's settings and ratio, and it
  bounds the parts, not the message.
- **Refusing after the merge.** The lane would hold a conflicted merge with
  no prompt, and the next catch-up would find nothing to merge (S106 item 5).
- **Choosing the way to show the files with no reasons, filling them
  after.** Whole files just under the budget would leave every side with
  none, and the reasons are what ADR-0033 adds over a merge tool.
- **A per-side share of characters for the reasons.** In tokens, it would
  restate pi's ratio.
- **The model's context window as the budget.** The host does not hold the
  model where it plans, and pi's cut uses `keepRecentTokens`, not the window.
- **The person's `keepRecentTokens`.** The harness never reads their
  settings.
- **Trimming the skill or the person's text.** It silently changes the
  policy (ADR-0033) or the ask (ADR-0055).
- **A different way to show each file.** It fits more, but the prompt reads
  several ways at once, and the choice depends on file order.
- **Truncating the names instead of a count.** It drops some files' sides
  and keeps others', and its size still grows with the files.
- **Relying on pi's compaction.** It never compacts the newest message.
- **Names only, always.** Small conflicts, the common case, would cost reads
  the agent does not need today.
