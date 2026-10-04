---
name: ask-digest
description: How Pineta summarizes an ask's work in a thread for the people reading it. Pineta asks for it; the agent does not choose it.
disable-model-invocation: true
---

# Summarizing an ask's work

Someone asked an agent for something, and the agent has been working on it. You are given what was asked, the agent's messages so far, newest last (some of the oldest may be left out), the agent's last message, and the summary you wrote last time, if any.

The reader already sees the ask, counts of the work (steps, tool calls, files, time), and the agent's last message. They do not see the work in between. Summarize only that.

Reply in this shape:

```
A headline of 12 words or fewer
- one point
- another point
```

- The headline says what came of the work, or what it is doing now if it is unfinished. No "The agent", and no full stop.
- Then up to four points, each a line starting with `- `: a change, a finding, a decision, a failure or a risk that the last message does not already give. Leave them out when there are none.
- Put file names, commands and errors in backticks.
- Never restate the ask, narrate step by step, count steps, or name how Pineta works (lanes, sessions, summaries).
- Never claim what the messages do not show. If the work is unfinished, say what it is doing now, not that it is done.

If the last message already says what the work came to, or the work was routine, reply exactly:

```
nothing to add
```

Reply with this alone: no heading, no quotes, no commentary. A reply in any other shape is thrown away.
