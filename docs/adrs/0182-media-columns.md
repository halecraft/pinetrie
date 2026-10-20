# ADR-0182 — A media column holds images, each with its versions and its comments; one is made by a file dropped on the strip, an image dragged out of a thread, the pane, or the agent

Numbered 0181 until 2026-10-19, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-19)
- **Area:** `docs/06-interface.md`, `docs/glossary.md`,
  `packages/rules/TECHNICAL.md`, `packages/interface/TECHNICAL.md`,
  `packages/web/TECHNICAL.md`
- **Evidence:** S249, S250
- **Amends:**
  - ADR-0116: the media card is a media column, of images only: each image a
    card of its own in it, ordered as notes are, with its versions and
    comments. A run is told each media column and its images' titles, never
    the images. A note column's title is one record with a media column's and
    an image's, a card's title, and every stored one is moved to it.
  - ADR-0126: a margin is an entry's or an image's surface, one place that
    names its owner by address, and a comment's place says which version of an
    image it was written on; every stored margin row is rewritten to it.
  - ADR-0134: a file dropped on the strip, between or onto columns, lands as
    images; an image in a message is a drag handle of its own.
  - ADR-0078: the pane puts the image it shows on the canvas.
- **Amended by:**
  - ADR-0183: the canvas list names each note column and media column by its
    id too, so the agent can read it; an image is read through `read_card`.
  - ADR-0200: a list column's title renames from its ⋯, not a click.

**Context.**

- **A canvas shows only conversations and notes.** ADR-0116 decided a media
  card, "an image, a video, a piece of art", kept as a blob, and reserved
  its id (`MediaId`, `m-`); no place takes one (`KINDS`, `packages/core/kinds.ts`).
- **Images are shared to compare.** A teammate uploads mockups, an agent
  takes screenshots or generates art, and the team picks among
  alternatives, asks for another try, and comments. One image per card
  would make a canvas of single images with nothing to group, order or
  compare them.
- **Images already land as blobs**, by paste, drop, `read` or a banner
  (ADR-0042, ADR-0051, ADR-0151): the original and a copy fitted to
  2000×2000, with its type, width and height. The sweep keeps what a card,
  an entry, a banner or a picture names (`readReferencedBlobs`).
- **Thirty fitted copies in a column cost under 0.5 GB of the browser's
  memory, and scroll at 60 fps at 4× throttling** (S249). A copy 512 wide
  costs an eighth as much, most of all for compact, which decodes the whole
  copy to draw a sliver.
- **The two drag systems can each bring an image** (S250). A file from the
  desktop reaches every point of the strip with its position, and the
  pointer engine sees none of it. An image in a message starts the
  browser's own drag, which takes the pointer from the engine, unless its
  `dragstart` is prevented, as every handle's already is. Columns abut, so
  "between two columns" is a position, not an element.
- **No model is chosen yet to describe an image** (S251 is open): the
  person's models outside a thread send text alone.

**Decision.**

*What a media column is.*

- **A media column is a card** on a canvas, in an inventory or in a trash,
  as a note column is but movable to an inventory: its title, and its
  images in one order. Its id is the reserved `MediaId`.
- **An image is a card of its own** (an `ImageId`, `i-`), in a media
  column at a rank, or in a trash. It is ordered as a note is, by ↑ and ↓,
  Alt+arrows or a drag, within its column or into another media column.
  An image dropped on a canvas outside any media column lands in a new
  one made for it there (`WRAPS`), as a text card lands in a note column.
- **An image is made as every card is** (`planMake`), into the place or
  spot it lands on; a spot on a canvas resolves through the drop's own
  resolution (`planMoveTargets`), which ranks it and makes its media
  column in the same step. Adding a version is the one new act.
- **An image has versions**, oldest first, each a blob with who added it
  and when. The newest is the one drawn. A version is never removed or
  rewritten: bringing an older one back adds it again as the newest.
  Versions are the host's to append, so two people adding at once both
  land, in the order the host takes them.
- **A card's title is one record**, keyed by the card's id, for every
  titled card on a canvas: a note column, a media column and an image.
  Last write wins; a cleared title deletes it. Who may set it is its
  kind's: a person alone for a note column, a person or the agent (through
  `put_image`) for a media column and an image. A canvas's title stays a
  mark (ADR-0045), which the model writes unasked. The note columns'
  titles already stored move to it once, a record migration in the
  store's ledger (ADR-0174). An untitled image reads its first version's
  file name.
- **Only images go in.** A blob the store sorted as text or opaque
  (ADR-0151) is refused, "only images go in a media column"; a drop of
  several files takes the images and says how many it left out. Video and
  other media wait for a decision of their own.

*Comments.*

- **An image has a margin**, as an entry has (ADR-0126): comments are text
  cards and references placed there, read by people, and by the agent
  once one is queued. A comment's place records the version it was
  written on, as a queued card's records the text its queuer saw: a field
  of the place that its key leaves out, so a move within the margin does
  not fail on it. It says so when a newer version is drawn ("on version
  2"). No card's content changes.
- **One margin, whatever it is on.** A margin place names its owner by
  address (`Address`, `packages/core/address.ts`): an entry's (which
  names its thread) or an image's card. It is stored as the printed
  address and an order, and no longer as an entry's id beside its thread.
  Its canvas is the entry's thread's, or the image's column's. Every
  margin row already stored is rewritten once to this shape, a record
  migration in the store's ledger (ADR-0174), so no reader keeps a second
  shape.

