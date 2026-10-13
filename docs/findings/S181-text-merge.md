# S181 — The path merge runs `git merge-file`: a merge in TypeScript resolved real conflicts silently and was 15× slower; a file is text when it holds no NUL byte, which differs from "valid UTF-8" only on legacy-encoded text and tiny binaries

- **Status:** Answered
- **Led to:** ADR-0142

**Question.** ADR-0142's path merge (S160's laws) merges text three ways
in lanehost's disks role. S160 used `git merge-file`, and called a file
binary when it held a NUL byte.
1. Does a merge in TypeScript (npm `node-diff3`) give the same result as
   `git merge-file`, clean or conflicted and byte for byte, on the paths
   both sides changed in pine·trie's own merges?
2. What does each cost per path: a `git merge-file` process, against a
   call in the host's process?
3. What counts as text? On every blob of the corpus, how many files does
   "holds no NUL byte" class differently from "is valid UTF-8"? Which are
   they?

**Kill criterion.**
- If the TypeScript merge differs from `git merge-file` on more than 1%
  of paths, or on any clean result, the merge runs `git merge-file`, and
  the disks role's image needs git.
- If the two text rules differ on a file a person would call text (SVG,
  JSON, CSV, Markdown) or one they would call binary, the rule that gets
  it right is the one.

**Throw away.** `docs/findings/S181-text-merge/probe.mjs`, run against
pine·trie's git history: each two-parent merge commit, its merge base,
and each path both sides changed.

Run in a lane on the Mac's VM: git 2.47.3, `node-diff3` 3.2.1, Node 24.21.
The corpus is a mirror of duane's working copy (`git clone --mirror
/mnt/host-working-copy`, 54,794 commits, every ref jj keeps): 385
two-parent merges, each with one merge base. The paths both sides changed,
to different content, with neither side deleting it: 1,976, of which 2
held a NUL byte. S160 counted 5,788 for 313 merges because it also counted
the same change on both sides and deletions, which need no text merge.
`results-merges.json` lists every disagreement with its blob ids;
`results-text.json` is the text rules over the designer files below.

## Answers

1. **`node-diff3` cannot be trusted with a clean result.**

   | | paths |
   |---|---|
   | both clean, byte for byte the same | 1,328 |
   | both conflicted | 640 |
   | git clean, `node-diff3` conflicted | 3 |
   | `node-diff3` clean, git conflicted | 3 |

   - Each of git's 3 clean results is the file the merge commit recorded.
   - Of `node-diff3`'s 3, two are not. In `packages/client/composer.tsx`
     both sides renamed one import differently (`useWhoIsAt`,
     `useTypingAt`); `node-diff3` took one side, and git conflicted. That
     is a wrong file reported clean: the one result a merge must never
     give.
   - The kill criterion holds: the merge runs `git merge-file`, so the
     disks role's image needs git.
2. **Cost:** `git merge-file`, a process per path with its three files
   written first, took 3.3 ms per path on average; `node-diff3`, in the
   process, took 49 ms (its diff grows with the product of the files'
   lengths).
3. **What counts as text.**
   - Over 40,583 files (pine·trie's tree with `node_modules`, and flask
     with its `.venv`), "holds no NUL byte" and "is valid UTF-8" never
     differed. 77 files held a NUL.
   - Over files designers export, they differed on three:

     | file | NUL | UTF-8 | a person calls it |
     |---|---|---|---|
     | a CSV from Excel in Windows-1252 | no | no | text |
     | notes in Latin-1 | no | no | text |
     | a 3-byte binary | no | no | binary |
     | a CSV from Excel as "Unicode text" (UTF-16) | yes | no | text |
     | PNG, JPEG, PDF, an SVG with a BOM | as expected | as expected | as expected |

   - **The rule is git's: no NUL byte means text.** It merges
     legacy-encoded text line by line, as `git merge-file` does, which
     the UTF-8 rule would turn into conflicts. The NUL-free binary it
     gets wrong is rare, and a line merge of two changed binaries is
     still checked by the run after a catch-up. UTF-16 text is binary
     under both rules: it conflicts whenever both sides change it. The
     review decodes UTF-8, and shows any other text as text only when it
     decodes.
