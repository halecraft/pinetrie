# S345 — what pine·trie's own page and host do with a browser store and a transport that reconnects

- **Status:** Answered
- **Led to:** ADR-0202

For ADR-0202's first stage: every page keeps a Kyneta store and
reconnects. S290 measured this with a toy hub and a page of its own,
served by a server that never went down. It did not measure pine·trie's
host, which serves its page itself, drops a peer at once
(`departureTimeout: 0`), deletes every stored `Line` at its start, and
whose client closes its `Line` for good when the host leaves (`host-left`,
`HostLine.close`, ADR-0037).

**Question.** With `connectSession` given `@kyneta/indexeddb-store` and a
reconnecting transport, and the host on its SQLite store (on Kyneta 5.0.0,
S344):

1. Does a tab keep its seat across a reload?
2. With the host down: does the open page take typing in a card that
   exists, and in an empty composer? What does it show?
3. With the host back, on the same store and port, and the page not
   reloaded: does it reconnect by itself? Does what was typed reach the
   host? Can the page send again?
4. A reload while the host is down: what loads?
5. Does the host keep its seat across a restart from its store?

**Kill criterion.** None: the answers are what breaks, which the plan for
the first stage must change.

**Throw away.** A probe and the page's and session's changes, in a scratch
copy of the repo on Kyneta 5.0.0 (S344's), never in `/workspace`.

**Answers.** In S344's scratch copy on Kyneta 5.0.0, with `connectSession`
given `@kyneta/indexeddb-store` and a transport that reconnects
(`connect.diff`, `main.diff`), the built page in headless Chromium on
`127.0.0.1`, and the host on a SQLite store (`output.txt`):

1. **A reload keeps the tab's seat, but first the page showed nothing.**
   With the store as given, the reloaded page drew no column and held no
   card, although its copy of the places held all three cards, synced with
   the host, for the 10 s it was watched. The session reads each document
   once as it connects (`readPlaces` into its own store) and then only on a
   change. A stored copy loads after that read, and loading it is no change
   pine·trie's subscription hears, so the page stayed empty. Read again
   once the places had loaded (`whenHydrated`, in `connect.diff`), it drew
   the thread and the draft. Without the store, the same reload drew them
   at once, as a new seat.
2. **With the host down, a card that exists takes typing.** The draft's
   box took " and more", and the page's copy of its text held it. The
   page's `Line` closed for good at once ("the host left"). An empty
   composer was not reached: the probe's click on + canvas left no
   composer to type in, so S264's answer (the box empties) stands untested
   here.
3. **With the host back on its store and port, the open page reconnected
   by itself, and the text reached the host, but the page could not send.**
   The host returned under the same seat, the page's peers held it again,
   and the host's copy of the draft read "draft one and more". A request
   then failed at once: "the host left", from the closed `Line`. After a
   reload with the host up, a request was answered.
4. **A reload while the host is down loads nothing.** The host serves the
   page, so the reload failed with `ERR_CONNECTION_REFUSED`.
5. **The host keeps its seat across a restart from its store.** The page
   saw the same host seat before and after (the host's own seat is not
   read by the probe; the page's view of it is).

Besides:

- **Each reload of a lasting seat meets a `Line` the host has deleted.**
  The host destroys a departed seat's `Line` (its `departureTimeout` is 0)
  and deletes every stored `Line` at its start. The reloaded page, the
  same seat with its old `Line` in its store, was refused it ("refused our
  operations"), then reported a `lineage-collision` on it, and adopted the
  host's new one. The request after it was answered, but every reload
  logs three errors and a warning.

**Consequences.** The first stage of ADR-0202 needs, besides a store and a
reconnecting transport:

- **The session reads each document after it has loaded**, not as it
  connects: `whenHydrated` before the first read, or a read on load, for
  the places and every document it reads once.
- **The client's `Line` survives the host's absence.** `HostLine.close`
  on `host-left` goes, as ADR-0202 says, and the host keeps a seat's
  `Line` across its departure and its own restart rather than deleting
  them, so a reloaded seat resumes its own `Line` instead of colliding
  with a new one. Requests as intents (ADR-0202) would remove the
  `Line`, and this with it.
- **A reload with the host down needs the page from somewhere else**: a
  service worker that keeps the page's files, or the page served by
  pine·trie running on the person's own device (S299). Until then, what
  outlasts an outage is the open tab, not a reload.
- Not measured: an empty composer typed in while the host is down (S264
  holds), the host's `departureTimeout` raised, and a seat that lasts
  across closing and opening the browser.

**Method.** `probe.ts` ran as `apps/pinetrie/e2e/s345-probe.ts` in the
scratch copy, in Node 24 in a Linux lane, against `startSuiteHost` with a
scripted model, a SQLite store file and the built page (`readBuiltPage`;
under Vite's server, the page reloaded itself whenever the host came
back). It drove Chromium's headless shell through the suite's helpers
(`asPerson`, `connected`, `typeAfter`). The page exposed its session,
the host's seat as it saw it, and the places' sync state on `globalThis`
for the probe. A thread was started with one message, a draft typed in
its composer, then: reload; host shut down; typing; host started on the
same port and store; a request; reload and a request; host shut down;
reload.
