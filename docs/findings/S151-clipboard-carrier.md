# S151 — How a copy carries pine·trie's own data through the system clipboard, and whether copy and paste fire away from a text box

- **Status:** Answered
- **Led to:** ADR-0132

**Question.** The clipboard and inventory redesign (with Duane,
2026-10-11) makes Cmd+C a copy and nothing else, Cmd+X a cut (a copy,
then a discard), and Cmd+V a paste whose result depends on what was
copied and where it lands: a copied card pastes in a text box as a
reference, a copied selection as its text, and into another app as text.
It also shows the last thing copied in a clipboard cell beside the
inventory. That rests on three beliefs no one has measured:

1. **The carrier.** A copy can put pine·trie's own data (an address, a
   card's id, a nonce) on the system clipboard beside `text/plain`, and a
   paste in pine·trie gets it back: in the same page, on another origin,
   and in another browser on the same machine. Which carrier survives
   each path: a custom MIME type set in the `copy` event
   (`application/x-pinetrie`), a `data-pinetrie` attribute in `text/html`,
   or the async Clipboard API's web custom formats (`web …`)? Which types
   reach the operating system's clipboard?
2. **The events.** With focus on a card that is not a text box, and
   nothing selected, does Cmd+C (Ctrl+C) fire `copy`, Cmd+X `cut`, and
   Cmd+V `paste`, in Chromium, Firefox and WebKit? Where one does not
   fire, does a workaround make it: a selection placed on a hidden
   element at keydown, a hidden text box focused at keydown, or
   `navigator.clipboard` called from the keydown?
3. **Telling copies apart.** Can a paste always tell a copy pine·trie made
   from one made in another app, so the clipboard cell can say it is out
   of date? And can a page learn what the clipboard holds without a
   paste: `navigator.clipboard.read()`/`readText()` with no permission
   asked, and on focus?

**Kill criterion.** If no carrier survives a paste in the same page in
every engine, a paste cannot tell a card from text, and the paste rule
(by source and target) has no ground: copy writes text alone, and the
put key remains the only way a card lands as a card. If `copy` or `paste`
cannot be made to fire away from a text box in some engine, Cmd+C/Cmd+V
on cards there must be a keydown that writes and reads through
`navigator.clipboard`, whose permission prompts then decide whether the
design holds.

**Throw away.** The probe page and its runner. They are kept in
`docs/findings/S151-clipboard-carrier/` as a record of what ran, since the
plan builds on the answers, and are not maintained.

## Answers

Measured on Linux, in a lane (aarch64), with Playwright 1.56.0's headed
Chromium 141.0.7390.37, Firefox 142.0.1 and WebKit 26.0 (WebKitGTK),
all three open at once under one X server (`xvfb-run`), so a copy in one
reaches the others through the X clipboard. Two origins on one server,
`http://127.0.0.1:<port>/` and `http://localhost:<port>/`. Keys are
Playwright's trusted input; a sanity step first checked that Ctrl+C in a
textarea puts its text on the X clipboard in each engine, so the keys run
the browser's own command. `xclip` read what reached X.

Then Safari on macOS (version not recorded), by hand (Duane,
2026-10-11): the same page served by `python3 -m http.server`, Safari and
Chrome on `localhost`, Safari on `127.0.0.1` too, through the steps under
*Safari*, below. Every page's nonce was the probe's default, `n0`, so
which page a paste came from is read from the order of the steps.

