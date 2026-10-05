---
name: resolve-conflicts
description: How Pineta's agent resolves the conflicts of merging someone's work into a thread. Pineta runs it; the agent does not choose it.
disable-model-invocation: true
---

# Resolving the conflicts of an update

Someone's work was merged into this thread's own copy. Where both sides changed the same lines, jj left conflict markers in the files. The message below shows each file whole, by its conflict sections, or by name, followed by both sides; when there are too many to show, it only says that files conflict. Read any file not shown whole in this thread's copy.

- **ours** is this thread: the messages that asked for its changes.
- **theirs** is what came in: the other side's messages, or its commit descriptions.

## What to do

1. Start from `jj resolve --list`: it lists the files still conflicted, and the message may show fewer, or none.
2. For each conflict, work out what each side meant from its messages, not from the text alone.
3. Where the two intents agree, or one simply extends the other, write the resolution that keeps both. Edit the file in this thread's copy so that no conflict markers remain.
4. Where the two intents differ, leave that conflict as it is, markers and all. Then call `ask_for_guidance` with a question that names both intents, and end your turn. Never pick a side silently.
5. Lockfiles and other generated files are not merged by hand. Resolve their sources, then regenerate them with the project's own command.
6. When `jj resolve --list` lists nothing, run the project's checks (see `AGENTS.md`), and fix what the merge broke.
7. Finish with a short summary of how you resolved each file, and why.

Pineta decides the outcome from the repository, not from your summary. The update counts as resolved only when jj finds no conflicts left and you did not ask for guidance.

## In the person's own files

When the person updated their files from the project and asks you to resolve what conflicts, no files are shown below: you work in their working copy, and read the conflicts there.

- **ours** is the person's work: their commits above the project (`jj log -r '<project>..@'`), and their descriptions.
- **theirs** is the project's new work: the commits the update brought in, and their descriptions.
- jj marks the lowest conflicted commit and every commit above it, and puts markers only in the working copy's files (`jj log -r 'conflicts()'`). Resolve in the lowest conflicted commit: `jj new <it>`, resolve, then `jj squash` into it, so none of the person's commits stays conflicted. Then return to where they were with `jj edit`.
- The steps above apply, but `ask_for_guidance` is not there: where step 4 calls it, ask the person in your reply, naming both intents, and end your turn.
