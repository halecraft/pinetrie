# S89 — where a take waits, and what a refresh costs

- **Status:** Answered
- **Led to:** ADR-0065, ADR-0067, ADR-0104, ADR-0105

**Question.** Sometimes a take ("add to the project") took 30–60 s, and
the page showed nothing while it waited. Is the cause the offers' one
queue for your repo? That means: refreshes queued as jobs, with nothing
merging duplicates; a 2 s poll that overlaps itself; the host's own
writes triggering refreshes again; a take waiting at the back of the
queue; and an offer command holding every other command on the host's
`Serial`. How many jj processes does one refresh run? These are the
before numbers for the one-owner work (ADR-0065); the after numbers come
when that work is done.

**Answer.** Yes to each. jj 0.44.0, `container` 1.4.1. The project was an
APFS clone of pine·trie's own repo, so jj ran with this repo's real history:
a jj process took 18 ms at the median and 20 ms at p90. It ran with a
fresh session and the scripted model.

Each run made six threads, each with an offer of one file. It took one
offer with nothing else running (the control take). Then one thread
worked for about 90 s: 30 turns of `echo >> file; sleep 2`, each followed
by a fetch into your repo. During that work, one person took an offer at
+20 s and again at +60 s, and a second person sent a chat 1 s after each
take. Run 2 also played you: every 3 s it wrote a file and ran `jj log`,
as an editor and jjui do. Run 3 did not. Both runs used the same script.

| | run 2 (with you) | run 3 (host alone) |
|---|---|---|
| control take, idle host | 0.37 s | 0.37 s |
| take at +20 s | 1.4 s | 2.9 s |
| **take at +60 s** | **18.1 s** | **13.5 s** |
| **the other person's chat, sent 1 s after it** | **17.1 s** | **12.5 s** |
| offers queue: deepest | 59 | 52 |
| offers queue: wait p50 / p90 / max | 8.7 / 14.5 / 18.2 s | 4.6 / 12.6 / 15.3 s |
| new operations the poll saw | 69 | 54 |
| lanes refreshed per new operation | 4–6 (every open offer) | 4–6 |
| poll ticks / ticks with an earlier read still out / most out at once | 91 / 47 / 9 | 79 / 37 / 6 |
| lane refreshes / ones a per-lane key would merge | 342 / 193 | 280 / 138 |
| time to drain once the load stopped | 30.7 s | 8.9 s |
| jj processes on the host, whole run (~200 s) | 8,445 | 7,085 |

1. **A take waits behind the queue, and a chat waits behind the take.**
   At +60 s the take waited 13–18 s in the offers' queue and then ran in
   0.4 s. The chat waited just as long. Its command step waited on the
   host's `Serial` (`wait` max 17.1 s and 12.5 s), behind the take's step,
   which held that `Serial` for the take's whole time in the offers'
   queue (`ran` max 18.1 s and 13.5 s). This is problems 5 and 6. At
   +20 s the queue was still short (depth 7), so the take took 1–3 s.
   The backlog grows with time under load, so when you click decides
   the wait.
2. **The host feeds itself.** Without you (run 3), the queue still grew
   to 52 deep. Its new operations were the host's own: 36 `jj git import`s
   by the fetch, and the refreshes, builds and repairs that wrote (59
   offers steps ran a write). Each new operation queued a refresh of every
   lane with an open offer, plus the line's record and a read of the
   offer bookmarks, about 8 steps of 0.3 s each. That is more than the
   2 s between polls. This is problems 3 and 4.
3. **Duplicates are about half the refreshes.** 193 of 342 lane refreshes
   (run 2) and 138 of 280 (run 3) were queued while another refresh of
   the same lane was still waiting, so a per-lane key would have absorbed
   them (problem 2).
4. **The poll overlaps itself.** About half the ticks fired while an
   earlier tick's read was still out, up to 9 at once. Each saw the same
   new head, and each queued its own round.
5. **A refresh costs more than the plan assumed** (problem 10 said
   "about 10"):

   | step | jj processes | time (p50) |
   |---|---|---|
   | a lane's refresh that wrote nothing | 18 (min 9, max 18) | 0.33 s |
   | a refresh that built | 25–32 | 0.68 s |
   | the line's record | 13 | 0.25 s |
   | describe's gather | 18 | 0.32 s |
   | a describe's settle (`outside.ts`) | 34 | 0.65 s |
   | a take | 20 | 0.39 s |

   Over the whole run, by subcommand: `log` 5,038, `log -r` 937,
   `diff -r` 708, `file list` 483, `evolog -r` 414. The same few
   revisions were diffed again and again: one `diff parents(<commit>)` ran
   28 times. No refresh shares a read with another.

None of this contradicts problems 2–6. It shows problem 10 at 18
processes, not about 10. Phase 7's target of at most 3 stands.

