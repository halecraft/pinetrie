# S245 — a tab holds every sidebar canvas's roots, but only the canvas on screen and your inventory read them; the sidebar reads the session

- **Status:** Answered

Read from the code at this revision; sizes from Duane's root trace and
store copy (S222); one probe in Node 24 on the roots his tab held. The
probe was not committed.

## Brief

**Question.** At each connect, Duane's tab asked the host for 15 to 17
roots, about 50 MB (S222). The host loads each one, a synchronous
stretch of up to 1.7 s in the CPU profile (S220), and keeps it loaded
while the tab holds it (ADR-0162). Which of the page's reads need those
roots, and which could come from what the session already holds?

**Kill criterion.** If the sidebar's items or anything else drawn at
connect read the conversation of every sidebar canvas, a tab must hold
them all, and the cost is to be cut elsewhere.

**Throw away.** The probe, and the trace and store copies.

## Answers

1. **What a tab holds** (`planHeldRoots`, `packages/interface/held-roots.ts`):
   every root of every canvas in your sidebar, archived or not, the canvas
   you are on, and the root of each thread in your inventory.
2. **The page waits for all of them before its first draw:** it holds
   them, then awaits each one's sync (`settled`, `packages/web/app.tsx`).
3. **The sidebar reads the session, not the roots.** An item's label,
   line, title, icon, status, arrivals, ⇡ and moves come from the
   directory (`pinetrie.root`), marks, names, banners, icons, the board,
   attention, verdicts, the open proposed changes and `pinetrie:live`
   (`sidebarView`, `threadCardHeads`, `useAttention`). One fact comes from
   the held roots: a thread whose cards wait in its queue, or whose queue
   is held, is "waiting" or "held" (`threadWork`, from `readHeldLanes`).
   A canvas on the board but not in the sidebar already lacks it. The
   roots give only the lane names there; the waiting count is the cards',
   and a hold is the session's (`readLanes`, `packages/reads/index.ts`).
4. **What reads a root's conversation:**
   - the canvas on screen: its columns, projections, search (🔍 searches
     the canvas you are on only), pins;
   - your inventory: each slot's face (its first message, its end, its
     last prompt, whether it was stopped: `threadFace`) and its preview
     (`threadPreview`);
   - a link to an entry: found in the held index, else shown through the
     canvas's first thread (`readerRow`, `planOpenIn`), so it works unheld.
   - The inbox, mentions and participants read the directory.
5. **One held index over every held root, rebuilt when any root's entries
   change** (`readHeldIndex`). On the 17 roots Duane's tab held (8,124
   entries, 42 MB of entries as stored), the first build took 49 ms and
   a rebuild after one new entry 9-12 ms in Node; one root's alone, 0.1 ms.
   Small, but paid on every message in any sidebar canvas.

## What it points to

- **Hold the canvas on screen and your inventory's roots,** not the
  sidebar's. The sidebar loses nothing it draws, once "waiting" and
  "held" come from the cards and the session's holds rather than from a
  root's lane list (they need only the thread's id). The first draw then
  waits for one canvas, and the host loads and keeps that many roots.
- **What it costs:** showing another sidebar canvas loads its root then:
  the host's load, if no step holds it, and the sync. A tab could keep the
  canvases it showed last, up to a few, so going back is instant.
- **Not measured:** how long a tab takes to sync and draw 50 MB of roots,
  which needs a browser with Duane's store; the host's side of it is the
  1-1.7 s stalls of S220.
