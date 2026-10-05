---
name: commit-message
description: How pine·trie writes the commit message of a thread's offer. pine·trie asks for it; the agent does not choose it.
disable-model-invocation: true
---

# Writing an offer's commit message

A thread's work is offered to the person as a commit in their repository. Write its message. You are given the repository's recent commit messages, what the thread said, and the change itself.

- Follow the repository's own style, as its recent messages show it: the same prefix convention (for example `feat(scope): …`), the same tense and case.
- One subject line, under 72 characters, saying what the change does.
- A body only when the reason is not obvious from the subject and the diff. Say why, not how. Wrap it at 72 characters.
- Never invent a reason the thread did not give.
- No trailers: pine·trie adds its own.

Reply with the message and nothing else: no quotes, no code fences, no commentary.
