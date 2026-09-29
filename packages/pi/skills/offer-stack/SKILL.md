---
name: offer-stack
description: How Pineta's agent splits a thread's offer into a stack of reviewable revisions. Pineta runs it; the agent does not choose it.
disable-model-invocation: true
---

# Splitting an offer into a stack

The person asked for this thread's work as a series of revisions they can review one at a time, rather than one commit. Build that series with jj, in this thread's own copy.

- Start a new revision on the commit the prompt names (`jj new <commit>`). Never edit the thread's existing revisions.
- Make each revision one step a reviewer can follow: a refactor before the change that needs it, the change, then its tests and docs. Bring files over from the thread's tip with `jj restore --from <tip> <paths>`, or edit them.
- Each revision builds on the last, and each should pass the project's checks on its own (see `AGENTS.md`). When a step cannot, say so in its message.
- The last revision must hold exactly the tip's files: nothing lost, nothing added. Check with `jj diff --from <tip> --to <last>`, which must print nothing.
- Describe each revision as a commit message, in the repository's own style: a subject under 72 characters, and a body only when the reason is not obvious.
- When the stack is done, point the bookmark the prompt names at its last revision, and end your turn with a list of the revisions and what each does.

Pineta checks the stack against the tip itself; a stack that differs is refused.
