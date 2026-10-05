# ADR-0033 — Conflicts are resolved by the agent in its lane, by a policy you can replace, and the repository decides the outcome

**Status:** Accepted. Implemented by `PLAN-2026-09-27-workspaces` (landing;
the fold's merge comes with `PLAN-2026-09-27-fold`). **Amended by ADR-0038
(proposed):** landing becomes "update from my work", which runs the agent
only when the merge conflicts. Builds on ADR-0032 (folds
and landing are jj merges in a
lane's workspace) and ADR-0010 (labelled legs, and the destination's is
mandatory).
Amended by ADR-0080: a resolution ends like any run. `ask_for_guidance` is
renamed `ask_about_conflict`, and is accepted while jj finds conflicts in
the lane's copy; the strip's "needs you" is read from the thread's newest
ask, conflicts left are the offer's, and `pinetrie.landing` goes (S104).
**Amended by ADR-0084:** a resolution's prompt fits what pi keeps
when it compacts; over it, the hunks give way to conflict sections, then
names, then a count, before the reasons do.

**Context.** A fold of files and a landing are jj merges in a lane's
workspace (ADR-0032). jj records conflicts rather than failing, so a merge
always completes and may leave conflicts on disk (S36 item 11). A merge tool
sees only text. pine·trie also knows why each side changed a line: a conflicting
hunk traces through turn revisions to the messages that produced it. ADR-0010
showed that a fold without labelled sides is confidently wrong. Merges also
conflict without touching the same lines: both sides can merge cleanly and
still break each other. How cautious to be varies by person and by repo.

**Decision.**
- **Resolution is a run on the lane that holds the merge.** For a fold, it is
  the fold's own run on the target: its prompt carries the synthesis and,
  when the merge conflicts, the conflicts. For a landing, it is a run on the
  lane being landed. Every landing runs, conflicts or not, because a clean
  merge can still break. It queues behind a running lane, shows in the
  column, and can be stopped, as any run (ADR-0020).
- **The host fixes what the agent is given.** For each conflicted file, the
  run is given:
  - the base, ours and theirs, labelled: ours is the lane holding the merge
    (the destination), and theirs is what comes in;
  - each side's hunks;
  - for each side, the messages behind the revisions that touched those lines,
    attributed as a fold sends them. In a landing, theirs is your committed
    work, which has no messages, so its revision descriptions stand in.

  ADR-0010 holds: the labels are always present, and the destination's side
  is never dropped. Under a budget, the messages are compacted first, never
  the hunks. (*Amended by ADR-0084:* the hunks give way first, to conflict
  sections, names or a count, since the agent can read them in its lane.)
- **The policy is a skill, `resolve-conflicts`.** pine·trie ships a `SKILL.md`
  and loads it as an extra skill path. pi loads your skills, then the repo's
  (`.pi/skills`), then extra paths, and the first of a name wins. So a
  `resolve-conflicts` of yours or the repo's replaces pine·trie's with no
  configuration. Its frontmatter sets `disable-model-invocation: true`, so the
  agent never picks it from its list, and only the host invokes it. The skill
  says:
  - how to judge whether the two sides meant the same thing;
  - when to stop and ask;
  - which checks to run;
  - how to word the question;
  - any rules for the repo ("regenerate lockfiles"; "never resolve ADR
    text").

  It is read from your working copy, never from the lane's, so a branch cannot
  change the rules that judge its own merge.
- **The prompt is pine·trie's message, not the skill's text.** The column shows a
  short resolution message ("3 conflicts merging 'aside' into this thread")
  whose details record the skill's path and a hash of its content. The model
  sees the skill's content and the conflict material. pi's `lane.skill` is not
  used: it would write the whole skill into the tree as a `user` message.
- **The agent can always stop; it can never claim a success the repository
  contradicts.** A resolution run may call a pine·trie tool, `ask_for_guidance`,
  with its question, to end as "needs you" whatever the files say. The skill
  tells it to leave a conflict it should ask about unresolved rather than
  pick a side. When the run ends, the host decides:
  - **needs you** if the agent asked, or if `jj resolve --list` in the
    workspace still shows conflicts. The agent's question names the two
    intents that differ. The conflicts stay in the lane's workspace, and
    nothing is offered to you. Your answer is a message in the thread, which
    compels the agent (the thread is agent work), and it continues from there.
  - **resolved** otherwise. The resolution is committed as a turn revision,
    and for a landing, the merge is offered to you to take (ADR-0032).
- **Partial resolution is allowed.** The agent resolves what both sides agree
  on and asks about the rest; the outcome is still "needs you".

**Consequences.**
- Every landing costs a run, and a fold that conflicts costs a larger one.
- Conflict material can be large, so it needs the budget ladder of ADR-0005
  and ADR-0010.
- Changing the skill changes the policy without changing code. Someone whose
  skill says "always resolve" gets that: the skill is theirs. It cannot remove
  the labels, the destination's side, or the host's check of the outcome.
- `setUpModel` loads pine·trie's skill directory as an extra path, and the
  harness never needs the skill in its `resources`.
- Fold's synthesis can later become a skill, `fold`, in the same way.

**Alternatives rejected.**
- jj's merge tools or an external merge tool (they see text, not intent).
- Resolving in your working copy (ADR-0032: agents never write there).
- Trusting the agent's report of success (the repository can check it).
- A policy written into pine·trie (it cannot differ by person or by repo).
- The policy in `AGENTS.md` (always in context, and not replaceable as one
  unit).
- pi's `lane.skill` (it writes the whole skill into the tree).
- Loading the skill from the lane's workspace (a branch could rewrite the rules
  that judge it).
- Landing a clean merge without a run (lines that merge cleanly can still
  break each other).
- Stopping at the first conflict (the agent can resolve what agrees and ask
  about the rest).
