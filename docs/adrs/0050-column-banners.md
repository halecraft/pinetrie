# ADR-0050 — A thread's column has a banner: drawn from the thread after its first run, or set by the person through the agent

**Status:** Accepted. Implementation: `PLAN-2026-09-30-column-banners`.
Measured in S60. Amended by ADR-0053: the banner is a square icon drawn
from the thread's name alone, as the thread is named, with no crop.

**Context.** A tab can hold many columns, and each header shows the same
things: a colour stripe, a two-word name (ADR-0039), avatars. Threads are
hard to tell apart at a glance. pi-ai 0.87.1 has an image API
(`createImagesModels`, `openrouterImagesProvider`) with about sixty
OpenRouter image models, and Pineta already stores pasted images by content
(ADR-0042).

S60 found:

- Nano Banana 2's preview (`google/gemini-3.1-flash-image-preview`) makes
  8:1, close to the header's shape (448 × 34 to 55px). The released model
  refuses anything wider than 21:9. pi-ai sends no ratio; OpenRouter's
  `image_config.aspect_ratio`, added through `onPayload`, is honoured.
- About 9 seconds and half a cent an image.
- A light image made the header's name unreadable. A brief asking for a dark,
  low-key image, darkest on the left, kept it legible with no scrim.

**Decision.**

- **A thread owns its banner:** a host-written `pineta.banner` value keyed by
  its lane (`{ lane, sha, focus, at }`, marginalia `work.ts`). The image is a
  blob. A branch is its own thread, so it gets its own.
- **Off unless the user config enables it:**
  `{ "banner": { "enabled": true } }` in `~/.config/pineta/config.json`, with
  an optional `model` (`provider/id`) and `aspectRatio`. Disabled, nothing is
  made and the agent has no tool; banners already stored are still drawn.
  Enabled with no key for the model's provider: nothing is made, and the host
  says so once at start.
- **A lane's run's end makes one for a thread with none** (`planBanner`), and
  only for that lane. Enabling banners never makes one for every old thread,
  and a failed one is tried again at the thread's next run's end. `recover`
  has no banner step.
- **Two model calls.** The text model (`describeModel`, as for a commit
  message) writes a brief from the `column-banner` skill: the thread's name,
  its own messages from its first prompt, and what came before it in the room
  left (`bannerRequest`). The image model draws the brief.
- **The skill is the person's to edit.** Pineta's `column-banner` is
  `disable-model-invocation: true`. A user's or repo's skill of that name
  replaces it, and it is read at every banner.
- **The model never draws text.** The header lays the name over the image, as
  it did before.
- **Retries change the ratio.** Up to three attempts: the configured ratio,
  then 21:9 (`ratioFor`). A model that refuses the configured ratio still
  gets a banner, and no error text is parsed.
- **A drawn image is fitted as an upload is,** in pi, by `prepareImage`,
  which reads its type from its bytes and fits it to 2000 × 2000, as
  `read`'s images are (ADR-0051). Bytes that are not an image are a failed
  attempt.
- **`set_banner` is the person's control, through the agent.** A pasted
  image by its `/blob/` path, the person's words for a new one, or a crop
  (`focus`: top, center, bottom) of the one there is. The agent is offered
  it only when banners are on and the host has tools. It answers once the
  ask is planned:
  a pasted image or crop is written before it returns, and a new image
  arrives seconds later. A banner a run's end started gives way to one the
  person set meanwhile (`bannerStillWanted`).
- **No history.** A replaced banner's blob is no longer referenced, and the
  blob sweep deletes it after the grace. `referencedBlobs` counts every
  banner, so a banner nothing else shows is kept.
- **Drawn under the header's content**, `object-fit: cover` with the focus as
  its `object-position`, fading in once loaded. The colour stripe stays.

**Consequences.**

- A thread's messages go to OpenRouter as the brief's input. This was
  accepted when banners were designed; the setting is off by default.
- The model is a setting because the default is a preview, which OpenRouter
  can withdraw.
- pi stores a lane's active tools once they are set (a landing sets them),
  and fails a run whose list names a tool not registered. So `set_banner`
  is registered whenever the host has tools, and answers that banners are
  off when they are; `withGuidance` sets the whole list, so a lane stored
  before banners were turned on or off gets the current list at its next
  run's end.
- A header's image is up to 2000 × 240, far more than it shows. Resizing to
  the header's size would need more than `prepareImage` does.
- Every banner costs two model requests: the brief, then the image.

**Alternatives rejected.**

- **The model draws the name.** Image models misspell text, and the name
  could not be fitted to a strip 35px tall.
- **Keyed by column.** A column is a client's layout, never stored; a thread
  lasts.
- **Made at every start for every thread without one.** Enabling banners
  would have drawn one for every thread that ever ran.
- **A scrim over the image.** A dark brief made the name legible without
  one.
- **Read the refusal and fall back.** Matching OpenRouter's error text is
  brittle; the second attempt asks for a ratio every model has.
- **A `LaneHooks` method for the tool.** Those are lane work's (turns,
  guidance); banners are not, so the agent takes a `banners` option.
- **A regenerate item in the header's menu.** The tool covers it: the person
  asks the agent.
