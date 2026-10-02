# ADR-0057 — A thread is named when its column first wants an agent, and its lane is created under that name at the first send

**Status:** Accepted. Implementation: `PLAN-2026-10-02-named-early`.
Amends ADR-0039 (a name is planned for a lane that does not exist yet, and
the host, not pi, decides a new thread's lane id, taking the client's),
ADR-0040 (`✦ new agent` lasts only until the name arrives) and ADR-0053 (the
icon starts as the column opens, not at the first send).
Amended by ADR-0060: the first send carries the thread's base, which the
host checks before it creates the lane.

**Context.** A thread's name (ADR-0039) and its icon (ADR-0053) are keyed by
its lane, and the lane is made only by the first send: `createThreadLane`
mints `laneNameForThread(uuidv7())` (`packages/pi/agent.ts`), `prepareLane`
calls `ensureNames`, and `onNamed` makes the icon due. Until then, the
column's header says `✦ new agent`, with the star in place of an icon.

So a new agent's column has no identity during the time someone spends
writing its first message, which is when they are deciding what the thread
is for. It gets one a second or two after the send, as the name arrives and
then the icon. Two new-agent tabs open side by side cannot be told apart.

Before the first send, the host has nothing to name. A fresh column is only
the client's: its layout is in `localStorage` (ADR-0027), and its card is
created at the first keystroke and swept when empty (ADR-0048).

Two facts make an earlier name cheap:
- A lane id needs no coordination. It is a uuidv7 behind the `t-` prefix
  (ADR-0016), so any writer can make one, and pi's `harness.lane` takes the
  name it is given.
- Nothing about `pineta.name` or `pineta.banner` needs the lane to exist.
  Both are keyed by the lane id, and `planNames` takes only lane ids and
  their order.

**Decision.**

- **A thread is named when its column first wants an agent, and created when
  it is first asked.** Its identity (lane id, name, icon) comes before its
  lane. A thread that is named but not yet started is a `pineta.name` record
  whose lane pi does not hold. This adds no table and no state field.
- **The client makes the lane id.** A column makes one
  (`laneNameForThread` over a uuidv7) the first time its composer's next
  send would create a lane (`onCreatesLane`). That happens as a ＋ "new
  agent" tab or an `@agent` branch opens, or later, when `@agent` is typed
  in a conversation's column. The column keeps the id in its layout
  (`Column.reserved`), so a reload keeps it.
- **A column binds to its reserved lane by id.** Once a lane by that id has
  a tip, `sync` binds the column to it, as a fresh column finds its first
  message by its send id. It does not wait for the column's tip to be
  exactly one lane's, so a branch at a lane's tip binds at once. A layout is
  copied to every browser tab of the device (ADR-0027), so a copy of the
  column binds too, and follows the thread its other copy started: a new
  tab moves into the new root.
- **A `reserve` command asks the host to name it.** The id must have the
  shape the client makes, `t-` and a uuidv7 (`parseNewLane`), because a
  lane's container and volume are named after its id. The host names an id
  that pi does not hold, in the same serial step as every other lane
  (`createNames`), ordered by when the reservation arrived, and `onNamed`
  makes its icon due, as for any new name. Reserving an id that is already
  named does nothing, so a column can send `reserve` again after a reload or
  a lost reply. An id pi holds is refused.
- **The first send creates the lane under the reserved id.** A chat
  carries its column's reserved lane in its own field, apart from `lane`:
  `lane` decides where a message goes, while the reserved id decides only
  what a created lane is called. `planChat` decides the id with the rest
  of `createAndRun`, and `createThreadLane(at, lane)` creates pi's lane
  under it. The host decides every new lane's id; pi makes none.
  - **An id pi already holds is not used**: the lane gets a new id the
    host made. So guessing another thread's id gets a client nothing, and a
    copy of a column that sends before it binds still sends. pi's
    `harness.lane`, given a name it holds, returns that lane and ignores
    where to create it (`harness/runtime/harness.js` in
    `@earendil-works/pi-agent-core` 0.87.1), so `createThreadLane` refuses
    a held id itself, and the host never asks it to.
  - **An id never reserved is used**, and named as the lane is created, as
    every lane is. A lost `reserve` costs only the early name.
