# S72 — where a branch's offer starts, after its parent is taken

- **Status:** Answered
- **Led to:** ADR-0038, ADR-0060, ADR-0104, ADR-0105

A branch's offer (ADR-0038) came out conflicted in 23 of its 26 files,
though the branch had changed only 7. This finding records why, and the rule
that fixes it (`PLAN-2026-10-02-offer-start-beside`). It extends S51
(`docs/findings/S51-offer-start-after-an-update.md`).

Observed in pine·trie's own repo, on the offer `pinetrie-offer/bronze-river`
(`dfbad45f`), with jj 0.44.0. The commands were read-only, from a lane,
against the repo mounted at `/mnt/host-working-copy`: `jj log`, `jj diff
--name-only`, `jj resolve --list` and `jj evolog`, all with
`--ignore-working-copy`.

**What the repos held.**

| time | event |
|---|---|
| 18:33 | woolly-flint's offer taken: `fa2f298f` delivered |
| 19:54 | bronze-river branches from woolly-flint at `25094563` |
| 20:28 | woolly-flint: "update from my work" (copy `2011b96c`, merged as `44f6752e`) |
| 20:42, 20:47 | woolly-flint's offers taken: its tip `efe50198` delivered |
| after | `pinetrie-offer/bronze-river` conflicts in 23 of its 26 files |

- bronze-river's tip was `db5dd95c`. The newest copy of your `@` in its
  history is `058662e9`, woolly-flint's own, made when woolly-flint forked.
  It is below `fa2f298f` and `25094563`.
- `efe50198` is neither in `::db5dd95c` nor a descendant of it: it is beside
  the tip. `heads(::db5dd95c & ::efe50198)` is `25094563`, the fork point.
- The offer's evolog shows it built on `fa2f298f`.

**Answers.**

1. **The start fell back to the older take.** `startHaves` kept the haves in
   the tip's history from the newest copy on (`058662e9`, `fa2f298f`) and
   dropped `efe50198`, which neither is in the tip's history nor holds the
   tip. The start was `heads(::db5dd95c & ::(@- | … | fa2f298f))`, that is
   `fa2f298f`.
2. **The offer carried woolly-flint's work up to the fork.** From
   `fa2f298f` to `db5dd95c` is 95 files; from `25094563`, 7. The 88 others
   are woolly-flint's work from 18:33 to 19:54, which you already took as
   part of `efe50198`. Restored on your `@-`, which holds woolly-flint's
   later state of the same files, they conflict.
3. **A commit delivered beside the tip still says what you have.** You have
   all of `efe50198`'s history, so you have whatever it shares with the
   tip's: `::efe50198 & ::db5dd95c`, whose head is the fork point.
4. **Only the part at or above the tip's newest copy counts.** Below the
   newest copy are your own commits or an older copy, and S51 says the
   newest copy supersedes those. A branch taken before its lane's update
   shows why: the branch's tip holds the lane's old copy, so its shared
   history with the lane's tip reaches that copy. Counting it would merge
   the old copy's uncommitted edits back into the lane's start, which is
   S51's conflict. So the rule is `::beside & since::`, with `since` the
   newest copies in the tip's history. Here: `::efe50198 & 058662e9::`,
   which holds `25094563`. The new start is
   `heads(::tip & (::(target | held) | (::(beside) & (since)::)))`
   (`offerStart`, `packages/lanes/plan.ts`), with `held`, `beside` and
   `since` from `startHaves`.
5. **A copy beside the tip adds nothing,** since what it shares with the
   tip is your own commits, which never lie above a copy made in a lane. It
   is left in `beside` rather than filtered by a rule with no effect.
6. **The rule covers a have that holds the tip, when the tip's history holds
   a copy** (S51 item 6): `::branch & since::` then contains the tip. A lane
   with no copy in its history still needs the read of which haves hold the
   tip, and `packages/lanes/lanes.test.ts` checks that case.
7. **The limit.** A branch brought up to date *before* its parent was taken
   has its own copy as its newest, and its fork point is below that copy.
   The parent's delivered commit then adds nothing, and the offer still
   carries the parent's work up to the fork. Merging that copy with the fork
   point would be S51's conflict, so the rule leaves it out. Bringing the
   branch up to date again fixes it: the new copy holds what you took, and
   the offer becomes the branch's own.

**A probe: a delivered commit can be hidden.** In
`packages/lanes/lanes.test.ts` the parent and the branch are two lines of one
lane. Fetching the branch's line moves `tip@pinetrie-<lane>` sideways, and
`jj git import` abandons the parent's tip, the delivered commit. With jj
0.44.0, a hidden commit still resolves by its id, in `present()`, `::x` and
`x::`, so the start is the same. On the host each lane has its own remote
bookmark, so a parent's tip stays visible. In your repo `fa2f298f` and
`25094563` are hidden now, and still resolve.
