# S199 — A reachable thread's root is not always held: two trash places disagree with `threadReach`, and a stale directory record leaves an open task's root unloaded after startup

- **Status:** Answered
- **Led to:** ADR-0029

**Question.** A late step that reads its root through `docs.view` (or
`docOfLane`) finds nothing for a root the host does not hold, and then
writes nothing. A gate keyed on `threadReach` (`packages/rules/reach.ts`)
that lets `open`, `held` and `trashed` threads through is only sound if
every such thread's root is held whenever a host step runs. Is it?
1. Does `threadReach` agree, place by place, with `rootsHeld`
   (`packages/rules/task.ts`), the rule for which roots a starting host
   loads and an archive keeps?
2. Does every path that opens or lets go of a root at run time keep a
   reachable thread's root held?

**Kill criterion.** Any place or path where a thread is `open`, `held` or
`trashed` and its root is not held, or where `rootsHeld` holds a root that
`threadReach` calls away. Then the gate cannot be `threadReach` as it is,
and the read rule needs what loads roots to agree with it.

**Throw away.** One probe, kept as the record of what ran:
`docs/findings/S199-reachable-roots-held/probe.ts`, a vitest file run from
`apps/pinetrie/host/` (its imports are that directory's). P1 puts a
thread's card in each place a card can be and asks both rules. P2 runs a
starting host's loads (`planLoads` over `rootsHeld`, as `startHost` does
in `index.ts`) and then its directory (`startDirectory`) over a real
`Exchange`, the real `hostDocuments` and `createRecords`, for an open
task's started root whose `ROOT` record decodes, and again for one whose
record is in an older shape. Its output is `output.txt`.

## Answers

Measured in a lane (Linux, Node 24.21), on 2026-10-15.

1. **They disagree on two trash places** (P1):

   | the thread's card | `threadReach` | `rootsHeld` |
   |---|---|---|
   | on an open task's canvas | open | held |
   | on an archived task's canvas | archived | not held |
   | in an inventory | held | held |
   | trashed from an open canvas | trashed | held |
   | **trashed from an archived canvas** | **trashed** | **not held** |
   | **trashed from an inventory** | **gone** | **held** |
   | no card | gone | not held |

   `threadReach` reads a trash place as `trashed` only when it left a
   canvas, and never asks whether that canvas's task is archived;
   `rootsHeld` unwraps the trash (`livePlaceOf`) and asks of the place it
   left. So a gate on `threadReach` would let a late write into a thread
   trashed in an archived task, the hole the gate exists to close, and
   would drop one for a thread trashed from someone's inventory, whose root
   is held. `Reach`'s `trashed` names a task, so it cannot say "trashed
   from an inventory" at all.
2. **A stale directory record leaves an open task's root unloaded after
   startup** (P2). With the record decoding, the root is loaded, the
   rebuild plans nothing, and `docs.view` answers. With the record in an
   older shape, `readRoots` drops it, so `rootsHeld`'s `started` lacks the
   root and `planLoads` does not open it; `planRebuild` then names it (no
   record that decodes, not loaded), and the directory opens it, rewrites
   its record and lets it go. After startup the thread is `open` and
   `docs.view` returns null. `ROOT` is derived and changes shape with no
   migration (`packages/rules/roots.ts`), so the first start after any
   change to it leaves every open task's root unloaded this way.
   `docs.ts` says the opposite of `planLoads`: "a root whose directory
   record is stale is opened all the same".
3. **Every other path keeps them in step**, read from source, not run: the
   archive unloads only roots `rootsHeld` no longer holds (`stillHeld`,
   `commands/board.ts`); a restore opens the task's roots in its crossing's
   first step (`planCrossing`), the step that writes its place; the
   directory's rebuild unloads only roots no document held; a lifted
   thread's cards go in the step that destroys its root
   (`commands/cards.ts`), so its reach is `gone` first. No other code calls
   `docs.unload` or `docs.destroy`.

The kill criterion is met.

Read from source, not run: the same stale record keeps a lane a crash
interrupted from resuming. `recover` asks pi for the interrupted lanes of
the roots `planLoads` opened (`startup.ts`), so a lane in a root left out is
neither resumed nor reported, and stays busy in pi until a start whose
record decodes.

**What the plan takes from it.** The gate asks what `rootsHeld` asks, one
predicate both share: a thread is live when its card, unwrapped from the
trash, is in an inventory or on the canvas of a task outside the archive.
A late write passes only for a live thread, so a passed gate finds its root
held, by construction. `threadReach` still words a refusal. And a started
root is one with a `ROOT` record at all, decoded or not, so a stale record
is loaded at startup and rewritten by the directory as it follows the root.
