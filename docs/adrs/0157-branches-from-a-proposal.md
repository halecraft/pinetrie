# ADR-0157 — The agent proposes branches with a tool; one press by a person opens them, or opens and starts them, at the proposal's fork

- **Status:** Accepted (Duane, 2026-10-16)
- **Area:** `docs/06-interface.md`
- **Evidence:** S218
- **Amends:**
  - ADR-0080: an agent-callable tool may propose what only a person may do:
    `propose_branches` writes only its own call, and the threads it proposes
    start at a person's press.
- **Revised:**
  - 2026-10-16 (S218): the proposal is drawn below its ask's last word,
    outside the fold; its branches are ranked in its order, each after the one
    before; Open's drafts are written by the presser's page; Send K is the
    host's; others see Open's branches, folded.
  - 2026-10-16: Send K is the page's sends, one per draft, as its column's
    composer would send it, and leaves no fact; whether a proposal is spent is
    read from its branches' thread records, whose fork names it and its row; a
    branch's fork row names its item.
  - 2026-10-16: Open writes no draft: an opened branch's composer starts with
    its brief, derived from its record and the proposal, for the presser
    alone; a brief edited before the press is kept by the pressing page. The
    host builds Start's messages from the briefs, so every branch asks the
    agent. A run that ended on a tool result forks at its last word.

**Context.** A person and the agent discuss tech debt, and the agent lists
the three things most worth fixing. The person wants three threads, each
researching one of them, each starting from the conversation so far.

Today that means pressing `→` on the agent's message three times and
typing or pasting each brief after `@agent `. Each branch already has
everything else it needs: the path above its fork, and a lane with the
files as they were at that turn (`docs/00-vision.md`). The cost is the
copying, and it grows with the list. With ten items, opening, pasting and
sending each one is a chore, when the agent's briefs are probably right
and reading one or two is enough to confirm it.

ADR-0080 lets the agent call a command only when its effect stays inside
its own thread. Starting threads writes where others read (the canvas,
the board) and starts runs, each with its own lane and cost. So the agent
cannot start them itself. The host cannot reliably parse a list out of
the agent's prose, and the agent knows best how to split the work.

**Decision.**

- **A tool, `propose_branches`**, with `branches`: a list of
  `{ title, brief }`, each non-empty. It writes nothing but its own call
  and result. The result tells the agent the proposal waits for a person.
  Every lane is given it, as every tool is (ADR-0080).
- **The proposal is drawn as one card**, from the tool's call in the
  thread, below the ask's last word: an ask's tool rows fold under its
  digest line, where it would be hidden (S218 item 7). It lists its
  titles, each brief folded to its first line. A row opens to
  edit its brief, and × drops it. Edits stay in the page until a press:
  the place to edit at length is Open's drafts.
- **Its branches fork at the end of the run that proposed them**, so each
  reads the run's last word, usually the list itself. They fork at its last
  entry, even a tool result a Stop left last, as a reply after a Stop
  follows it: forking at the message before would leave its tool call with
  no result. The buttons wait until that run ends; a later run of the
  thread does not hold them.
- **Two buttons, counting the rows kept:**
  - **Start N**, the main one: one host command opens N branches at the
    fork and sends each one's first message, `@agent <brief>`, as the
    presser, through the path a page's send takes (S218 item 3). The host
    builds each message from its brief, so every branch asks the agent,
    whatever its brief mentions. Their runs start. They land folded, and the column you are reading stays in
    view.
  - **Open N**, smaller: one host command opens the same N branches,
    their ids minted by the presser's page. Nothing is written in them:
    each one's composer starts with `@agent <brief>`, derived from its
    record and the proposal, on every device of the presser's, and a card
    is made only once they type, as in any composer. The host writes no
    card's text (S218 item 5), and a written draft would leave empty
    branches if the page closed before writing it. A brief edited in the
    card before the press is kept by the pressing page as that composer's
    start. The pressing page unfolds them, so each brief can be read and
    edited: the canvas scrolls sideways. The presser's other devices, and
    everyone else, see them folded: an opened branch is on the canvas for
    everyone (S218 item 6), and only its draft is the presser's alone.
- **Opened drafts can be sent together.** After Open, the card offers
  **Send K**, where K is the presser's opened branches that are still
  unsent. The presser's page sends each one's composer text as that
  column's composer would, one ordinary send each, which spends its card
  where they typed one.
  A tab closed halfway leaves the rest as drafts, which the next Send K
  offers again. Start is Open followed by Send N, so this is one mechanism
  with two entry points.
- **The branches open after the proposing thread, in the proposal's
  order**: each is ranked after the one before, since a branch alone lands
  just after its parent and N would land reversed (S218 item 2). Each is
  an ordinary thread: its own lane, forked from the proposing run's last
  turn, and members as they were at the fork. Its thread record's fork
  names the proposal and its row, so its fork row names its item: "↰ from
  Ada's proposal: Fix the sync bug".
- **A proposal is spent once Start or Open lands**, and cannot be pressed
  again. That is read from its branches' thread records, written in the
  same step as the press, so a second press is refused at once. A new call
  makes a new proposal.
- **Start and Open each leave a fact in the proposing thread**
  (ADR-0080): "Ada started 10 branches", "Ada opened 10 branches". The
  fact tells the agent and people what happened; the card's state does not
  depend on it, since a fact can wait in the queue while a later run runs.
- **Anyone who can send in the thread can press.** Drafts belong to the
  presser alone, and the card says whose they are: "opened by Ada · 7
  unsent".

**Consequences.**

- Adding a tool changes the tool list, which is part of every request's
  prefix (`packages/core/tools.ts`). Each lane drops its earlier thinking
  once.
- **No limit on runs at once.** Starting ten branches starts ten runs, and
  the person keeps that within what the host and the model's rate limits
  allow. A pool of runs is a later decision.
- **Results come back by hand.** Each branch's last word is dragged into
  the proposing thread as a card. A branch that reports back on its own
  (a fact in its parent, or an answer as `ask` posts one, ADR-0128) is a
  later decision.
- Open puts N columns on everyone's canvas before anything is sent:
  folded for them, with no message in them.

**Alternatives rejected.**

- **The tool starts the threads itself.** That breaks ADR-0080: it writes
  where others read, and spends lanes and runs on the agent's own
  judgement. It also makes the threads hidden subagents, when pine·trie's
  point is work people can see and join.
- **A host command that splits a message's list into branches.** Parsing
  prose is fragile, and the agent is better placed to split the work and
  brief each part.
- **The tool opens N draft columns directly.** N columns crowd the canvas
  before anything has happened, and sending them is N presses.
- **Start only.** No way to adjust several briefs before they run.
- **Open only.** N sends for N branches, the chore this exists to remove.
- **Open lands folded.** Open is for reading and editing the briefs, and
  the canvas scrolls sideways (Duane).
- **Words in the person's message ("start them all") stand for the
  press.** ADR-0080 has a tool check the state it acts on, never how the
  run began. One press costs little; revisit if it proves a chore.
