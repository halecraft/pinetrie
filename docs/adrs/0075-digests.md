# ADR-0075 — A digest is a headline and a few points, written only for a long ask, and only when it adds something

**Status:** Accepted. Implementation: `PLAN-2026-10-05-digest-headlines`.
Amends ADR-0056 (what a digest says, which asks have one, and where it is
drawn) and ADR-0071 (short asks cost no request). Amended by ADR-0077: the
final request also asks for the run's verdict, first, and its reply is read
by `endReplyOf`.

**Context.** ADR-0056 asked a model for "two or three plain sentences: what
was asked, what has been done, and what is happening now" for every ask
with work, and drew the reply whole, as plain text, in a grey italic
paragraph under the ask's fold line. In use:
- The summary restated what the reader saw already: the ask is drawn just
  above it, and in story density the agent's last message just below.
- A one-step ask got a thirteen-line summary, longer than its work.
- Nothing checked the length, so a reply of seven sentences was drawn
  whole, and markdown (`` `core/index.ts` ``) showed its backticks.
- The most useful sentence sat apart from the fold line, which said only
  counts ("30 steps · 30 tool calls · 12 files").
- Words for Pineta's machinery ("session lane") reached the reader.

**Decision.**
- **Only a long ask has a digest.** A long ask is one whose run holds
  `MIN_STRETCH` agent messages (`isLongAsk`, `packages/core/asks.ts`). It is
  the rule that already gives a long ask a dot and a capsule of its own on
  the rail. `planDigest` asks for no other, so a short ask costs no request.
- **The reply has a shape:** a headline of at most 14 words (the skill asks
  for 12), then at most four points, each a `- ` line of at most 40 words.
  Alternatively, the whole reply is `nothing to add`, when the agent's last
  message already says what the work came to.
- **The host reads the reply before writing it** (`digestOf`,
  `packages/marginalia/digest.ts`), as `titleOf` reads a title. A reply in
  any other shape is refused, logged, and not written, so the last good
  digest stays. A reply is never cut: a cut list says something the model
  did not.
- **A refused final reply clears the digest.** A live headline says what
  the run is doing ("Fixing test fixtures"), which is false once the run
  has ended, so a refused final reply writes an empty final digest rather
  than leave one standing (`digestToWrite`). `nothing to add` writes the
  same.
- **The request says what the reader sees already:** the ask, and the
  agent's last message under a heading of its own, which is never cut. The
  skill asks for what lies between them: changes, findings, decisions,
  failures and risks. It forbids restating the ask, narrating steps, and
  naming Pineta's machinery.
- **`pineta.digest` holds `{ headline, points, at, final }`;** a null
  headline is a digest with nothing to draw. A record written before this
  ADR, `{ text, at, final }`, does not decode and is dropped.
- **In story, the headline leads the fold line,** before the counts, and
  a final digest's points are a short markdown list under it. It is marked
  as a model's words (a ✦, and "written by a model" as its title), which is
  how it is now told apart from the agent's words.
- **In outline, the digest is drawn under the ask's line,** headline and
  points together (`digestApart`), as the summary was before this ADR. The
  line itself is one line cut to the column's width, and says what the run
  is doing now or how it ended, so a headline in it would be hidden while
  the run lasts, which is when a reader coming back most needs it.
- **A live digest's points are not drawn:** they change with each request
  and are replaced at the end. Its headline is.
- **One wording serves every reader:** `digestText` writes a digest as the
  model is asked to answer. It is the next request's "summary so far" and
  the rail capsule's tooltip, and `pointsText` is the list drawn under the
  fold.

**Consequences.**
- Asks of one or two agent messages, most of a conversation, are never
  summarized, and cost nothing.
- A replacement `ask-digest` skill must ask for the same shape, or every
  reply it gets is refused and logged ("the model's digest is not one").
- Asks digested before this ADR show no summary, and none is asked again:
  a final digest is asked only at a run's end.
- The scripted model's describe answer (`SCRIPTED_DESCRIPTION`) is a valid
  headline, so the suites' asks keep a digest.
- How well the model keeps to the shape is not measured yet. A refusal rate
  well above zero, seen in the host log, would mean the skill's wording
  needs work.

**Alternatives rejected.**
- **A JSON reply (`{ worth, headline, points }`).** A smaller describe
  model, or a skill a person wrote, breaks JSON more often than a line
  format, and a line format reads as it will be drawn, in the log too.
- **Storing the raw reply and parsing it in each client.** Old records
  would survive, but every client would parse model output, and a refused
  reply would still replace a good one.
- **Cutting a long reply to fit.** A cut headline or list says something
  the model did not.
- **A second request, or a score, to decide whether a summary is worth
  showing.** It costs a request for what one sentinel answer gives.
- **Deciding by the size of a column's fold.** Landmarks split folds
  differently in each column, so readers would disagree about which asks
  have a digest; the run's agent messages are one fact for all.
- **Drawing a live digest's points.** They change every minute and are
  replaced at the end; the headline says what is happening now.
- **A disclosure of its own for the summary.** It would be a second toggle
  beside the fold's. The headline is the folded form, and four short points
  need no hiding.
