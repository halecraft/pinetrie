# S77 — what jj does under an integration line

ADR-0060 (proposed) puts takes on an immutable bookmark, `pinetrie-onto`,
starts threads from a `wip/` bookmark through a copy, and keeps pine·trie's
ledger in trailers on the commits it makes. This finding measures the jj
behaviours it relies on (`PLAN-2026-10-02-integration-line-probes`).

Measured with jj 0.44.0, the version lanes run too: `prepareImages`
(`packages/lanes/image.ts`) builds the lane image with the host's jj. Every
probe ran in a fresh repo under `/tmp`, with `JJ_CONFIG` pointing at an empty
file, so no user alias changed a result. Item 3's cost was read on pine·trie's
own repo, with the extension given by `--config-file` and nothing written.

**1. `jj bookmark move` moves a bookmark forward only.** Without
`--allow-backwards`, a sideways or backwards move fails with exit 1:
`Error: Refusing to move bookmark backwards or sideways: line`. A forward
move succeeds. A take's move to an offer on the line is forward, so jj
itself refuses a stale take.

**2. A `wip/` bookmark under each rewrite.** A WIP of two commits, `w1` and
`w2`, with `wip/x` on `w2`, above `line`:

| rewrite | `wip/x` afterwards |
|---|---|
| `jj abandon wip/x` | deleted |
| `jj squash -r wip/x` (into `w1`) | moves to the combined commit; with both commits described, jj asks for a message (an editor, or `-m`) |
| `jj split -r wip/x` | stays on the part that keeps the change id, the later one |
| `jj rebase` of the WIP onto a newer line commit | follows, now above the line's new commit |
| `jj squash --from 'line..wip/x' --into line` | moves onto the line's commit; the WIP's change id is gone |
| `jj bookmark move line --to wip/x` (landed) | unchanged, and now in `::line` |

So "landed" is read from the bookmark first: its target is in `::line`.
That covers both landing by moving the line and squashing into it. A change
id is no help after a squash into the line, since the WIP's change is gone.
Only with the bookmark deleted does the copy's commit, or its change id,
have to be looked up in `::line`.

**3. The extended `immutable_heads()`.** With

```
builtin_immutable_heads() | present(pinetrie-onto)
  | (bookmarks(glob:"pinetrie-offer/*") & children(present(pinetrie-onto)))
```

the line and an offer whose parent is the line are immutable. A WIP above
the line, and an offer on the WIP, are mutable: `jj describe` of the WIP
succeeds and rebases the offer above it. `jj describe` of the line's offer
fails: `Error: Commit … is immutable`.

- **`present()` is required.** Without it, a repo with no `pinetrie-onto`
  fails every jj command: `Revision 'pinetrie-onto' doesn't exist`, from
  `jj log` included.
- **Cost:** `jj log -r 'mutable()' -T ''` on pine·trie's repo (873 commits)
  took 0.01 to 0.02 s with or without the extension.

**4. A lane's repo after its fetched ref moves sideways.** A lane with
`B` fetched to `refs/heads/pinetrie/fetched/0`, `jj new B`, a turn on top,
and its bookmark `pinetrie/lane` on `B`; then `C`, which does not descend
from `B`, fetched to the same ref and imported with
`--ignore-working-copy`. Nothing was abandoned or rebased, the working copy
was not stale, and `jj new C` succeeded. The same repo without the lane's
bookmark lost `B` and rebased the turn and the working copy onto `B`'s
parent: stale, as S74 found on the base disk. A lane's bookmark descends
from what it forked from, so a lane is safe; the base disk had no bookmark.

**5. An offer from a WIP's copy, placed on the rewritten WIP.** Line: a
file `a` of 20 lines. WIP: line 5 changed. Copy: on the line, with the
WIP's files. The lane's turn: line 15 of `a`, and file `b`. The offer was
built as the host builds one (a commit on the copy, the lane tip's files
restored, rebased onto `wip/x`):

| the WIP since the copy | the offer |
|---|---|
| unchanged | clean; its diff is the lane's lines only |
| line 2 changed | clean |
| line 15 changed | conflicted in `a` only; `b` clean |

**6. Trailers through rewrites.**

- `jj describe -m` replaces the whole message, trailers included.
- A squash of two described commits makes jj ask for the message, prefilled
  with both. Accepted as it is, it holds two trailer paragraphs, one after
  the other. jj's `trailers` template reads only the last paragraph: it saw
  `Pinetrie-Lane=t-2,Pinetrie-Source=bbbb`, not the first commit's. A revset
  over the whole description finds both:
  `description(regex:"(?m)^Pinetrie-Source: aaaa$")`.
- `jj squash -u` keeps the destination's message only, so the source's
  trailers are gone.

**7. The host's rewrite of an immutable offer.** `jj describe
--ignore-immutable`, as `pinetrie-host`, rewrote the line's offer, and the
offer's evolog names `pinetrie-host@…`. Moving `pinetrie-onto` forward to the
offer, as a take would, succeeded with the bookmark immutable: a bookmark
move rewrites no commit. Rebasing the WIP onto the moved line succeeded, and
the WIP stayed mutable.

**8. jj's default log hides an immutable offer** (measured after the
build, with `e2e:lanes`). A repo with `pinetrie-onto`, an offer on it, and
your `@` beside: with the offers in `immutable_heads()`, `jj log` showed
your work and the line, and not the offer; with only the line there, it
showed all three. `builtin_log()` is `present(@) | ancestors(immutable_heads().., 2) | trunk()`,
and an immutable head is not in `immutable_heads()..`. jjui, which uses the
same default revset, hides it too. So setting up the line also adds the
offers to the repo's `revsets.log` (`logRevset`): `builtin_log() |
bookmarks(glob:"pinetrie-offer/*")`, shown before it is written, as the
immutable heads are.

jjui's own `[revisions] revset` replaces `revsets.log` for jjui (seen with
jjui 0.10.9, whose config set `present(@) | ancestors(immutable_heads().., 2)
| ancestors(@, 5) | present(trunk())`): `jj log` showed an offer on the
line, and jjui did not. The setup cannot reach that file; the line menu says
to add `bookmarks(glob:"pinetrie-offer/*")` to it, and
`docs/the-jujutsu-repo.md` shows how.

**What follows for ADR-0060.**

- The extension to `immutable_heads()` wraps the line in `present()`.
- "Landed" is the WIP bookmark's target in `::<onto>`. The copy's commit or
  change id is read only when the bookmark is gone.
- pine·trie reads its trailers from every paragraph of a message, by regex,
  never with jj's `trailers`, which sees only the last.
- A squash that keeps one message (`-u`, or a message you write) drops the
  other commit's trailers. pine·trie then believes you do not have that work,
  and offers it again: the consequence of an explicit edit, as the ADR
  says.
- Lanes need no S74 recovery: their bookmark keeps what they forked from
  referenced. The base disk keeps it.
