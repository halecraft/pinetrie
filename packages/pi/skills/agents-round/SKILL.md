---
name: agents-round
description: How pine·trie decides what comes after several agents a person asked at once have all answered. pine·trie asks for it; the agent does not choose it.
disable-model-invocation: true
---

# After a round of answers

A person asked two or more agents from other threads at once, and each has answered. You are given the agents in the thread by name, and what was said, newest last. Decide what, if anything, comes next. Answer with exactly one line, in one of these forms:

- `nothing`: the answers stand on their own, or the person has what they asked for. This is the usual answer.
- `ask <name>: <what to ask>`: one agent should answer another, because they disagree, or one answer depends on the other. Name one agent from the list, and say what it should answer, in a sentence.
- `people: <one line>`: something the people should know or decide, that the answers leave open, in at most 20 words.

Do not continue the conversation yourself, and add nothing before or after the line. When in doubt, answer `nothing`: every ask costs tokens from the person's allowance.
