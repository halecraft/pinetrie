# `apps/tui` — technical notes

A terminal client, as far as it needs to be to prove that
`@pinetrie/interface` is the contract any client shares (ADR-0194): it
draws a thread as lines, and answers what a client with no canvas would,
from interface's index and the session alone. It has no way to start yet,
so nothing ships it; its tests run with the unit tests.

## What holds it to interface

- **Resolution.** It declares `@pinetrie/interface`, `@pinetrie/session`
  and `@pinetrie/core`, and nothing else (`workspace.test.ts`). A view it
  draws by that leaves interface's index fails its tests; a decision taken
  from `@pinetrie/rules` or `@pinetrie/reads` does not resolve.
- **Exhaustive switches.** `draw.ts` switches over `ColumnRow` and
  `AskRow` with `assertNever`, so a kind interface adds fails the type
  check here until a terminal draws it.
- **`satisfies AppPorts`.** `ports.ts` holds every port of interface's
  input chain, so a new port fails the type check here until a terminal
  says what it does with it. A port whose signature names a browser type
  already fails interface's own check.
- **The pure config.** `tsconfig.pure.json` checks it with no DOM, no Node
  types and only the globals `pure-globals.d.ts` declares.

## What is here

| module | what it does |
|---|---|
| `draw.ts` | `threadLines`: a thread's column as lines, its messages, each ask's work as story density draws it (`planAskWork`), the ask's digest with its points where interface anchors it, and the composer's button (`planSend`, `sendButton`) |
| `inbox.ts` | a client with no canvas: what needs you (`needsYouLines`, from `attentionItems` and `attentionWords`), the messages that mention you (`mentionLines`), and where a reply goes (`replyTarget`): a thread's end when `planSend` replies, nowhere when it would branch or queue, since both name a place on a canvas |
| `ports.ts` | `terminalPorts`: interface's `AppPorts`, each noting what it was asked, doing nothing (flights, focus), or landing a fold at once |

## Gotchas

- **Its assembly is its own.** Which views it calls, with which facts, is
  this client's, as the page's is in its components; interface keeps its
  projections separate so the page can memoise each (S54, S59). What the
  tests prove is that each view drawn here is in interface and gives what
  is drawn.
- **Arranging goes through `@pinetrie/interface/fixtures`**
  (`writeMessage`, `storedChat`, `writeLaneTip`, `writeDigest`, the
  documents' makers), since a test here resolves only what the client
  declares.
- **A client with no canvas plans no intent.** `planIntent` reads the
  page's `Layout`; such a client acts through `SessionClient.send`.
