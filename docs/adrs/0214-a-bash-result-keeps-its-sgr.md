# ADR-0214 — A `bash` result keeps its output's SGR: the row draws it as styled lines, and the model reads none

- **Status:** Accepted (Duane, 2026-10-25)
- **Area:** `docs/06-interface.md`, `packages/shell/TECHNICAL.md`,
  `packages/threads/TECHNICAL.md`, `packages/pi/TECHNICAL.md`,
  `packages/interface/TECHNICAL.md`, `packages/web/TECHNICAL.md`
- **Evidence:** S342
- **Amends:**
  - ADR-0123: a row's output is drawn in the styles its program wrote it in.
  - ADR-0204: the `bash` result's text differs from pi's tool's on escape
    sequences: an SGR is kept, any other dropped whole; a line with stderr is
    marked by a bar in its margin, not a colour.

**Context.** A program that colours its output into a pipe (vitest does)
left `[2m Test Files [22m [1m[32m575 passed[39m` on its row: pi's
`sanitizeBinaryOutput` deletes ESC and keeps the rest of each sequence
(S342). The colours were lost, and their parameters shown as text. The
client is split so a terminal client can come (ADR-0194): what any client
shows is interface's, how the browser draws it the page's.

**Decision.**

- **The stored text keeps SGR.** The capture
  (`packages/pi/shell-capture.ts`) keeps each SGR as written, drops every
  other escape sequence whole, and runs pi's sanitiser only on the text
  between, so it can never take an SGR's ESC. The result, its live stream
  and its stored split by statement all carry it. The storage format stays
  a string; SGR is the format terminals already write style in.
- **The model reads none.** `providerMessages`, which every model request
  passes (S342), drops every escape sequence from a terminal tool's result
  (`plainBashResults`), interrupted calls' included. Any other tool's result
  is read as stored.
- **One rule says which tools write terminal output**
  (`isTerminalOutputTool`, `@pinetrie/threads`): `bash` alone. The model's
  edge, the row and the copy ask it, so they cannot disagree.
- **The parse is the shell package's** (`@pinetrie/shell`, `terminal.ts`):
  a style as plain values (`TerminalStyle`, a `PaletteIndex` only
  `paletteIndex` makes), and folds over one tokeniser: keep only SGR, drop
  every sequence, runs by style.
- **Interface parses before the view.** `rowOutput` and the split's
  builders turn the text into lines of styled runs; `rowView` only cuts
  them, counting visible characters, and never sees an escape. Parsing
  before the cut keeps a colour set above a hidden line. A copy drops the
  escapes.
- **stderr and a program's colours never compete.** A run carries both its
  style and whether it came through stderr. The stderr ranges a record keeps
  count the stored text's escape sequences, and each styled run knows where
  it starts in that text, so a range cuts runs exactly, with no mapping. A
  colour is the program's; stderr is shown another way, so a red failure
  line written to stderr is both red and stderr. The page draws stderr as a
  bar in the margin of the line, a shape that reads without telling colours
  apart.
- **The page draws a style as CSS** (`output-style.ts`): the 16 basic
  colours are the stylesheet's `--ansi-N`, light and dark, each 4.5:1 or
  more on `--sunk`; the 256-colour cube, its greys and RGB are drawn as
  written. A terminal client would write a style back as SGR.

**Consequences.**

- pi's limits count escape bytes, as pi counts every byte it read. A
  heavily coloured output reaches the 50 KB tail sooner, so the model sees
  fewer visible characters, and a "Showing lines …" note that differs from
  pi's tool. The model and the row must cut at the same place, so this is
  kept.
- Compaction's summariser converts with pi's own `convertToLlm`, not
  `toProviderMessages`, so it reads SGR. That costs tokens and harms
  nothing; fixing it would mean always running our own `compact`.
- A tail cut inside one very long line can begin inside a sequence, whose
  parameters then show as text.
- Rows stored before this keep their residue: it is plain text.

**Alternatives rejected.**

- **Strip every escape and draw no colour.** It drops what the person wants
  to see, and the row and the model would still each need the stripping.
- **Plain text in `content`, the styled copy in `details`.** The model and
  the summariser would read clean text with no edge to remember. But pi
  gives a thrown result no `details` (S342), and a failed command is thrown:
  a failing test run, the most coloured output there is, would lose its
  colours. It also stores the output twice.
- **Store styled runs as JSON.** A precise type in storage, several times
  the size in the document for every result, and apart from what pi
  stores. Interface parses SGR into precise values as it reads instead.
- **Parse in the page, or inside `rowView`.** A terminal client would
  re-implement the parse and the cuts; inside `rowView` the view would
  interpret stored data on every render and could draw raw escapes if a
  caller forgot to parse.
- **stderr as a text colour.** A program that colours its stderr (a test
  runner's failures, a compiler's errors) would force a choice of which
  colour wins, and either loses something.
- **Each package checks `BASH_TOOL` itself.** Three copies of one rule
  drift; one predicate in threads, which all three declare, cannot.
