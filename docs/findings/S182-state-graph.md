# S182 — With an accept recorded as a merge, the graph's base merges every flow of S102's kind cleanly with no join; a criss-cross needs its bases merged first, never one chosen, and arises only from accepting an offer older than its lane

- **Status:** Answered
- **Led to:** ADR-0142

**Question.** ADR-0142 records each state's parents, an accept with two:
the folder's previous state and the offer's tip. A merge's base is a
lowest common ancestor. In a jj project an accepted offer is a copy of the
lane's work, and the lane's next catch-up merged it twice until joins
(ADR-0079, S102).
1. In the flows of S102 (accept, then the lane edits the same file
   again; accept, then you edit the accepted file; two accepts of one
   lane; a branch and its parent catching up with each other), does the
   graph's base give the result a person expects, with no join?
2. Which flows give more than one lowest common ancestor, and does
   choosing either one, or merging them first (git's recursive strategy),
   change the result?

**Kill criterion.** If a flow a person can make needs the lane's work
traced through a copy (as joins do), recording an accept as a merge is
not enough, and the graph needs ledgers as a jj project does.

**Throw away.** `docs/findings/S182-state-graph/probe.py`. git stands in
for the graph only: each state is a commit made with the parents ADR-0142
gives it, `git merge-base --all` finds the bases, and the merge is
`git merge-file` path by path, as ADR-0142's merge would be.

Run in a lane with git 2.47.3. `results.json` has each flow's row.

## Answers

1. **The graph's base is right in every flow, with no join; a linear
   base conflicts in every one.**

   | flow | graph's base | the lane's start as the base |
   |---|---|---|
   | A: accepted, then the lane changes the accepted line again | right | conflict |
   | B: accepted, then you change the accepted line, and the lane catches up | right | conflict |
   | C: accepted twice, then the lane changes its own line again | right | conflict |
   | D: a branch caught up with its parent, both accepted, the branch changes its line | right | conflict |

   Because the accept's state has the lane's tip as a parent, that tip is
   the next catch-up's base. The lane's accepted work is on both sides,
   alike, and is taken once. This is what ADR-0079's joins rebuild in a
   jj project, where an accepted offer is a copy with no link to the
   lane.
2. **A criss-cross gives two bases, and neither one is always right.**
   - The case: you save; the lane catches up with your save; an offer
     shown before that catch-up is accepted after it. The lane's tip and
     the folder then share two bases: your save and the lane's turn.
   - Which single base merges right depends on the content: in E only the
     first did, in E2 only the second.
   - **Merging the bases first** into a virtual base (git's recursive
     strategy), with a conflict in that inner merge kept as git's markers,
     was right in E2 and E3. In E, where the inner merge conflicts, it
     conflicted: never a wrong file.
   - So the merge never chooses one base. It merges them first, as git's
     recursive strategy does.
   - **It needs a stale accept.** ADR-0065 refuses an acceptance whose
     offer now brings other work (`offer_changed`), and an offer shown
     before the catch-up brings less than the lane holds after it. So
     with that refusal kept, a criss-cross should not arise from people's
     flows. The recursive merge is the guard if one does.

**Kill criterion:** not met. No flow needs the lane's work traced through
a copy.
