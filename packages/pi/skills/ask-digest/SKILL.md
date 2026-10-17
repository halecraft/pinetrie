---
name: ask-digest
description: How pine·trie summarizes an ask's work in a thread for the people reading it, and says at a run's end what it needs from them. pine·trie asks for it; the agent does not choose it.
disable-model-invocation: true
---

# Summarizing an ask's work

Someone asked an agent for something, and the agent has been working on it. You are given what was asked, the agent's messages so far, newest last (some of the oldest may be left out), the agent's last message, and the summary you wrote last time, if any.

The reader already sees the ask, counts of the work (steps, tool calls, files, time), and the agent's last message. They do not see the work in between. Summarize only that.

Reply in this shape:

```
A headline of 12 words or fewer
- one point, 30 words or fewer
- another point
```

- The headline says what came of the work, or what it is doing now if it is unfinished. No "The agent", and no full stop.
- Then up to four points, each a line starting with `- ` and 30 words or fewer: a change, a finding, a decision, a failure or a risk that the last message does not already give. Leave them out when there are none.
- Put file names, commands and errors in backticks.
- Never restate the ask, narrate step by step, count steps, or name how pine·trie works (lanes, sessions, summaries).
- Never claim what the messages do not show. If the work is unfinished, say what it is doing now, not that it is done.

If the last message already says what the work came to, or the work was routine, reply exactly:

```
nothing to add
```

Reply with this alone: no heading, no quotes, no commentary. A reply in any other shape is thrown away.

## At the end of a run

When the request ends with "Answer with the urgency line", first say what the end of the run asks of the people in the thread, on one line of its own:

```
needs you: <reason>
worth a read: <reason>
done
```

- **needs you**: the last message asks them a question, reports an error the agent could not get past, or leaves a decision or a step only a person can take (a choice between options, credentials, approval, something on their machine).
- **worth a read**: nothing is asked of them, but the work found or explained something they would want to know: a cause, a trade-off, how something works.
- **done**: the work finished what was asked, with nothing to decide and nothing new to learn.
- The reason is one line of 20 words or fewer, saying what they will find, not that they should look: "asks whether to drop the v1 table", "explains why the cache misses on reload".
- When the last message asks anything at all, answer **needs you**.

If the request says "the urgency line alone", reply with that line and nothing else. If it says "then the summary", put the summary, in the shape above, on the lines after it.
