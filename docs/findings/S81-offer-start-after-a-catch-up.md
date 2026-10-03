# S81 — where an offer starts, after a catch-up past what you took

A thread's offer came out conflicted in your repo, in the same four files its
lane had just resolved, though the lane was clean. This finding records why,
and the rule that fixes it (`PLAN-2026-10-02-offer-start-after-catch-up`).
It is S51 item 3 (`docs/findings/S51-offer-start-after-an-update.md`)
again: ADR-0060 removed the copies of your `@` that carried S51's rule, and
with them the rule, though a catch-up with the line needs it too.

Observed in Pineta's own repo, on the offer `pineta-offer/ideal-lily`, with
jj 0.44.0. The commands were read-only, on the host: `jj log`, `jj resolve
--list -r`, `jj evolog -r`, `jj op show`, and `jj diff --stat`.

**What the repo held.**

| commit | what it is | conflicted |
|---|---|---|
| `0b195282` | ideal-lily's earlier offer, taken: `Pineta-Source: e5621018` | no |
| `c625202c` | the line, above `0b195282`, changing some of its lines | no |
| `vvskrpyl` 69a77da1 | the lane's catch-up: a merge of `c625202c` and `e5621018`, `Pineta-Base: pineta-onto@c625202c` | 4 files |
| `rxknzpos` 707a483c | the lane's tip, after its agent resolved the merge | no |
| `puznttyw` 21b86a0e | the offer, `Pineta-Start: c625202c` and `e5621018` | the same 4 files |

- `jj diff --from c625202c --to 707a483c` is empty: the lane kept the
  line's text everywhere, so it held nothing the line lacked.
- The offer's evolog, every operation `pineta-host`'s: a new commit on
  `c625202c` and `e5621018` (conflicted, as their merge is); `restore --from
  707a483c` (clean); `rebase -s … -o c625202c` (conflicted); two describes.

**Answers.**

1. **The start had two heads.** `offerStart` was
   `heads(::tip & (c625202c | ::e5621018))`. `e5621018` is a taken source,
   and neither commit is the other's ancestor, so both are heads.
2. **The rebase subtracted the taken work.** jj keeps a commit's diff from
   its parents, so the offer became `c625202c + (tip − merge(c625202c,
   e5621018))`. The line holds `e5621018`'s changes already, as `0b195282`,
   and has changed some of them since. Taking them away again conflicts
   exactly where the line changed them: the files the catch-up conflicted
   in.
3. **No resolution in the thread can clear it.** The lane has nothing left
   to resolve; the conflict comes from the start alone. A conflicted offer
   cannot be taken onto the line (ADR-0060), so the thread was stuck.
4. **The base holds what was taken below it.** The lane merged `c625202c`
   whole. A source whose taken commit is in `::c625202c` is in the lane's
   tip already, in the form the line has it. The rule: the taken sources are
   read only from commits outside `::<the base's source>`, the commit the
   lane's `Pineta-Base` names (`takenRevset`, `packages/lanes/plan.ts`).
   Here that drops `e5621018`, the start is `c625202c`, and the lane's work
   changes no file, so the offer is withdrawn.
5. **For a WIP, the base's source is the WIP's commit, not the copy.** A
   lane on a WIP starts at its copy, which descends from no taken commit.
   What it holds is the WIP's commit it was copied from.
6. **A source taken after the catch-up still counts.** It is not below the
   base's source, so a branch's parent taken after the fork (S72) and a
   squash of two takes (S77 item 6) are unchanged.
7. **`present()` around the base's source.** A hidden commit still resolves
   (S72's probe), but one removed by `jj util gc` would fail the read and
   every refresh of the lane. With `present()` it excludes nothing: the
   start before this fix.

**The limit.** A WIP's taken commit rewritten after the lane caught up is
not in `::<the base's source>`, whose old commit is hidden. That source
counts again, and the offer can conflict as before. Catching up again clears
it. On the line, taken work is immutable.

`packages/lanes/lanes.test.ts` reproduces the sequence with real jj: "an
offer after a catch-up starts at the line it merged, not at what you took
below it". Without the rule, the offer conflicts in the file you changed.
