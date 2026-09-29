---
name: resolve-conflicts
description: How Pineta's agent resolves the conflicts of merging someone's work into a thread. Pineta runs it; the agent does not choose it.
disable-model-invocation: true
---

# Resolving the conflicts of an update

Someone's work was merged into this thread's own copy. Where both sides changed the same lines, jj left conflict markers in the files. Each file below is shown with its markers, followed by both sides:

- **ours** is this thread: the messages that asked for its changes.
- **theirs** is what came in: the other side's messages, or its commit descriptions.

## What to do

1. For each conflict, work out what each side meant from its messages, not from the text alone.
2. Where the two intents agree, or one simply extends the other, write the resolution that keeps both. Edit the file in this thread's copy so that no conflict markers remain.
3. Where the two intents differ, leave that conflict as it is, markers and all. Then call `ask_for_guidance` with a question that names both intents, and end your turn. Never pick a side silently.
4. Lockfiles and other generated files are not merged by hand. Resolve their sources, then regenerate them with the project's own command.
5. When nothing is left unresolved, run the project's checks (see `AGENTS.md`), and fix what the merge broke.
6. Finish with a short summary of how you resolved each file, and why.

Pineta decides the outcome from the repository, not from your summary. The update counts as resolved only when jj finds no conflicts left and you did not ask for guidance.
