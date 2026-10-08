# S113 — pi's storage can come before its harnesses if each document has one session, which its harness closes

- **Status:** Answered
- **Led to:** ADR-0092

**Question.** `Agent` is three things with different needs: the sessions
over each document (`writeValues`, `appendToTree`), what the model setup
gives (`complete`, `skill`, `commands`, `agentDir`, banners), and the
harnesses and their lanes, which need lane work's `access` and `hooks`.
Because the host's writes go through `Agent`, the host makes lane work,
banners, digests, titles, names and baseNews before the agent, and reads it
lazily (`theAgent()` in `apps/pinetrie/host/index.ts`, which throws until
the agent exists). Before the sessions and the models are made first, on
their own:

1. Can a session be written to (values, and an entry with no lane) before
   any harness is made over it, and a harness then be made over it and run
   a lane from that entry?
2. Must the harness be made over the same session the writes use, or can
   storage open sessions of its own?
3. Who closes a session: its harness, or whoever made it?
4. Does making a harness write anything, and what does a harness over the
   session document cost, which today exists only to carry `writeValues`?
5. Does anything the models need come from lane work or the documents?

**Kill criterion.** A harness made over a session that was written first
loses a write, cannot create a lane at an earlier entry, or fails a run.
Then the writes must stay with the harness, and the host's lazy reads with
them.

**Throw away.** `.plans/s113-probe/` (`probe.test.ts`, `results.txt`): a
vitest file that ran inside `packages/pi`. It builds pi's stack as
`overDoc` does (`KynetaStorage`, `StorageBackedSession`,
`createAgentHarness`, `threadLanes`) over a scripted model, with no tools.

## Answers

1. **Yes.** A session given a value and an entry with no lane, then a
   harness over it (case B): a lane is created at that entry, a run on it
   returns `ok` and leaves its reply at the lane's tip, and a later value
   write and the early one both read back. A second entry with no lane,
   written through the session after the run, does not disturb the lane's
   next run. A released root reopened over a new session, written to
   before its new harness exists, runs its lane again (case G).
2. **The same session; two over one document drift apart** (case A). With
   sessions `a` and `b` over one document, `b` read `a`'s value only
   because it was its first read (a new `KynetaStorage` starts with
   everything dirty). After that, `b` did not see `a`'s entry, `a` did not
   see `b`'s value, their stats disagreed (1 message and 0), and a harness
   over `b` refused a lane at `a`'s entry (`unknown_target`). The source
   says why: `KynetaStorage` indexes its own commits, and reconciles only
   changes marked `replay` (`packages/pi/storage.ts`, its constructor), and
   another local session's commit is not one. So the storage and the
   harnesses share one session per document, as `stackOf` shares one today.
3. **The harness closes the session it was given** (case C, and pi's
   `runtime/harness.js`, `close`, which calls `this.session.close`). A
   write through the session after `harness.close` is rejected "Session is
   closed", and so is one started just before it: nothing reaches the
   document. So a document's session and its harness end together. The
   storage forgets the session when its harness closes, or a later write
   fails, and that order is `release`'s, as today: `release` drops the
   stack, then closes it. A root is released only by archiving, which a
   busy root refuses, and the archive gate refuses writes into it before
   it unloads (`apps/pinetrie/host/TECHNICAL.md`, the documents' keeper).
4. **Making a harness writes nothing, and costs next to nothing** (cases
   E and F). The document's counts did not change when the harness was
   made; creating a lane wrote its three values. A harness over a session
   document took 0.06 ms with the model setup shared, 0.2 to 0.3 ms with
   it, about 179 KB with it (S84 measured 0.35 ms and 49 KB). A session
   with no harness ever writes as one with (case D). So dropping the
   session document's harness is tidier, and saves nothing worth naming.
5. **The models need only the project's root, which lane work does not
   make** (read from source). `setUpModel` takes the model choice, a
   `cwd`, the agent directory and the skills directory
   (`packages/pi/config.ts`); `complete`, `skill`, `commands`,
   `agentDir`, `canDrawBanners` and `drawBanner` derive from its result and
   the user config (`createAgent`). The root is `prepareHost(dir)`'s
   (`packages/lanes/host.ts`), which reads no document and no agent;
   `startSetup` calls it first (`apps/pinetrie/host/work/setup.ts`), and
   its only read of the agent is `hostPaths`, lazily, for `commands()` and
   `agentDir()`.

## What it means for the split

- **The sessions own one session per document, and the lanes are made
  over them.** `createLanes` asks the sessions for a document's session,
  and never opens its own.
- **A session's life is its harness's once one exists.** `release(root)`
  forgets the session, closes the harness over it if there is one, then
  closes the session, for a root written to but never run. Both closes
  are idempotent (pi's `StorageBackedSession.close` and `harness.close`
  each return their first promise; read from source), so the order needs
  no check. The session document has no harness: the sessions close it
  themselves at shutdown, beside the lanes' close, or after the
  shutdown's `agent` step a write there would succeed, where today it is
  refused (`close` leaves each closed stack held, so the next write finds
  it closed).
- **The models can be made before lane work**, once the project's root is
  found before `startSetup` rather than inside it, and `hostPaths` becomes
  a value.
- **The reason to split is the coupling, not the cost**: one harness
  fewer is about 0.3 ms and 179 KB.
- **Two of lane work's reads of the agent stay**, since each is a lane's:
  `prepareUpdate` appends to the lane it merged into
  (`apps/pinetrie/host/work/update.ts`), and baseNews steers a running
  lane (`apps/pinetrie/host/base-news.ts`). The first can take the lane's
  handle from its caller, the queue's pop, which holds the lanes; the
  second can listen for lane work's base changes once the lanes exist.
  Not probed: both are wiring in the host, which the host suite covers.
