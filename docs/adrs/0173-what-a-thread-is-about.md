# ADR-0173 — A reader sees what a thread's work is about: a headline for every long ask, a focus for every thread, an intent for every tool call

- **Status:** Accepted (Duane, 2026-10-18)
- **Area:** `docs/06-interface.md`, `docs/glossary.md`,
  `packages/rules/TECHNICAL.md`, `packages/interface/TECHNICAL.md`,
  `packages/pi/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S229, S230, S231, S239
- **Amends:**
  - ADR-0075: every long ask's digest has a headline, and its points come only
    when the work adds to the last word; `nothing to add` is refused, a live
    digest has no points, and a refused final reply deletes the live digest.
  - ADR-0106: an ask's digest is drawn as one summary row, at one place, at
    every density, never in a fold's head.
  - ADR-0077: a run's end, once its reply is written, is followed by a request
    of its own for the thread's focus.
  - ADR-0114: `bash`, `edit` and `write` take a required `intent`, which never
    reaches pi.
  - ADR-0123: in story, a tool row with an intent leads with it, and its
    command is in its detail.
- **Amended by:**
  - ADR-0198: the focus row moves into the details; a strip's tooltip keeps
    it.
  - ADR-0208: a person's own words for a thread are its title, beside the
    focus, which the model keeps writing and never replaces it.

**Context.** Coming back to a column costs a reader too much. Nothing says
what the thread is about: its header names its agent and where it forked.
Its asks' summaries rarely show: the digest skill asked for `nothing to
add` whenever the agent's last message covered the work, and 39 of Duane's
40 newest long asks stored that (S229). Where a headline was stored, story
merged it into its first fold's head and outline drew it on a row of its
own: two places, two looks. And a tool row leads with its command, which a
person who is not a programmer cannot read.

**Decision.**

- **Every long ask's digest has a headline** (`parseDigest`,
  `packages/rules/digest.ts`; the `ask-digest` skill). The skill asks for
  a headline every time, and for points only when the work in between
  adds to the last word: S229's candidate gave 40 of 40 replies in shape,
  with points in 4, each where the last message left something out. Empty
  points are what `nothing to add` said, so the record needs no flag.
  `nothing to add` alone is refused, so a stale skill's reply is never
  drawn as a headline.
- **A live digest has no points, by its type** (`DigestRecord`): only a
  final one carries them. A live reply's points are dropped as it is
  written, and a stored live record with points does not decode.
- **A refused final reply deletes the live digest.** A live headline says
  what the run was doing, which is false once it has ended.
- **An ask's digest is one summary row** (`AskDraw.summary`,
  `planAskWork`): one field with its anchor, after outline's line, else
  after the ask's first fold, else before its work. Outline shows the
  headline alone; story and raw show its points too. A fold's head holds
  the counts and the outcome, never the headline.
- **A thread has a focus**, what it is doing now in a few words, in its
  column's header. After each run's end, once its reply is written, a
  request of its own (the `thread-focus` skill) gives the model the focus
  shown now and the thread's asks, each with its digest's headline, and
  the model names the phase the thread is in or answers `same`. S239: with
  each ask's headline, the focus followed a thread's phases (23 changes in
  82 requests, about 3 of them noise). A focus is refused over 10 words,
  never cut, and an older run's focus never replaces a newer one's. Until
  a thread's first run ends, its header shows its first message's first
  line, dimmed. A focus follows `digests.enabled`. The canvas's title
  stays as ADR-0074 has it.
- **It is a focus, not a topic.** *Topic* names a canvas in Topics
  (ADR-0158), so a thread's is its focus, in the glossary, the page and
  the code (`FocusRecord`, `pinetrie.focus`). Only what no person reads
  says *topic*: the `thread-focus` skill and its request keep the words
  S239 measured them with.
- **`bash`, `edit` and `write` require an `intent`**: what the call is
  for, in a few plain words. Each tool says in its entry whether it takes
  one, and the wrapper drops it before pi's `execute`. S231: no call of 66
  left it out, with pi's strict tools or without, and the intents said
  what each call was for. In story a row with an intent leads with it, its
  command in its detail; raw shows the intent under the command; a copy
  of a message keeps the command. A revision's title and outline's line
  of what an ask is doing use the intent.

**Consequences.**

- Most asks show a summary where they showed none, and a column's header
  says what its thread is doing.
- Each run's end costs one more small request, for the focus.
- Stored digests of the old shape (`headline: null`) and live ones with
  points no longer decode, and are skipped. No migration.
- Adding the `intent` to three tools' schemas redefines them for every
  lane's next request: one full prompt-cache write per lane, once.
- A scripted `bash`, `edit` or `write` call without an `intent` is refused
  by validation, so the suites' scripts give one.

**Alternatives rejected.**

- **A flag on the digest for "adds to the last word".** Empty points carry
  it (S229).
- **A focus that holds unless the subject changes** (S230's skill). It kept
  the focus 76 times in 80, and missed the phases.
- **The focus in the run-end request**, as a third answer. The model would
  name it from one run's work, not the thread's asks and headlines, which
  is not what S239 measured, and before this run's final headline exists.
- **The focus as the canvas's title.** The title stays stable.
- **A setting of its own for focuses.** A focus reads the headlines, so it
  follows `digests.enabled`.
- **An optional `intent`, with words made from the command.** No model
  left it out (S231).
- **A person's own focus.** It would need a rule for when the model may
  replace it: a later decision.
- **A migration for old digests.** A record that does not decode is
  skipped, and no reader or decision sees it.
