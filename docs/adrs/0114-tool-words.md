# ADR-0114 — A tool keeps its id for the model and has a word for people; core reads a call, interface words it, and shell source is `@pinetrie/shell`'s

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `docs/06-interface.md`, `packages/web/TECHNICAL.md`,
  `packages/interface/TECHNICAL.md`, `ARCHITECTURE.md`
- **Evidence:** S138
- **Amended by:**
  - ADR-0172: the tool tags read as what a call did: read, wrote, edited, ran,
    searched, looked for; the conflict tool's is "asked you".
  - ADR-0173: `bash`, `edit` and `write` take a required `intent`, which never
    reaches pi.

**Context.** A tool call's row began with the tool's id: `bash mkdir -p
/tmp/wc && …` read as a shell running `bash mkdir`, and `bash`, `grep` and
`ask_about_conflict` mean nothing to a person who does not code. The id is
what the model calls, so it could not change for people without changing
for the model. Core, a dependency of every package, worded the label
(`toolLabel`, `wholeToolLabel`) and stored it on every call, though only
people read it. And an agent's command is often one long line of `&&`
steps, cut mid-word in the closed row and one wrapped block in the open one.

**Decision.**
- **A tool's id is the model's.** `TOOL_IDS` in `packages/core/tools.ts`
  names every tool pine·trie registers, each string written once as a
  constant, in the order the model is given them. pi registers from a table
  keyed by `ToolId`, so a tool with no factory fails to compile. The model
  still calls `bash`: its training, pi's own hints ("Use bash: …") and every
  stored session keep the id.
- **A tool's word is people's**, from one table in
  `packages/interface/tool-words.ts`: `bash` reads "shell", `grep`
  "search", `ask_about_conflict` "ask", `catch_up` "catch up". A row shows
  it as a tag at its top right, where a code block's language label sits,
  so it is never read as part of the command.
- **Core reads a call; interface words it.** A `ToolCall` holds facts: its
  id, its tool's name, what it touched (`subjectOf`), its result. Every label
  is `callLabel`'s, in interface: the copied text, an ask's live line, and
  the host's revision titles.
- **Shell source is `@pinetrie/shell`'s**, which declares only `unbash`, and
  only interface declares it. `readShell` gives a command's runs by role
  (command, option, string, variable, …) and, for a one-line command wider
  than the column, a layout that breaks it at its structure, one `&&` step a
  line. A layout copies every leaf from the source, and is kept only when
  unbash's printer, which ignores line breaks, reads it back the same.

**Consequences.**
- A row draws its tag, its preview (the subject's first line, cut at 120
  characters) and, opened, its whole (`rowSummary`, `tool-row.ts`), each in
  runs the page colours by role.
- The page carries unbash, 24 KB gzipped. A command with lines of its own,
  or that does not parse, is shown as written.
- Revision titles and copied calls read `shell …` and `search …`. Stored
  sessions need no migration: their calls are named by id.
- A later tool's view (a read's range, a search's files, an edit's diff)
  joins the same table by id in `tool-row.ts`.

**Alternatives rejected.**
- **Rename the tool for the model.** It costs the model's training on
  `bash`, leaves pi's own hints wrong, and leaves stored calls named `bash`
  that must still render.
- **The tool's name beside "AGENT".** pi runs a message's calls in parallel
  by default, and a message often makes two; a header cannot say which row
  is which tool.
- **Words in core.** Core is a dependency of every package, and ADR-0093
  moved what people see out of it. The host declares interface already.
- **shfmt as wasm** (264 KB, or 173 KB): it never breaks an `&&` chain, and
  its AST is lossy. **tree-sitter-bash** (259 KB): the printer would be ours
  too. **shiki** (62 KB): a second parser for what unbash's AST already
  marks. **`@aliou/sh`** (10 KB): a parser only, and unfinished.
- **unbash in `@pinetrie/interface`**: it would widen interface's pinned
  dependencies with code about shell syntax, not about pine·trie.
