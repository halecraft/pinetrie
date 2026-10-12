# `@pinetrie/protocol`: technical notes

The contract between the host and its clients: commands over a Kyneta Line,
and state over replicated documents (ADR-0007). `messages.ts` holds the
wire's shapes as plain values and imports nothing; `line.ts` binds them to a
Line; `codec.ts` turns them into `@pinetrie/core`'s `Intent` and `Outcome`
and back; `writers.ts` says who may write each document.

## The wire (`messages.ts`, `line.ts`)

- **A kind is declared once.** `COMMAND_KINDS` and `OUTCOME_KINDS` are
  spread into the Line's constrained literals, so a kind outside them is
  refused at the wire, and one added to the list reaches it with nothing
  else to edit.
- **The Line carries only its schema's fields.** A field the codec writes
  that `line.ts` leaves out never reaches the host (`line.test.ts`).
- **No `seq` crosses the wire** (ADR-0013): it is a replica-local arrival
  index, and an entry's `id` is what names it everywhere. `Command` and
  `Reply` are exact interfaces, so adding one is a compile error.
- **The host is found by its principal** (`HOST_PRINCIPAL`, ADR-0037): Kyneta
  issues each peer its seat, and the principal is no email, so no person
  can claim it.

## The codec (`codec.ts`)

Kyneta's schemas are total, so on the wire every field is present and `""`
stands for absent. The codec is the one place that knows it
(`docs/01-architecture.md`): it decodes into precise unions, and nothing
past it sees `""`. It owns every shape rule, so the order in which a
malformed command is refused is decided in one function; whether the
host's state allows a well-formed one is `@pinetrie/rules`'.

Each command's fields are documented on `Command`, and rest on these
decisions:

| kind | decisions |
|---|---|
| `chat` | its `ChatAt` (ADR-0117), its root (ADR-0063), its card spent once sent (ADR-0048), the text versions the run waits for (S96: a text can reach the host after its record), its WIP base (ADR-0104), its workflow state (ADR-0122) |
| `picture` | ADR-0098 |
| `carry-on` | ADR-0082 |
| `queue-hold`, `reorder` | ADR-0048 (step 7), ADR-0116 |
| `move` | ADR-0059; its sender's task names a discard's history (ADR-0116) |
| `queue-card` | the one way into a queue, which decides its hold too (ADR-0113) |
| `move-task`, `workflow` | ADR-0122, ADR-0126 |
| `mark` | ADR-0045, ADR-0116 |
| `card-width` | ADR-0116 |
| `retitle` | ADR-0074 |
| `offer` | an acceptance names what it was shown (ADR-0065) |
| `setup`, `publish` | ADR-0104, ADR-0090; `line` is no kind (ADR-0100) |
| `reserve` | ADR-0057 |
| `spin-off` | ADR-0111, ADR-0126 |
| `open-thread` | ADR-0126 |
| `copy-thread` | ADR-0117 |
| `paste` | ADR-0132; it discards the card it replaces first (ADR-0133) |
| `undo-move` | ADR-0066; `""` names your history outside any task (ADR-0126) |
| `set-command` | ADR-0108 |
| `traces-seen` | ADR-0048 |

A new thread's, root's or task's id is in the shape a client mints
(`parseNewThread`, `parseNewRoot`, `parseNewTask`; ADR-0057, ADR-0117). A
move is typed by its card's kind, and refused to or from a place that kind
is never in (ADR-0117); a text card dropped at a spot on a canvas becomes a
note column (`WRAPS`, ADR-0126). A reply's `rev` is the places document's
after its step, which a client draws its move until (ADR-0059).

## Who writes what (`writers.ts`)

`writersPolicy` is registered on every peer, and Kyneta judges `canWrite`
against a peer's own identity for its local writes as well as against the
sender of every offer. So a client's write to a document it may not write
throws before anything is applied: a refused write left in a client's copy
diverges it for good (S28, S76). It judges the sender, not the author, so
the host, which relays a person's documents between their tabs, is one of
their writers though it never writes one.

- **Only the host writes** the session (ADR-0023), the places (ADR-0059),
  what is streaming and every root's document (ADR-0063), and the stacks of
  people's moves (ADR-0066).
- **A person's own documents** (`PERSON_DOC_KINDS`): their inventory
  (ADR-0059), what they have dealt with (ADR-0077), and the tasks they have
  open (ADR-0122). Each is written only by that person's tabs, and shared
  with that person only.
- Presence is ephemeral and never stored (ADR-0024); no policy here names
  it.

## Tests

Unit tests sit beside each module. Mutations on this package are
`scripts/mutations/core.ts`'s entries for `packages/protocol`.
