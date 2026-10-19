# S272 — A text client draws a thread, an ask's digest and the composer from interface's index alone, as a unit test, and a client with no canvas needs no intent

- **Status:** Answered
- **Led to:** ADR-0194

**Question.** The proof that `@pinetrie/interface` is the contract any
client shares would be a second client in a test, drawing from
`@pinetrie/session` and `@pinetrie/interface` alone.

1. Can a text client draw a thread's messages and asks, an ask's digest
   and the composer's button from interface's index, without a host, in a
   unit test? What does it need from elsewhere?
2. How much of the page's assembly (which views it calls, with which
   facts) does it repeat, and does interface hold any of it?
3. Can a client with no canvas (Slack-like) and a program as a client
   (MCP-like) be covered as cheaply?
4. How is "alone" enforced?

**Kill criterion.** If the text client cannot draw a thread without
importing rules, reads or a module of the page, interface is not yet a
contract to prove, and the plan moves decisions first and adds the client
after.

**Throw away.** The prototype, kept in this spike's folder since the plan
builds on it.

## Answers

1. **Yes.** The prototype (`text-client.test.ts`) builds a root document
   with two entries, a lane's tip and a final digest, as the reads tests
   do, and draws:

   ```
   msg e1
   ask Fix the bug | 1 step
     digest: Fixed the bug
   composer: [send to agent]
   ```

   It runs in about 15 ms. Drawing takes from interface's index only
   `readSessionFacts`, `projectColumns`, `segmentPath`, `columnRows`,
   `askView`, `askLine`, `readHeldLanes`, `planSend` and `sendButton`, and
   from core `threadLane` and the index's `endOf`: vocabulary and the
   tree's reads, which ADR-0093 leaves in core. **The kill criterion is not
   met.**

   **What a fuller client would need from elsewhere is what the page
   takes directly** (S271): a digest's points as text (`pointsText`,
   rules), the composer's participants and agents (`participantsIn`,
   reads; `agentCandidates`, core), a message's blocks as an address
   numbers them (`markBlocks`, rules). Each fails the client as it fails
   the page, so moving them into interface serves both.
2. **About forty lines of assembly**, which the page spreads across
   `App`, `Column` and `message-list.tsx`: a column's spec from its
   thread's end, its path's nodes into segments and rows, each ask's
   view, the held lanes, the composer's plan. Interface holds none of it,
   on purpose: the page memoises each projection on its own inputs (S54,
   S59), so one function assembling a screen would give every memoised
   component new props each render. An assembly in interface that only
   the text client called would drift from the page's. **So the client's
   assembly is the client's**, as a terminal's would be, and what the
   test proves is narrower and exact: each view it draws is in interface,
   and gives what the client draws. A decision that moves into the page
   fails it only if the client draws that surface; the manifest's fence
   (S271) catches the rest, a decision made from rules or reads.
3. **Both are cheap, and neither uses an intent.** `planIntent` takes an
   `IntentState` of the page's `Layout`, the sidebar's `ListWidth`, the
   page over the stage and the search: the input chain is the canvas
   page's interaction model. A client with no canvas reads what needs you
   (`attentionItems`, whose input names no layout), the inbox
   (`inboxMentions`) and one thread as above, and replies through
   `SessionClient.send` with the `SendHow` that `planSend` decides. A
   program as a client is that client without drawing; the e2e suites'
   `join` (`apps/pinetrie/e2e/harness.ts`) already drives a host through
   `@pinetrie/session` from Node, so the unit test need not start a host.
4. **By resolution, if the client is a workspace package of its own** that
   declares only `@pinetrie/interface`, `@pinetrie/session` and
   `@pinetrie/core`. A test inside `packages/interface` could import any of
   interface's modules, and a devDependency resolves for production code
   as a dependency does, so the client's arranging goes through
   `@pinetrie/interface/fixtures`, which may import what interface
   declares: writers of an entry, a lane's tip and a digest join its
   trees. The prototype imported `@pinetrie/rules` and
   `@pinetrie/schema/fixtures` to arrange, which the package would not.
   `apps/conformance` is the precedent: an app that exists to hold a
   contract. Nothing reaches it from the published package's entry, so
   it is not shipped (`scripts/package.ts` copies what the entry's graph
   reaches).

**Measured** 2026-10-19 with Vitest 5.0.5, from the workspace.

**Sources,** in this spike's folder: `text-client.test.ts`, the prototype;
it ran from `packages/interface/` and is not maintained.
