# S28 — can a client recover from a refused note write, and can the host hear editing stop?

**Answers.**
1. **No: a refused write cannot be recovered from, and the host should never
   refuse a write to a note that a client may be typing in.** After a refusal
   the host keeps the writer's later writes as pending Yjs structs: accepted,
   never integrated, and sent to every replica that syncs the note. If the client
   drops its replica and fetches the note again, it writes under the same
   `clientID` from the same clock, fills the gap, and the pending tail
   integrates in the wrong place. The host's text was corrupted
   (`"Answer. RECOVEREDN"`: the `N` is the end of a refused `" AGAIN"`), and
   Yjs then gave the client a new, random `clientID`.
2. **A client that comes back under the same peer id with a fresh replica is
   unsafe, even with no refusal.** A browser reload does exactly this
   (`persistentPeerId`, no local store). Once the note syncs, Yjs sees
   operations under the client's own `clientID` that it did not make, and
   replaces that id with a random one, so the host can no longer attribute its
   edits. A write made before the note has synced reuses clocks the host
   already holds, and corrupts the text (`"Other. D1LY  D2"` on the host;
   `"EARLY  D2Other."` on the client).
3. **Yes: the host hears editing stop as an event, with no polling.** A
   subscription to the host's presence document fires when a person clears
   `editing` (10–12 ms), and again when their entry decays after a disconnect,
   or after they stop refreshing it (within the decay plus one Kyneta tick,
   1 s by default).

## Why it was asked

Queued messages are to become notes (ADR-0026). The host takes a queued note
when its turn comes and freezes its text, and someone may be typing in it at
that moment, most of all after another person releases the hold. ADR-0025
enforces "done" by refusing writes, and S26 addendum 2 showed that a refused
write splits the writer's replica. The question was whether the client can
recover by dropping the replica and fetching it again. The second question
was whether the host can react when a person stops editing, which the queue
needs so it can go on.

## Result

Through Pineta's host (`startHost`, SQLite store, scripted model) and
`connectSession` clients over WebSocket. Two runs, identical.

**A. A refused write, then recovery by dropping the replica** (Ada opens a
note; Bea edits it.)

| step | result |
|---|---|
| note done; Bea writes `" LATE"` | host `Answer.`, Bea `Answer. LATE` (refused) |
| reopened; Bea writes `" AGAIN"` | host `Answer.` (S26 addendum 2) |
| Bea `exchange.destroy(note)` | host keeps the note; Bea's replica gone |
| Bea `exchange.get(note)` again | matches host (`Answer.`) in 10 ms |
| Bea writes `" RECOVERED"` | host `Answer. RECOVEREDN`: **corrupted** |
| then | Yjs: "Changed the client-id because another client seems to be using it" |
| a third client joins; after a restart | both have the corrupted text |
| Bea's text before the drop | readable (`Answer. LATE AGAIN`), so it can be shown to her |

**C. What the host holds after a refusal**

| check | result |
|---|---|
| host text after the reopened write | `Answer.` |
| a new client's replica of the note | `Answer.`, **with pending structs** |
| Ada, who never had a refusal, writes | reaches the host, 10 ms |
| Bea's own replica | `Answer. LATE AGAIN ADA`: split for good |

**D. Reconnecting under the same peer id, with no refusal**

| check | result |
|---|---|
| first session: `clientID` = `clientIdOf(peer)` | yes |
| reconnect, before the note syncs | `clientIdOf(peer)` |
| reconnect, after the note syncs | **a random id** (Yjs reassigned it) |
| a write after sync | reaches the host |
| reconnect, write before sync | host `Other. D1LY  D2`, client `EARLY  D2Other.`: **corrupted, diverged** |

The random id costs attribution: the host maps `clientID`s to writers by
`clientIdOf`, so `planNoteEdit` finds no author for that client's later edits
and records nothing. A reopened note that only this client edits is not
marked "changed since done".

**B. The host hears editing stop** (presence decay 500 ms, Kyneta's default
tick of 1 s.)

| check | host event after |
|---|---|
| a person sets `editing` | 10–11 ms |
| a person clears `editing` | 11–12 ms |
| refreshed for three decay windows | still editing |
| a person disconnects | 416–426 ms, one event |
| a person stays connected but stops refreshing | 973 ms |

## Consequences

1. **No write to a note is refused once a client may be editing it.** When a
   queued note is taken, the host keeps accepting writes. The message carries
   the text as it was at the take, and a later edit stays in the note, marked
   as changed since then. This is ADR-0026. The same reasoning covers
   ADR-0025's "mark done", which refuses writes today and has the same race
   when someone marks a note done while another person types.
2. **There is no client-side recovery to build.** Recovery would need both a
   fresh `clientID` for the replica and a host that drops the refused writer's
   pending structs, and neither exists. Kyneta's `canAccept` refuses silently,
   so the client is never told.
3. **A note's editor must wait until the note has synced before it accepts
   typing.** Otherwise a reload followed by fast typing corrupts the note. This
   affects notes today, queued or not. The proper fix is in Kyneta: a Yjs
   document that will be synced over the network should claim its peer's
   `clientID` only after its first sync, as `createForHydration` already does
   for a store. That fix would also keep the id stable across reloads. To file
   upstream.
4. **The queue can react to presence.** The host subscribes to its presence
   document and runs a drain step when `editing` changes, including on decay.
   A disconnected person's hold lapses within the decay (30 s) plus a tick.
5. **Note:** the client refreshes `editing` only on focus and input
   (`packages/client/note.tsx`), so a focused note left untouched for 30 s
   stops counting as edited. A hold that should last while a note is open
   needs a refresh while the editor has focus. Browsers throttle timers in
   hidden tabs, and Chrome's intensive throttling (about once a minute) is
   longer than the decay.

## Not tested

- Kyneta's pending structs across a host restart. The corrupted text survived
  one restart, but the pending tail by itself was not checked.
- Whether a refused writer's pending structs ever expire.
- A browser, as opposed to Node clients. The reload case was reproduced with a
  fresh `connectSession` under the same peer id, which is what the page does.

## Method

Two disposable probes in `apps/pineta/e2e/`, not checked in, run twice with
`node`. The first used a real host, clients, a refusal via mark done, then
`exchange.destroy` and `exchange.get`, and a subscription to the host's
presence document. The second inspected a fresh replica's
`store.pendingStructs`, and reconnected under the same peer id with and without
a write before sync. `clientID`s were read with `unwrap` on the note's handle.