- **The header reads the name as it does now.** For a column whose next
  send creates a lane, `identityOf` (`packages/client/column-view.ts`) looks
  up the reserved lane in `names`, and `bannerUrl` looks it up in
  `banners`. The column shows `✦ amber-fox`, and then its icon, before
  anything is typed. `✦ new agent` remains only until the name record
  arrives, or while no host is there to write it. A new tab's label in the
  tab bar stays "new agent": a tab is labelled by its root, and a root holds
  many threads.
- **A reservation is never released.** A name you saw stays the thread's
  name, as ADR-0039 promises, even for a thread never started. A
  conversation's column that gains `@agent` and then loses it keeps its
  reserved lane. If `@agent` comes back, the column shows the same name.

**Consequences.**

- A new agent has its name and icon before its first message is typed. The
  offer's bookmark, trailers and log lines (ADR-0039) use the same name
  later, since the lane is created under the id that was named.
- A new-agent column closed without sending uses up a name out of 65,536, and
  one icon's model request (about 0.7¢, ADR-0053) plus its blob, which
  `referencedBlobs` keeps. Opening and closing many such columns costs that
  much each time.
- A conversation column with `@agent` typed in it asks for a name at once,
  even if the message is then sent to people only.
- A reserved name can go unused for a reason other than closing the column.
  A reply whose thread already has a lane, because someone else created it
  meanwhile, goes to that lane, as `planChat` decides today. The column then
  shows that lane's name, and its own reservation is left unused.
- `pineta.name` holds records with no lane. Every reader today looks a name
  up by its lane (`readNames(doc).get(lane)`), so these records go unseen. A
  reader that lists threads must start from pi's lanes, not from the names.
- A new agent's column open in two browser tabs of one device shows one
  name in both. When one sends, the other binds to the new lane and follows
  it. Before this ADR, the other stayed an empty new tab.
- The control channel gains a verb (`reserve`) and the chat command a field.
  The client proposes lane ids and the host decides them; until now pi made
  them.

**Alternatives rejected.**

- **Create pi's lane when the column opens.** A lane is work (ADR-0019):
  creating one writes a lane record and starts its own copy's fork and
  container (`prepareLane`). That is too much for a column that may be closed
  unsent, and it would leave a lane with no messages.
- **Carry the reserved lane on the fresh card.** Cards are created at the
  first keystroke and swept when empty, so a card cannot give a column an
  identity before anything is typed. It would also make the host act on a
  client-written document as it changes.
- **The host makes the id, in reply to a request.** That needs a round trip
  before the column has an id to keep, and a reply to match up with its
  column. An id the client makes can be resent with no harm, and the host
  only names it.
- **Refuse a send whose reserved id pi already holds.** The person would
  lose a send to a cause they cannot see, such as a copy of the column in a
  second browser tab sending before it bound. A new id costs only the name
  shown.
- **A copy of the column whose id became a lane makes a new id.** It would
  show a second name for what is one column of one person, and leave an
  empty new tab behind the thread it started. Binding by id needs no
  check that an id is stale.
- **Bind only when the column's tip is exactly one lane's,** as before.
  The column knows its lane exactly; waiting for the tips to tell it adds
  a window where a branch at a lane's tip is bound to neither.
- **A name the client computes for itself.** Without the stored table it
  could collide unseen (ADR-0039), and only the host can draw an icon.
- **Release a reservation that is never used**, after some days or when its
  column closes. Only the client knows when its column closes, and a name
  freed after it was shown could reappear on another thread. Names are not
  scarce enough to justify either.