*How one is made: four ways, one gesture each.*

- **A file dropped on the strip** (`file-drop.ts`'s strip door, S250):
  between columns, placed by the pointer's x against the columns'
  centres as a reorder is (`pointerGap`), each image file a new image in
  a new media column there; onto a media column, new images where it
  lands among them; onto an image, a new version of it. A drop that
  makes a column and its images is one step of the dropper's history,
  undone whole.
- **An image dragged out of a thread** (a message's or a tool's, S250): the
  image is a handle of the pointer engine, its browser drag prevented, and
  lands as a dropped file does, the same blob, no upload. A press that
  moves less than the engine's threshold is still the click that opens
  the pane. Every stored image the page draws is such a handle (a
  message's, a tool's, the pane's), since one component draws them all.
- **One landing for both drags.** Where an image lands, from a file drag
  or the pointer engine, is planned once from what the pointer is over;
  only how the point is gathered differs. A file drop's landing is
  planned at the drop, before its upload, so a strip that moves during
  the upload does not move it.
- **From the pane**: an image shown in a column's pane has **put on
  canvas**, a split button whose main item makes a media column just
  after the thread's, and whose menu lists the canvas's media columns to
  add it to.
- **By the agent**: a tool, `put_image`, takes a path in its lane or a
  `/blob/` link, an optional title, and where: a media column by its title
  or id (a new one, titled as asked, when none), or an image by its id, to
  add a version. The host reads the file through the tool's environment,
  fits and stores it as `read`'s images are (ADR-0051), and places it as
  the agent's thread's person. It is in every run, as `set_banner` is.

*How it is drawn* (ADR-0171).

- **Full**, on a canvas: each image at the column's width at its stored
  size, so its box is held before its bytes load (`StoredImage`), with its
  title, its version (‹ 2 of 3 ›, stepping through the older ones), and
  its margin's count. A media column two wide draws its images two to a
  row, so alternatives sit side by side. A click opens the image in the
  pane, as any stored image.
- **Normal**, on the bench: its title and its first images, capped.
- **Compact**, in a slot: its title, a strip of its first images, and
  how many it holds.
- **Every image is drawn from the fitted copy** the store already keeps
  (S249). A smaller copy is not made.

*What the agent knows.*

- **The canvas list names each media column and its images**, one line
  per column: its title, then each image's title, id and how many
  versions, at most a fixed number of images and the rest counted, never
  the image (`canvasList`). A column of thirty images is one line of the
  list's fifty, as a note column is. An image added or versioned during
  a run is a fact line, as a card added is.
- **No image is in a run's context** until a tool reads a card on demand,
  which is a decision of its own. A media column cannot be pinned.
- **A text gist of each image** waits for S251.

*What it keeps.*

- **The sweep keeps every version's blob** of every image in any place,
  its trash included, until the image itself is swept. What blobs a card
  holds is its kind's to say, one rule for an image's versions and a
  reference's quote.
- **An archived canvas's media columns are read only**, as its threads are:
  the archive's gate refuses a move, a version, a title and a comment.

**Consequences.**

- Two card kinds and two places: `media` gets places (canvas, inventory,
  trash), `image` is new (an image's place, in a media column; a trash).
  Each is a row in `KINDS`, `ContentOf`, `CARD_CODEC` and the page's
  `RENDERINGS`.
- The margin place changes shape for every comment: its record, its key,
  the wire's key codec, `marginCards` and the margin counts read an
  address. A record migration rewrites each stored row at the first start
  after it lands, and a store that lacks it is refused once it is deleted
  (ADR-0174). A second one moves the note columns' titles to the card's
  title record.
- `file-drop.ts` gets a second door, the strip's, below the cards that
  take files; `boundaries.test.ts` keeps it the one file that reads
  `dataTransfer`.
- The pointer engine gets a source that is no card, a stored image by its
  blob, and the landings above.
- Thirty images in a column hold about half a gigabyte of the browser's
  memory, and as many again for each other media column open; the
  inventory's compact strips decode whole fitted copies too.
- Until a tool reads a card, an agent asked about an image knows only its
  title; a person pastes the image into the message to show it.

**Alternatives rejected.**

- **One image per media card,** as ADR-0116 read: alternatives and
  versions would be separate columns, nothing groups them, and a
  comparison scrolls the strip.
- **Versions as a list of blobs on a single card, rewritten by clients:**
  two people adding at once would lose one. The host appends.
- **A title record for each kind,** as a note column's was: four records
  of one shape, and a branch each in the mark's planner.
- **The version a comment was written on as the comment's content:** a
  field on every text card and reference, meaningful only in an image's
  margin.
- **A line per image in the canvas list:** one media column would push
  the rest of the canvas past the list's cap.
- **A margin place for images beside the entry's:** it would leave the
  stored rows alone, but give one surface two shapes, and every reader of
  margins two cases, for good.
- **A 512-wide copy for compact and normal now:** a third copy in the
  store, made and swept, for memory S249 found affordable. It is the first
  thing to add if many media columns share a canvas.
- **Showing the agent every image on every run:** each image costs a
  model's context on every turn; the agent is told what exists, and a
  tool will read one when asked.
- **The browser's own drag for an image out of a thread:** it cancels the
  pointer engine's drag (S250), so it could land nowhere the engine
  draws.
