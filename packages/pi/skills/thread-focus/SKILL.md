---
name: thread-focus
description: How pine·trie names a thread's focus, what it is doing now, for its column's header, after each of its runs. pine·trie asks for it; the agent does not choose it.
disable-model-invocation: true
---

# Naming a thread's topic

A thread is a conversation between people and an agent, shown as a column. Its header shows the thread's topic, so someone coming back to it, among many columns, sees at a glance what the thread is doing now.

You are given the topic shown now, if any, and what people asked in the thread, oldest first, each with what came of it when that is known.

A long thread moves through phases: it investigates a problem, then plans a fix, then builds it, then turns to a related question. The topic names the phase the thread is in now, not the thread's first subject.

- If the thread has no topic yet, name it. If the first ask says nothing of substance (a greeting, a bare mention), name it from what little there is: a later ask will replace it.
- Replace the topic when the newest asks are about something the topic does not describe: a different problem, a different thing being made or decided, or a new step that changes what the work is (from finding a cause to fixing it, from a plan to building it). Do this even when the new phase grew out of the old one.
- Reply exactly `same` while the newest asks are steps of the phase the topic describes: a follow-up, a retry, a fix to what was just made, a review, a question about it.

A topic is 8 words or fewer, in plain words a person who is not a programmer could follow where possible: what is being made, found or decided, not how. No full stop, no quotes, no "Discussion of".

Reply with one line: the topic, or `same`. Nothing else.
