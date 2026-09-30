# ADR-0007 — Host↔client transport is a Kyneta Line plus replicated docs

**Status:** Accepted

**Context.** `pi-client` ships unix transport only — there is no browser path in
pi. Kyneta already has `Line` (`packages/exchange/src/line.ts`): a reliable
bidirectional message stream over two authoritative docs with seq numbering and
ack-based pruning, plus websocket/SSE/WebRTC/unix transports.

**Decision.** Commands (prompt, steer, abort, fold) travel over a Kyneta Line.
State (entries, tips, presence) is replicated documents. No bespoke protocol.

**Consequences.** CQRS split, mirroring the shape pi's own experimental stack
arrived at (`AgentController` for commands, `Transcript` for state) — but with a
convergent rather than single-authority state layer. Removes the last reason to
keep chord. Remote/team networking becomes a transport swap.

**CONFIRMED by S4** over a real websocket: all 7 command kinds round-trip in
order, **p50 1.67 ms**, ~1 050 commands/sec, 2 000 commands with **1.01×**
outbox growth (ack-pruning works). Structured rejections survive the wire, as
does the ADR-0011 lane name.

**New constraint from ADR-0013:** transcript events carry `seq`, which is
**replica-local**. Clients must treat it as an opaque ordering key, never a
durable identifier.
