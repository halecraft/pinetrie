# ADR-0011 — The lane name carries writer identity; never share a lane

**Status:** Superseded by ADR-0020 (lanes belong to threads; people own none). Accepted (from S3 **and** S8, independently)

**Context.** ADR-0009 established that a Loro per-key LWW register is safe
exactly when each key has **one writer**. Entry ids achieve that via UUIDv7.
But pi keys three registers by **lane name** — `pi.branch.tip`,
`pi.lane.state`, `pi.lane.config` (`values.js:62-65`) — so two writers sharing
lane `"main"` contend on all three.

Measured under a shared lane (S8 §3.3, S3 §3.2):

- **3 of 8 entries orphaned** — a complete turn detached from the lane path
- **queued steering messages lost** (1/2) — `pi.lane.state` carries the inbox
- **an in-flight operation record vanished** (1/2)
- replicas **converged**, entry sets **identical**, **no error anywhere**

The failure shape is precise and nasty: this is *not* S7 §3.4's "an entry
disappears." Every entry survives; what is lost is **reachability**. Because
`scanBranch` walks parents from the tip (`lane.js:1478`), the losing peer's turn
becomes invisible to the transcript, to context assembly, and to the UI. It is
consistent, converged, and wrong.

**Decision.** Each concurrent writer MUST own a distinct lane, created at its
branch point:

```js
const lane = await harness.lane(`peer-${peerId}`, { createAt: branchPointEntryId }, ctx)
```

Lane names MUST derive from a coordination-free peer id — never from a user
string, never from a default like `"main"`. A `Lane` object is single-writer
state and must never outlive its writer's ownership.

**Why this design.** It is the ADR-0009 mechanism reused: uniqueness of the
*key* removes contention. One idea applied twice, no new machinery. It fixes
all three registers at once, requires **zero adapter complexity**, and uses
pi's native grain — `AgentHarness.lanes()`, `lanesByName`, and pi's own
three-lane conformance fixtures show multi-lane sessions are first-class.

**Alternatives rejected.** *Shared tip* — the measured data loss above.
*Per-peer key rewriting inside the adapter* (lane stays `"main"`) — leaks:
pi enumerates lanes by prefix-scanning the tip namespace
(`restore.js:51,55`), so `restoreSession` would see `["main@p1","main@p2"]`
as two lanes. The adapter would have to lie consistently across `getValue`,
`setValue`, **and** `scanValues`, buying nothing over lane-per-writer.
*Add-wins set of tips* — `Schema.set` is **rejected at runtime** by the Loro
backend (verified twice, independently).

**Consequences.**

- Lane-name collision is a **silent-data-loss safety invariant of the same
  class as ADR-0009** and needs the same mechanical enforcement.
- **Lanes accumulate; there is no deletion API.** Every writer that ever joins
  leaves three permanent registers. Bounded by distinct writers over session
  lifetime — a real leak, not yet urgent. The UI must distinguish live from
  historical lanes.
- **"The trunk" becomes a convention, not a lane.** If every writer has a lane,
  none is canonical. Open question → **S12**.
- **v1 is not exposed.** The hazard needs ≥2 harness processes on one logical
  session. v1 is one host with thin clients (ADR-0001/0007), and `Storage`'s
  admission queue serialises commits within a process (S2/T5). Two browser
  windows driving one host contend on nothing. **ADR-0011 is a prerequisite for
  multi-device/team multiplayer, not for the v1 demo.**
- **Retires a v1 worry:** `docs/00-vision.md` proposed per-peer tips as *presence*.
  Unnecessary — durable per-peer lanes are sufficient and simpler. Presence
  remains right for *ephemeral* cursors (selection, scroll, live typing).

---

**Addendum (step 2, branch write).** `navigateTree` moves **this writer's**
lane tip. That is what makes an Aside private: the writer goes to the branch
and no other writer's lane is touched. Two writers branching concurrently
touch different lanes, so there is no contention on `pi.branch.tip` — but that
is exactly what step 3 must test rather than assume.

**Addendum (step 3, a lane per writer).** Until step 3 the host implemented
none of this: it minted one lane at startup and every client drove it, so one
window could move another's lane and only one turn ran at a time. Now each
client's lane is `laneNameForWriter(LineSender.peer)`. Identity comes from the
**transport**, never the message, so a client can only drive its own lane and no
command field can name someone else's. The host itself is not a writer. Proven
by a negative control: keying every writer to one shared lane fails "B
navigating did not move A's lane".
