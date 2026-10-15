# S198 — A late write reopens a root the archive let go, or makes a destroyed one again, and nothing reports it

- **Status:** Answered
- **Led to:** ADR-0029

**Question.** The host's own writes that land after a gap (a model
request's settle, a step a run's end queues) do not ask whether their task
was archived meanwhile; only titles do (`apps/pinetrie/host/titles.ts`).
What does such a write do to a root the host has let go?
1. A handle held across `docs.unload`: does it still read, and does a write
   through it throw?
2. A root-homed record (`DIGEST`) written through `Records.writeValues`
   after `docs.unload`: is the root opened again, and the record kept?
3. The same after `docs.destroy`, as a lifted thread's root is
   (`commands/cards.ts`): is the document made again?
4. A run's end whose verdict and digest request is out when the archive
   unloads its root (`apps/pinetrie/host/digests.ts`, `ended`): what does
   its settle do?

**Kill criterion.** If every late write after an unload or a destroy throws
and is logged, without opening anything, the harm is a lost digest and a
log line, and a gate on late writes is tidiness, not a fix.

**Throw away.** One probe, kept as the record of what ran:
`docs/findings/S198-late-writes/probe.ts`, a vitest file run from
`apps/pinetrie/host/` (its imports are that directory's), over a real
`Exchange` on an in-memory store, the real `hostDocuments`,
`createRecords`, keeper and `createDigests`, with a model whose answer the
probe holds back. Its output is `output.txt`.

## Answers

Measured in a lane (Linux, Node 24.21), `@kyneta/exchange` as the workspace
links it, after catching up to accepted work on 2026-10-15.

1. **A held handle still reads after `unload`, and its writes throw.**
   `readTreeIndex` and `readDigests` on it answer what it held;
   `applyRecordWrites` throws `DocumentClosedError: This document was
   unloaded, and is closed.` So a settle that reads through the handle its
   step gathered (`digests.ts` does) reads without complaint, and only a
   write through that same handle would fail.
2. **A root record written after `unload` opens the root again and keeps
   the record.** `Records.writeValues` asks `docs.root`, which loads the
   root from the store: `loaded()` holds it again, `onOpened` fires a
   second time (so the directory follows it again, `directory.ts`), its
   entries are back, and the digest is in it. Nothing lets it go again:
   only an archive (`commands/board.ts`) and the directory's rebuild
   (`directory.ts`) call `docs.unload`, so the archived root stays held
   until the host stops.
3. **A root record written after `destroy` makes the document again**,
   empty but for that record: `stored` goes from false to true, `loaded()`
   holds it, and it has no entries. A root no directory record names now
   sits in the store. Whether peers that were told of the destroy hear of
   it again was not measured.
4. **A run's end settled after the archive's unload writes into the
   archived task, silently.** With the verdict pending and the request
   out, the probe unloaded the root, then let the model answer. The settle
   read the stored digest through the handle its step held (answer 1),
   then wrote the verdict (`said: done`) to the session and the final
   digest to the root through `Records`, which opened the root again
   (answer 2). No failure was reported and nothing was logged.

The kill criterion is not met: a late write does not fail, it reopens. A
gate on late writes is a fix.

Read from source, not run: a fact `relays.ts` queues after an archive
(`queueFact`) is a plain places write, so it leaves a queued card in an
archived task, the state `planArchive` refuses to archive; and the answers
`relays.ended` appends after a run's end go through pi's lane handle, whose
behaviour on an unloaded root was not probed. The gate stops both before
they reach pi or the places, whatever pi would do.
