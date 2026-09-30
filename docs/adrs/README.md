# ADRs, one file each

From ADR-0048 on, each decision is its own file here, `NNNN-slug.md`, so two
lanes writing decisions at once do not edit the same file. ADR-0001 to
ADR-0047 stay in `../02-decisions.md`.

The format is the same as there: a title line (`# ADR-NNNN — …`), then
**Status**, **Context**, **Decision**, **Consequences** and **Alternatives
rejected**. An ADR that is superseded or amended is marked in place, never
deleted: the rejected reasoning is the valuable part.

**Numbering.** Take the next number free on the trunk. If two lanes take the
same one, whichever lands second renumbers its file and its references.