**Aside.** The base snapshot's scratch lane has a fixed name,
`pinetrie-t-base-scratch` (`BASE_LANE`, `packages/lanes/base.ts`), and
`container` names are global to the Mac. Two hosts on one Mac, even over
different repos, would share that container and volume. Not tested.

## After (ADR-0065)

The same scenario, the same scripted model and clone, after the owner of
your repo, the documents' keeper, per-seat order and the shared facts.
Runs 2 and 3 again, with you and without:

| | before, with you | after, with you | before, host alone | after, host alone |
|---|---|---|---|---|
| take at +20 s | 1.4 s | 0.43 s | 2.9 s | 0.59 s |
| **take at +60 s** | **18.1 s** | **0.44 s** | **13.5 s** | **0.44 s** |
| **the other person's chat** | **17.1 s** | **0.01 s** | **12.5 s** | **0.01 s** |
| the queue on your repo: deepest | 59 | 24 | 52 | 24 |
| a command's wait on your repo: max | 18.2 s | 1.1 s | 15.3 s | 1.0 s |
| jj processes for a refresh that wrote nothing (p50) | 18 | 2 | 18 | 2 |
| time to drain once the load stopped | 30.7 s | 0 s | 8.9 s | 0 s |
| jj processes on the host, whole run | 8,445 | 3,229 | 7,085 | 2,897 |

- **A command waits for at most the step running.** The deepest queue is
  upkeep: refreshes and observations, at most one queued per key. The
  owner's commands (takes, a description's settle, the fetch's imports)
  waited 1.1 s at worst, behind one running step.
- **The chat waits on nothing of your repo's.** An offer command no longer
  holds the documents' keeper.
- **Triggers merge.** In the run with you, 534 observations and 35 lane
  refreshes were asked for while one with the same key was queued, and
  were covered by it.
- **A refresh that wrote nothing ran 2 jj processes at the median**: the
  lane's one batched `jj log`, and its revision's evolog. These runs used a
  shortcut since removed: when the offer's ledger named the lane's tip and
  start, its files stood for whether the lane's work changes any. An offer
  the line already holds has none, while the work still does, and on a real
  repo such offers were withdrawn and built again on every observation. A
  correct refresh asks the lane's range too: 3 processes. The most such a
  refresh ran was 18–20: an offer whose ledger did not name the lane's tip
  and start (the working lane's, mid-run), for which the batched read asks
  whether the lane's work changes any file, and the separate reads where
  a stack or a conflict needs them.
- **Your `@` moving costs one shared read** (the `shared` key: 26 steps,
  15 processes each, in the run with you), and no lane's refresh.

The probe's hooks were in `@pinetrie/keeper` (each step's wait and run, its
key, and each call merged into a queued step) and `@pinetrie/lanes`'
`run.ts`, and removed afterwards.

## Method

A disposable probe, not committed:

- Temporary hooks in `apps/pinetrie/host/queue.ts` (each step's queue time,
  start, end and caller, from its stack), `packages/lanes/run.ts` (each
  process, attributed to the step running it through an
  `AsyncLocalStorage` that `Serial.run` entered), `offers/watch.ts` (each
  tick, and whether a read was still out) and `offers/index.ts` (each
  refresh's outcome). The hooks were active only when the probe set
  `globalThis.__s89`, and were removed afterwards.
- A driver that cloned the repo with `cp -cR`, leaving out `.pinetrie`,
  `node_modules` and `sandbox`, into a sibling directory. The project's
  `node_modules` link to `../../../kyneta`, so the clone had to sit beside
  the repo.
- It started the host with `startHost`, the scripted model, its own store
  and an empty user config. It joined two people as session clients
  (`join`), which send the same commands a page's tab sends.
- It ran the scenario above, wrote every event as a line of JSON, and
  removed the lanes' containers and volumes and the clone afterwards.

"Wrote nothing" means none of the step's jj processes was `rebase`,
`describe`, `restore`, `bookmark set|create|delete|move`, `new`,
`abandon`, `squash`, `duplicate` or `git import`. "Would merge" means the
refresh was queued while an earlier refresh of the same lane had been
queued and not yet started.

## Not tested

- The 30–60 s seen in real use. These offers were one file each, and
  there were six. Waits grow with the number of open offers and with each
  refresh's cost, so bigger offers, stacks and more threads should go past
  the 18 s seen here. The probe did not try them.
- A real model, whose turns are longer than 2 s and fetch less often.
- The page: the clients were session clients, not browser tabs. The
  page drops the answer to an offer command (`perform.ts`), which this
  probe did not look at.
- Divergent operation heads made by the fetch's import racing an
  offer's write. S87 item 7 counted them in pine·trie's own repo. The clone
  was deleted before its op log was read.
