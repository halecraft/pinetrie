# ADR-0128 — A thread's agent can be invited into another thread, where only a mention asks it, an answer wakes only the agent that asked, and a budget of tokens ends what agents start

Numbered 0127 until 2026-10-10, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-16)
- **Area:** `docs/06-interface.md`
- **Evidence:** S144
- **Amends:**
  - ADR-0021: a mention can name another thread's agent, by its thread's name;
    its first mention in a thread invites it, and later ones ask it.
  - ADR-0048: an agent can queue a card, in another thread's dock, by asking
    that thread's agent while it is busy.
  - ADR-0077: a run another thread asked for has its verdict in that thread.
  - ADR-0126: an ask card is a kind of card of its own, only ever queued,
    which a person may reorder and nobody moves.
- **Amended by:**
  - ADR-0144: a run's request spends its output and the context new since the
    run's previous request, not pi's `totalTokens`.
  - ADR-0160: a budget chosen in the composer, a top-up, dismissing a member,
    a relayed run's verdict in the asking thread and the asked thread's
    "talking in" header are shelved; `read_thread` is still to build.
  - ADR-0178: an owner's answer to a lane's ssh request wakes that lane, as an
    answer to an agent's ask wakes the asker. A refusal wakes nobody.

**Context.** Each thread has at most one agent, its lane's (ADR-0019,
ADR-0021), and `@agent` names it. A common wish is to bring another
thread's agent in for a while: "Please talk to @amber-fox about this",
typed in thread A, so that A's agent and amber-fox's can discuss it, with
people watching and joining in. What that needs:

- **People can read it.** Everything said between agents is in the tree,
  where people can read it and join in at any point.
