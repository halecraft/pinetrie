# S145 — A selection's text is the drawn text, not the markdown: across formatting it is in no message's text as written

- **Status:** Answered

**Question.** Cmd+C on a selection inside a message takes a range of the
message's text (ADR-0126) by finding the selection's text in the message's
markdown (`node.text.indexOf(selection.toString())`). How often is a
selection's text in the markdown?

**Kill criterion.** A selection that crosses formatting still reads as its
markdown: then finding it is enough.

**Throw away.** The probe, `docs/findings/archive/S145-selection-text/probe.mjs`,
kept only as the record of what ran.

## Answers

**Only a selection inside one run of plain text is found.** In headless
Chromium (Playwright 1.56), a message drawn from

```markdown
Use `foo` and **bar**
next line

- a
- b
```

gives these selections' `toString()`:

| selected | text | in the markdown |
|---|---|---|
| the whole message | `Use foo and bar next line\n\na\nb` | no |
| `Use foo` | `Use foo` | no |
| the bold word | `bar` | yes |

A code span, emphasis, a link, a list item or a soft line break each draw
text other than their markdown, so a selection across any of them is in no
message's text as written.

**So the whole message is not the fallback.** Cmd+C took the whole message
for each selection not found, so selecting a phrase with a code span in it
copied the message. A selection no range names is now copied as the
browser copies it, and nothing is taken. Naming those selections needs the
drawn text mapped back to the markdown (the source positions remark keeps
on each node), which nothing builds yet.

**Also read from source.** A range's offsets are read back: a link to a
range in a sent message is quoted to the model by slicing the message's
text (`pastMarkdown`, `packages/rules/links.ts`). Ranges stay.
