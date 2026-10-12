# ADR-0053 — A thread's banner is its name's icon: a square sprite drawn from the name alone, as the thread is named

- **Status:** Accepted
- **Area:** `docs/06-interface.md`
- **Evidence:** S60
- **Amends:**
  - ADR-0050: the banner is a square icon drawn from the thread's name alone,
    as the thread is named, with no crop.
- **Amended by:**
  - ADR-0057: the icon starts when the column first wants an agent, before the
    first send.
  - ADR-0073: the icon is also drawn magnified, in the thread's details, where
    it spins in as they are opened.
  - ADR-0143: a thread's default icon is its noun's built-in 32×32 sprite,
    shipped with the page; drawing one from the name is the `drawn` source,
    and a built-in icon never shows before a drawn one.

**Context.** ADR-0050's banners were wide images behind the header, briefed
by the text model from the thread's messages and drawn at 8:1 after the
first run. In use they were hard to tell apart: the brief asked for a dark,
low-key panorama with no focal subject, and got murky scenery. Asked instead
for one pixel-art sprite, the image model drew recognisable ones, but at
8:1 a 34px header cut their tops off, and anatomy suffered (a five-legged
zebra). Only Nano Banana 2's preview draws 8:1 (S60), so the shape tied
banners to one model. And a banner came only after a run had ended.

**Decision.**

- **The banner is a square icon in the star's place.** The client draws it
  before the thread's name, in the fixed square that holds the star (✦)
  when there is no banner, so its arrival moves nothing. The prompt asks for
  a sprite on plain black; `mix-blend-mode: lighten` against the header's
  own background removes the black. A Recraft model is also sent
  OpenRouter's `image_config.background_rgb_color` of `[0, 0, 0]`, so the
  black is set by a parameter and not left to the prompt alone. Black in
  the sprite would go with it
  (a toucan lost its body), so the prompt asks for a white outline and no
  pure black in the sprite. With no crop, the record has no `focus`, and
  `set_banner` takes only an image or words.
- **Any model draws it.** Every image model draws 1:1, and OpenRouter clamps
  a ratio to what the model has. The default is Recraft V4.1 Flash
  (`recraft/recraft-v4.1-flash`): OpenRouter lists it at 0.7¢ an image and
  about 1.5 seconds. FLUX.2 Klein 4B, tried first, is listed at 1.4¢ a
  megapixel, with no way to ask a smaller image, and took about ten seconds
  in use.
  `banner.model` in the user config names another. pi-ai 0.87.1 does not
  list Recraft's Flash, so pine·trie describes an OpenRouter model pi-ai does
  not list itself (`imageModelFor`).
- **Only the name is sent.** The `column-banner` skill's body is the image
  model's prompt, with `{adjective}` and `{noun}` filled from the
  thread's two-word name (`bannerPrompt`). No text model writes a brief, and
  no message leaves for the image model. The person's direction to
  `set_banner` is added after the template.
- **It starts as the thread is named.** `createNames` reports each lane it
  names, and that lane is due a banner (`bannerDue`). A run's end
  makes it due again, which draws only for a thread still without one: the
  retry for a failed draw. Enabling banners still draws none for old threads.

**Consequences.**

- A banner says nothing about what its thread did. It is the name's mascot,
  and two threads sharing a noun get similar ones.
- One model request per banner, not two, and none to the text model.
- A pasted image is shown the same way, contained in the square: a wide
  photograph shows small.
- Records written with a `focus` still decode; it is ignored.
- An OpenRouter id that does not exist is no longer caught at start: it
  fails at each draw, logged.

**Alternatives rejected.**

- **Keep the wide image, crop higher.** Tried (`upper`, a quarter of the way
  down): the sprite still had to land in a band the model does not place
  reliably, and only one model draws the shape.
- **A brief from the name by the text model.** Two requests and seconds more
  for little: a two-word name needs no summarising, and a template is the
  same for every thread.