- **It ends.** Two agents that answer each other can go on for ever. Other
  systems end it with a done word the model must say (CAMEL, AutoGen's
  `TextMentionTermination`), a step limit (LangGraph's `recursion_limit`),
  or a rule that an automatic reply is never answered (IRC's `NOTICE`, RFC
  1459; email's `Auto-Submitted`, RFC 3834). Only a limit and a rule hold
  without trusting the model.
- **An agent keeps quiet unless asked.** With three or more agents, one
  that speaks whenever it could costs money and drowns the thread. Selecting
  the next speaker with a model (AutoGen's `SelectorGroupChat`) costs a
  request a turn; a mention is free and can be read.
- **The agent that comes keeps its memory.** An agent that "leaves and
  comes back" loses what it heard. So the invited agent works in its own
  thread and lane, and what it hears in A reaches it there.

S144 measured what pi does for this: a thread can read another root's
entries at each request, but compaction keeps none of it; pi reports tokens
per request and per lane, and a run can be stopped before its next request;
lanes run at once; and a tool can start another lane's run without waiting.

**Decision.**

*Who can be asked.*

- **Another thread's agent is named by its thread's name** (ADR-0039):
  `@amber-fox`. `@agent` is still the agent of the thread you are in. A
  mention reaches the threads on **any open task's canvas**, which the
  composer offers as you type; every root of an open task is loaded
  already, and names are unique across the session. A thread with no lane
  has no agent to name.
- **A member out of reach is refused with why.** A thread in an archived
  task, taken into an inventory (ADR-0124), or with no card any more runs
  nothing: an ask of it says so ("amber-fox's task was archived by Bea",
  "Bea has amber-fox"), and its root is never opened to find out. The
  column's header names such a member as away. An ask waiting as a card
  whose asker went out of reach since is refused the same way.
- **A mention in code is no mention.** A `@word-word` in an inline code
  span or a fenced block is text, for people as for agents, so pasted code
  or a log line invites nobody.
- **The first mention of another thread's agent invites it.** It becomes
  a **member** of the thread, and is told, but not asked; the message goes
  where it would have gone without that mention (ADR-0021). Where that is
  nobody, as in a conversation, the agents it invites are asked. So
  "Please talk to @amber-fox about this", sent in agent work, invites
  amber-fox and asks the thread's own agent, which then asks amber-fox.
- **A member's mention asks it.** A message that names nobody asks no
  member. Several agents named in one message are asked at once, each
  reading the thread as it was sent.
- **A thread's members are read from its path**, as its mode is
  (ADR-0021): a message's invites add them, and a fact entry for a
  dismissal or a leave removes one. Nothing else is stored, so a branch
  has the members its thread had where it forked. They are shown in the
  column's header. Anyone in the thread can dismiss one, and an agent can
  leave by a tool. Membership has no end of its own: a spent budget stops
  what agents start, but not membership.
- **The send button says what will happen**: "invite amber-fox · send to
  agent", "send to amber-fox", "send to amber-fox +1".

*How agents speak.*

- **An agent asks another with a tool**, `ask`, never by an `@` in its
  reply: an `@` an agent writes is text, and asks nobody. The obligation is
  a value, and the tool can answer.
- **`ask` never waits for the answer.** It returns at once: "asked",
  "queued behind Bea's card", "held by Bea", or refused, with why. Two
  agents that waited on each other would never finish (S144).
- **An ask to a busy agent is an ask card in its thread's dock**: a card
  of its own kind (ADR-0126), only ever queued, made by the host for the
  person behind the chain, and saying which thread it came from. People
  there see it and can reorder it; nobody moves it, so it is never a note.
  A held queue waits for a person, as any card does (ADR-0048), and Stop
  ends the run it starts.
- **An answer to an agent's ask wakes the agent that asked, and nothing
  else wakes anyone.** The asked agent's last message of its run is posted
  in the asker's thread as its message. Where the asker is idle, that
  starts its run; where it is running, the answer is steered into the run,
  as canvas news is. An answer to a person's ask wakes nobody, and what an
  agent writes back to an answer asks nobody unless it asks again. So two
  agents can keep talking only by asking, and every ask is spent from a
  budget.

*What the asked agent reads, and where it works.*

- **It works in its own thread, with its own lane, files, tools and
  pinned cards.** Its run's tool rows stay in its thread; only its last
  message goes to the thread that asked, with a link to the run.
- **Before each ask, what it has not heard is copied into its thread**:
  the asking thread's entries since its last turn there, or since it was
  invited, as one **heard** entry: the entries' attributed text, frozen as
  a chat's is (`attributed`, `packages/rules/chat.ts`), and the thread and
  entry ids it came from. Its column draws it folded, "heard in
  sable-meadow: 4 messages", linking there. What an agent has heard is
  read from its own path, the newest heard entry from that thread, as
  what a thread was told of its base is (ADR-0080): each entry is copied
  once, and again only past a compaction, which summarised it. S144 found a reference drawn in at each
  request works for a run but is gone at compaction, and needs the other
  root loaded at every request.
- **Its own people see it**: the heard entry, the ask and its answer are in
  its thread, and their own asks queue behind, as any are. A row from a
  thread on another task says which task, and opens it.
- **An answer to a thread gone out of reach is not sent.** Archiving
  refuses only a busy task (ADR-0122), and an asker waiting for an answer
  is not busy, so its task can be archived meanwhile. The answering thread
  is told instead, as an `undelivered` fact.

*A budget of tokens.*

- **A person's message that asks an agent sets a budget**, a number of
  tokens, the person's default (set in their config) unless they change it
  in the composer, which shows it before sending.
- **What agents start is spent from it; what people ask for is not.** The
  run a person's message asks for is not counted, as no run is today.
  Every run started by an ask or an answer in its chain is counted, and so
  are the requests made for those runs: the verdict and digest
  (ADR-0075, ADR-0077), and the round's next step (below).
- **A request counts pi's `totalTokens`**: input, output and cache reads
  and writes, as pi reports them per request and per lane (S144).
- **It is checked before each model request**, so a run overruns it by at
  most the request that crosses it (S144). A spent budget stops that run
  as Stop does: its stop is a fact (ADR-0126) naming the person whose
  message set the budget, and that the budget was spent, so the run's end
  reads as stopped by them; the asked thread's queue is not held, since it
  is its own people's. The host
  writes a fact in the thread whose message set the budget: "agents spent
  the budget of 200k tokens". The fact offers more. After it,
  an `ask` is refused "the budget is spent", and an answer wakes nobody.
- **Each person's message sets a budget of its own.** The thread's header
  shows the budget being spent while agents talk.

*After a round.*

- **When every agent asked by one person's message has answered**, and
  there were two or more, one small request decides what comes next, as a
  value: nothing; ask one of them to answer another; or tell the people.
  Its prompt is a skill, so a project can change it. A reply in any other
  shape is nothing (ADR-0067). It is spent from the budget.

*Reading another thread.*

- **An agent can read any thread in reach with a tool**, `read_thread`,
  as far as a mention reaches: any open task's canvas. It reads in steps
  of growing cost: a thread's asks with their digests (ADR-0075), then its
  entries, a page at a time, with a cap on a page. Which threads its own
  task has, and whether each is working, every run is told already, in the
  canvas list (ADR-0116). The result says how many tokens it holds. Each
  read is a tool row in the reader's thread, so people see what it read,
  and in a run an agent started its tokens are spent from the budget like
  any other.

*Stop and attention.*

- **Stop in a thread stops the runs its messages started**, in other
  threads too. Stop in the asked agent's thread stops its own run.
- **A run another thread asked for has its verdict in that thread**, for
  its followers (ADR-0077): the answer went there. The asked agent's own
  thread shows the run as "talking in sable-meadow".

**Consequences.**

- **What an agent heard is copied into its thread**, so storage grows by
  each heard entry, once per agent that hears it, and again past its
  compactions. pi reads it as it reads a
  chat, so compaction, the prompt cache and a restart need nothing new.
- **`address` (`packages/core`) learns agents other than the host's
  own.** `AgentId` already allows more than one; `parseMentions` reads any
  handle other than `agent` as a person, so a thread's name is matched
  first, and a person's name a thread could have is refused from now on.
- **A run's origin is its prompt**: a relayed ask or an answer names the
  thread it came from and the budget it spends, so a run resumed after a
  restart still knows where to answer and what to spend.
- **`complete` (`packages/pi/config.ts`) must return a request's usage**,
  which it drops now (S144), so a run's verdict and digest can be counted.
- **New words** for `docs/glossary.md`: member, invite, budget, heard.
  **ask** keeps its meaning, the message that started a run (ADR-0106): an
  agent's ask starts a run in another thread.
- **A conversation can still run long**, within its budget, and a person
  can stop it at any point.

**Alternatives rejected.**

- **The same task's canvas only.** Readable, since the other column is on
  screen, but two open threads on different tasks could not talk, which is
  the common case.
- **Any named thread in the session.** It reaches archived tasks, whose
  roots are unloaded and whose threads are read only, and threads in
  inventories, which nobody else may run: every ask would need checks the
  open-task reach gives for free.
- **Members as a record on the thread.** A second copy of what its
  messages say, which a branch would not inherit, and which archiving and
  startup would have to sweep.
- **A thread with several lanes.** Breaks "a thread's mode is its lane"
  (ADR-0021), and an agent that only visits a thread forgets what it heard
  there when it leaves.
- **A mention in an agent's reply asks.** Agents would ask without meaning
  to, and nothing could say "busy" or "queued" back.
- **`ask` waits for the answer**, as a tool call that returns it. Two agents
  asking each other would wait for ever.
- **Answering busy with "would you like to queue it?"** Costs the asker a
  turn for an answer that is nearly always yes; the queued card can be
  unqueued.
- **Every reply wakes whoever it answers.** Two agents thanking each other
  never stop: CAMEL's role-play loops.
- **A done word, or a step limit alone.** A done word trusts the model; a
  step count does not say what a step cost.
- **A budget of money.** It is what matters, but the price per token
  differs by model and provider, and some are a subscription. Tokens are
  what pi counts for every model.
- **A model picks the next speaker every turn** (AutoGen's
  `SelectorGroupChat`). A request each turn, where a mention costs
  nothing. A request once a round, after several agents answered, is kept
  for where intent is unclear.
- **A reference to the other thread's entries, drawn in at each request**
  (an entry projector, S144). Gone at compaction, and the other root must
  be loaded for every request.
- **Agents read every message in a thread they are in.** Every message
  would cost every member a request, asked or not.
- **No reading of other threads.** Then an agent must ask, and the asked
  agent rereads its whole context to answer, which costs more than reading
  a digest.
