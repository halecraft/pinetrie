# ADR-0199 — A plan returns reasons, never sentences; each sentence has one owner, chosen by who reads it: rules for the agent, interface for a person, the host for its log

Numbered 0198 until 2026-10-20, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-20)
- **Area:** `docs/01-architecture.md`, `packages/interface/TECHNICAL.md`,
  `packages/rules/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Amends:**
  - ADR-0193: a refusal's words are not the shell's; the plan returns its
    reason, and the owner of its reader words it.

**Context.** ADR-0193 said whether to refuse is the plan's and the
refusal's words are the shell's, in one function per plan. The code did
not agree, and could not: a refusal's words were written in the host's
shell (`openRefusal`, `imageRefusal`, `updateRefusal`), in rules
(`gateRefusal`, `acceptedRefusal`, `getLatestRefusal`), and in protocol's
codec, with no rule between them. Some sat where they did for a reason that
no longer held: `acceptedRefusal`, a person's answer and the publish
button's title, was in rules because rules was the one package the host
and the page both imported, but the host imports interface too. Some
served two readers: `updateRefusal`, in the host, words what the agent's
`catch_up` answers as well as what a popped card says.

What changes a sentence is who reads it: what a model needs from a tool's
answer, what a person needs from a button, what an operator needs from a
log. A function that words for two readers changes for either.

**Decision.**

- **A plan returns reasons, never sentences**: a refusal is a value with
  the facts its words need (`why`, an error code and its record).
- **Each sentence has one owner, chosen by who reads it:**
  - **rules** for every sentence the agent reads (a tool's answer, a fact in
    a thread, a prompt), even when people read it too: a thread's facts are
    both's, and the agent's needs are the stricter;
  - **interface** for a sentence only people read: a command's answer, a
    button's title, a toast (ADR-0093, ADR-0194: what a person sees, and
    its words, for any client);
  - **the host** for its log.
- **The shell words nothing.** It hands a reason to the owner of its
  reader's words: an answer to a person's command is interface's function's
  (the host imports interface for its words, as it does already), a tool's
  answer rules'. A log line may quote a sentence another owner wrote; it
  never words that reason again.
- **Protocol's codec words the refusals of a command whose shape is
  malformed**: its reader is the program that sent it, not a person, and
  only the codec knows the shape.

**Consequences.**

- `acceptedRefusal`, `publishUndone`, `gateRefusal` and `holdingWords` move
  from rules to interface, which the publish button already reads; the host
  answers with them. The card commands' refusal words (`openRefusal`,
  `copyRefusal`, `branchOutRefusal`, `imageRefusal`, `spinOffRefusal`) move
  from the host's shell to interface.
- `updateRefusal` moves from the host to rules: the agent reads it in
  `catch_up`'s answer.
- A sentence the agent reads and a person sees too is worded for the agent.
  Where a person needs other words, interface words the same reason for
  them: two functions over one reason, never one function for two readers.
- The wire still carries a refusal's words with its code. A client that
  needs the reason itself (a program, a terminal in another language) is a
  change of the wire, decided when one does.

**Alternatives rejected.**

- **Words in the shell, as ADR-0193 said.** The host would hold words a
  person reads, which interface owns for every client, and words the agent
  reads, which rules builds everything else the model reads from.
- **Words beside the rule that refuses** (rules for every refusal). One
  package for every reader: a sentence changes for a model and a button at
  once, and interface's words for people would be split across two
  packages.
- **Reasons on the wire, worded by each client, now.** Correct for a
  second client that needs it; a change to every refusal's wire shape that
  no client asks for yet.