1. **The carrier: `text/html` carries it everywhere; a custom type only
   within one browser.**

   | copied in → pasted in | `application/x-pinetrie` (copy event) | `data-pinetrie` in `text/html` |
   |---|---|---|
   | same browser, same origin | kept, all three | kept, all three |
   | same browser, other origin | Chromium and Firefox kept it; **WebKit dropped it** | kept, all three |
   | another browser | dropped, every pair | kept, every pair |
   | the X clipboard | inside each engine's own wrapper (`chromium/x-web-custom-data`, `application/x-moz-custom-clipdata`, `org.webkitgtk.WebKit.custom-pasteboard-data`) | plain `text/html` |

   - **The attribute arrives re-serialized** when WebKit is on either
     side across origins, or after a rich text box: written as
     `data-pinetrie='{"nonce":…}'`, it is read as
     `data-pinetrie="{&quot;nonce&quot;:…}"`. WebKit pastes HTML into a
     dummy document and serializes it again, on write and on a read from
     another origin (WebKit blog, "Clipboard API Improvements", 2018,
     r223440). So a reader must parse `text/html` (`DOMParser`) and read
     the attribute, never match the string.
   - **WebKit keeps custom types to one origin by design** (the same
     post, r222595): they ride under one WebKit-owned type and are given
     only to pages of the origin that wrote them. Safari did the same
     (*Safari*, below).
   - **A rich text box can bring a carrier back stale, in Firefox.** The
     copied card pasted into a `contenteditable` kept its `data-pinetrie`
     in all three; copied out again, Firefox kept the attribute and
     Chromium and WebKit dropped it (they write the span with computed
     styles and no `data-` attributes). A person who pastes a card into
     a rich editor in Firefox, changes its text and copies it again
     carries the old carrier with new text. A carrier must therefore say
     what text it was written with (its `text/plain`, or a hash of it),
     and a paste trusts it only when they match.
   - **The async Clipboard API is no way round it.** From the keydown
     (its own copy cancelled), with a `web application/x-pinetrie` item:
     WebKit wrote it (`web application/x-pinetrie` on X, read back only
     by the same origin in WebKit); Firefox refused the type ("not
     supported for write") and wrote `text/plain` and `text/html` alone;
     Chromium's `write()` had not settled 3.4 s later, and wrote nothing.

2. **The events fire away from a text box, in all three engines
   measured.** With focus on a `tabindex="0"` div and nothing selected,
   Ctrl+C fired `copy`, Ctrl+X `cut` and Ctrl+V `paste`, each with a
   writable or readable `clipboardData`; `setData` of all three types
   succeeded, and `preventDefault` made them what was written. No
   workaround was needed, so none was measured. In a textarea, `paste`
   carries the same types as on the card, so a paste in a pine·trie text
   box can see that a card was copied and insert a reference in place of
   the text.
   - **Safari fired them too, with no workaround.** Read from WebKit's
     source before it ran, Safari looked as if it might need the
     before-events cancelled: on macOS Cmd+C and Cmd+V are also the Edit
     menu's, whose items `enabledCopy` and `enabledPaste` enable only
     for a selection, a place to edit, or a cancelled `beforecopy`,
     `beforecut` or `beforepaste` (`Editor::canDHTMLCopy`,
     `EditorCommand.cpp`), while a key binding runs Copy and Cut even
     disabled (`allowExecutionWhenDisabledCopyCut`), which is why
     WebKitGTK fired them. Measured, that belief was wrong: with the card
     focused, nothing selected and every trick off, Cmd+C, Cmd+X and
     Cmd+V fired `copy`, `cut` and `paste`. Each was preceded by its
     before-event twice, not cancelled. With focus on the body and
     nothing selected, Cmd+C still fired `copy`.

3. **A paste can tell pine·trie's copy from another app's, but nothing
   but a paste can learn what the clipboard holds.**
   - A copy made outside (`xclip -i`, which offers only `UTF8_STRING`)
     pasted as `text/plain` alone in Chromium and Firefox: no carrier.
     WebKitGTK's `paste` event listed no types at all for it, while its
     textarea pasted the text: WebKitGTK reads `text/plain;charset=utf-8`
     into `clipboardData`, which `xclip` did not offer. That is the X
     clipboard's, not Safari's.
   - A copy from another pine·trie page carries its own carrier, so a
     nonce per copy tells them apart.
   - **Reading without a paste is refused or prompts, everywhere.**
     `navigator.clipboard.readText()` and `read()`, with no permission
     granted, from a script and from Ctrl+V's keydown: Firefox and WebKit
     rejected them (`NotAllowedError`); Chromium had not answered 2.5 s
     later (its permission prompt). So the clipboard cell cannot know it
     is out of date before the next paste, and must not claim to: it
     shows the last thing copied in pine·trie, and a paste that brings
     something else (no carrier, or another nonce) updates it.

4. **Paste as text alone (Cmd+Shift+V) gives a paste only in Chromium
   and Firefox**, measured after the rest, while planning, by
   `shift-v.mjs` (the same page, Linux, the same three engines). A card
   copied, then Ctrl+Shift+V:

   | engine | on the card | in a textarea |
   |---|---|---|
   | Chromium | `paste`, `text/plain` alone | `paste`, `text/plain` alone, the text pasted |
   | Firefox | `paste`, `text/plain` alone | `paste` with all three types, the text pasted |
   | WebKitGTK | no `paste` | no `paste` |

   Ctrl+Alt+Shift+V gave no `paste` in any of them. Where the browser
   strips the paste to `text/plain`, no carrier arrives, so the paste
   lands as text by the ordinary rule; Firefox's textarea keeps the
   carrier, so a paste must also remember that Shift was held at its
   keydown (which every engine logged before its `paste`). Safari binds
   Paste and Match Style to Opt+Shift+Cmd+V; it was not run.

**Safari.** The log is in `results-safari.txt`.
1. **Events:** above (2). Fired with every trick off.
2. **On the same page:** the paste had all three types, the custom
   type's JSON whole, and `text/html` as written.
3. **From another browser and another origin:** both later pastes onto
   the card had `text/plain` and `text/html` and no
   `application/x-pinetrie`. Their `data-pinetrie` was re-serialized
   (`{&quot;nonce&quot;:…}`) with computed styles added to the span. By
   the steps' order these were Chrome's copy (step 2) and Safari's on
   the other origin (step 3); with one nonce on every page the log
   cannot say which was which, and either way the HTML carrier arrived
   and the custom type did not, as on Linux.
4. **Into TextEdit and Notes, and Safari's copy pasted in Chrome:** not
   reported. Chrome's paste of another browser's copy was measured on
   Linux (1).

**Kill criterion: not met.** A carrier survives every path measured
(`text/html`), and the events fire away from a text box in Chromium,
Firefox, WebKitGTK and Safari, with no workaround.

**What the plan can rest on.**
- Write both carriers in the `copy`/`cut` event: `text/plain` (what
  another app gets), `text/html` holding the thing as HTML with a
  `data-pinetrie` attribute, and `application/x-pinetrie` with the same
  JSON. Read the custom type first; else parse `text/html` and read the
  attribute; else it is text from elsewhere. A carrier names the text it
  was written with, and counts only when the paste's `text/plain` matches.
- Use the clipboard events, not the async API, for copy, cut and paste;
  `navigator.clipboard` stays only where a button writes (`useCopy`).
  No engine needs a workaround: no hidden selection, no hidden text box,
  no cancelled before-event.
- The clipboard cell is pine·trie's memory of its last copy, corrected
  by the next paste.

**Sources** (`docs/findings/S151-clipboard-carrier/`):
- `probe.html`: the page. It logs every clipboard event and API call
  to `window.log` and on the page; its checkboxes turn on the
  workarounds and the async API.
- `run.mjs`: the runner, `xvfb-run -a node
  docs/findings/S151-clipboard-carrier/run.mjs` (it needs Playwright's
  Chromium, Firefox and WebKit, their system libraries, and `xclip`).
- `results.json`: its last run's output, every event as logged.
- `results-safari.txt`: Safari's log from the run by hand.
- `shift-v.mjs`: the Ctrl+Shift+V run (answer 4), `xvfb-run -a node
  docs/findings/S151-clipboard-carrier/shift-v.mjs`.
