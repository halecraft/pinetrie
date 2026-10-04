# ADR-0074 — A model titles a root when its first lane starts, and again when asked

Numbered 0072 until 2026-10-04, when two files held that number.

**Status:** Accepted. Implementation: `PLAN-2026-10-05-auto-titles`. Amends
ADR-0045 (the agent may write a root's mark, and a root no agent works in is
labelled `Chat`).

**Context.** A root tab's label is its title, else its first message's first
line (ADR-0045). The first line is often a preamble ("I'd like to start
talking about…"), and a title is set only when someone opens Rename, which
is rare. So most tabs are named by their first sentence, and several open
tabs cannot be told apart. ADR-0045 left room for this: "A title the agent
suggests ... is possible later, and a person's title would win over it."

The host already asks a model for text outside every thread:
`Agent.complete` writes an offer's commit message (ADR-0038) and an ask's
digest (ADR-0056), with no tools and no session, so nothing enters the tree
or a lane's context. Banners (ADR-0050) separate one made automatically
(`bannerDue`) from one a person asks for (`planAsk`): an automatic one gives
way to whatever was written meanwhile, and a requested one is always
written.

**Decision.**
- **A root's first lane titles it.** When a lane is created in a root that
  no other lane works in, and the root has no mark, the host asks a model
  for one to three words from the messages above where the lane starts and
  the message that starts it. The request goes out as the lane is created,
  beside the run, not at the run's end. A root that began as a chat is
  titled when the agent is first asked there. Its mark is written `by` the
  agent.
- **The title is a mark** (`pineta.mark`, ADR-0045), so it names the root
  everywhere a title does and Rename edits it. The run writes the root's
  first entry, so a title that comes back first waits for it, at most
  30 seconds.
- **A person's title wins.** A mark written while the request was out is
  kept, and nothing is asked for a root that has one.
- **Auto-update title**, in a root tab's `⋯`, is a person's request (a
  `retitle` command). It is asked from the path to the root's newest
  message, the first message always kept. Its title replaces whatever is
  stored, and is written `by` that person. An archived root refuses it.
- **A root no lane works in is labelled `Chat`**, not by its first line:
  only people have written there. A title still names it.
- **On by default.** `{ "titles": { "enabled": false } }` in the user config
  stops the automatic title; Auto-update still works. `titles.model`
  (`provider/id`) picks the model, by default the run's. One pi does not
  have is logged at start, and the run's is used.
- **A reply that is not a title is dropped:** more than five words, more
  than one line, or longer than a title may be. The root keeps its label.
  A reply is never cut.

**Consequences.** Each new agent root costs one small model request. The
Line gains a command (`retitle`) and an outcome (`retitling`), so clients
and host ship together. `MarkRecord.by` names a person or the agent; no
decision reads it. The tab does not say who titled it. The suites' user
config turns the automatic title off, so their tabs keep their first lines.

**Alternatives rejected.** A title at the first run's end (the reply is
better context, but the tab waits for the whole run). Updating the title on
later runs while the agent's title stands (the label would change under
the reader; Auto-update is the deliberate way). A title from the client
(only the host holds a model). Cutting a long reply to three words (it can
leave "Fixing the"). Storing `Chat` as a mark (ADR-0045: a stored default
reads as chosen). Opt-in, as banners are (a title is cheap, and the reason
for the feature is that nobody sets one).
