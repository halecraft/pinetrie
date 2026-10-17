# ADR-0176 — A lane's system prompt lives in its transcript: a run adds what changed as a system message, every request leads with the transcript's prompt and tools, and a reply keeps a count of the thinking dropped, not the list

Numbered 0169, then 0171, until 2026-10-18, when two files held each number, or a plan in flight had taken it.

- **Status:** Accepted (Duane, 2026-10-18)
- **Area:** `packages/pi/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`,
  `packages/interface/TECHNICAL.md`
- **Evidence:** S85, S221, S244

**Context.**

- **A host start can give every lane a new prefix.** pi's stable harness
  calls pine·trie's `systemPrompt` for every request and sends it whole,
  with the tools, before the messages. The prompt holds the project's
  context files (`AGENTS.md`) and the skills' list, read once per process,
  so a host started after either changed sends every lane a new prefix at
  its next request (S244 items 2, 3). `AGENTS.md` changed five times in
  three days in pine·trie's own repo.
- **A new prefix costs the lane its reasoning and its cache.** Anthropic
  drops every earlier thinking block whose prefix changed, for good, and
  the whole prompt is written to the cache again: about $1.78 instead of
  $0.07 for a 355,000-token lane on Opus 5.5 (S85, S244 item 4). Every
  provider that caches by prefix loses its cache the same way.
- **The report of it fills the store.** pi-ai stores Anthropic's
  `input_transformations` on each reply (`diagnostics`), and since the
  dropped blocks are sent again on every request, every later reply lists
  them all again: 161 MB of Duane's 832 MB of documents (S221 item 4).
- **pi keeps a prompt in the transcript, and pi-ai sends that to every
  model.** pi's own coding agent builds its prompt as named sections and
  appends a `{ role: "system", sections }` message with what changed
  (S244 item 6). Every pi-ai adapter reads the transcript the same way: a
  model that takes a mid-conversation system message (85 in pi's model
  data, across 11 providers) is sent the change where it stands, with its
  prefix byte for byte as before; any other has the change folded into
  its leading prompt, by section, and is sent exactly the prompt a fresh
  build makes (S244 items 5, 7, 8).
- **Only one shape is right on every model:** the prompt as sections and
  the tools, together in the leading system message, with no separate
  `systemPrompt` or `tools`. A prompt sent as one string beside a later
  section duplicates the section on a model that folds it; sections beside
  a separate tool list put the prompt after the first user message (S244
  items 7, 9).
- **pi's harness cannot send that shape by itself.** It always hands the
  provider layer its own `systemPrompt` and `tools`; its
  `transform_context` hook cannot drop the tools, and a lane without
  active tools cannot call any. The `Models` pine·trie passes the harness
  is the one seam that sees every request before pi-ai, whatever the
  provider (S244 item 11).

**Decision.**

- **A lane's prompt is the system messages on its path since its last
  compaction.** pine·trie builds the prompt as pi's named sections
  (`buildSystemPromptSections`), as it builds it today.
- **A run adds what changed.** When a run starts, the sections built now
  are diffed (`diffSystemPromptSections`, pi's) with the sections in view:
  the system messages of the entries the lane's next request reads, as pi
  scans them, folded by pi-ai's `getCurrentSystemMessage` (S244 item 15).
  What differs goes in as one system message of those sections, in the
  same `lane.prompt` as the run's prompt and the messages before it. A
  path that holds none (a new lane, a lane from before this decision) is
  given every section.
- **A compaction carries the prompt.** The `before_compaction` hook folds
  the system messages it summarises into one and puts it at the head of
  pi's retained tail, as it carries the pinned cards (S244 item 16).
- **Every request leads with that prompt and the tools.** The `Models`
  pine·trie hands the harness rewrites a request whose messages hold a
  system message: the first one, with the request's tools as its
  `toolsAdded`, leads; the harness's `systemPrompt` and `tools` are
  dropped; later system messages stay where they are. A request with
  none (a compaction's or a summary's, which do not go through
  `streamSimple`, or a lane's from before this decision) passes through
  as the harness made it.
- **A change is logged by the sections it adds,** at the run that adds
  it: `[host] <thread>: the model's prompt changed: project_context`.
  The prefix log (`prefix.ts`) goes: it keeps the last prefix in memory, so
  it cannot see a restart, the one way the prefix changes now. A reply's
  stored count of dropped blocks is what shows a changed prefix, across
  restarts.
- **A reply keeps how many thinking blocks were dropped, not which.**
  An `after_response` hook stores each `anthropic_input_transformations`
  diagnostic as its count (S244 item 17); the stored lists are counted,
  then shrunk to their counts by a record migration. No provider is sent
  a reply's diagnostics, so the prefix stays.
- **The page shows no system message.** `renderableMessage` admits no
  `system` role, as now, and an edit of a prompt sends again from above
  the system message its run wrote, as from above its context entries.

**Consequences.**

- A host start leaves every lane's prefix as it was; a changed
  `AGENTS.md` or skill reaches each lane at its next run as one system
  message, and costs it no thinking and no cache before that message.
- A model without mid-conversation system messages is sent today's prompt
  for a replaced section; a section new to the lane comes after the
  others rather than in its usual place. Nothing in the decision names a
  provider or a model.
- A branch inherits its parent's system messages, so it shares its
  parent's prefix, and its cache, until it changes.
- A lane's first run under this decision adds every section. Its prefix is
  then what a fresh build gives (`buildSystemPrompt` renders the same
  sections), so it costs nothing more than a host start does today.
- **Not covered.** A run resumed after a crash continues on the prompt its
  path holds until its next run. A tool whose definition changes still
  changes the prefix: pi-ai sends a redefined tool whole. A compaction
  changes the prefix as it does now (its summary replaces what came
  before), and keeps the prompt it carries.
- The wrapper depends on the harness handing `models.streamSimple` a
  `systemPrompt`, `tools` and messages; a pi upgrade that changes that
  breaks it, and a unit test of the request shape says so.

**Alternatives rejected.**

- **Fix only the storage,** and pay a dropped context and a cache write
  per lane per change. The cause is pine·trie's, and pi has the remedy.
- **Freeze a lane's prompt until its next compaction.** The same on every
  model, but a long lane would work for days on an `AGENTS.md` it no
  longer has.
- **Rewrite each provider's payload in `before_payload`.** It works per
  provider, and pine·trie would keep a copy of each one's wire format.
- **Lift the transcript's prompt in `transform_context`.** The hook cannot
  remove the harness's tools, and sections beside a separate tool list
  move the prompt behind the first user message (S244 item 9).
- **Pi's experimental `pico3` harness,** which keeps system sections as
  conversation entries. It is experimental, and moving to it is a change of
  harness, not of the prompt.
