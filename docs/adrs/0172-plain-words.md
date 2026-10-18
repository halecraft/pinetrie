# ADR-0172 — Plain words everywhere: a glossary concept that changes its word changes it in the page, the code, the store and the agent; `yours` takes one name per meaning

- **Status:** Accepted (Duane, 2026-10-18)
- **Area:** `docs/glossary.md`, `docs/06-interface.md`,
  `packages/interface/TECHNICAL.md`, `packages/rules/TECHNICAL.md`
- **Amends:**
  - ADR-0114: the tool tags read as what a call did: read, wrote, edited, ran,
    searched, looked for; the conflict tool's is "asked you".
  - ADR-0153: the identifier `yours` it left in place takes a name per meaning
    (`workingCopy`, `repo`, `other`, `merged`, `mine`).

**Context.** An inventory of every word the page shows
(2026-10-17) found jj's terms in labels (change ids, bookmarks, `jj
rebase …` in a title), programmers' words (*raw*, *shell*, *.gitignore*,
*ssh*), game words where a plainer one exists, and labels that named a
task or a thread where they meant a canvas. Duane approved every row, and
said the approved glossary words apply everywhere, not on the page
alone: the agent tells people things in the same words the page shows.

Separately, the identifier `yours` carried seven meanings in the code:
your `@-` line against accepted work, your repo against a lane's, an edit
not the host's, `@` moving and its files, the commits a base checks out,
what a land merged, and the viewer's own.

**Decision.**

- **A glossary concept whose word changes takes its new word
  everywhere**: the page, the code's names, what is stored and sent, the
  docs, and what the agent is told. One word per concept still holds
  (ADR-0100). The concepts that move: *catch up* becomes *get the
  latest*; a *WIP*, *unfinished work*; *approve / refuse / revoke*, *allow
  / deny / take back*; the agents' *budget*, an *allowance*; a *local*
  path, a *private* one; *keep* (the clipboard cell into a slot), *save*;
  *take* (a thread into your inventory), *put away*; *heard*, *incoming*;
  *discard*, *trash*.
- **Kept, because each new word would have meant two things:** *stack*
  and *squash* (Duane: jargon, but clear; "steps" already counts an
  ask's messages), and *put*, the verb, beside *place*, the noun for where
  a card is.
- **Three kinds of name are not ours to change, and stay:** the tool ids
  the model calls (`catch_up`, `split_proposed_changes`), as `bash` stayed
  (ADR-0114), since the model's training and every stored call name them;
  jj's and the config's names (the `wip/` prefix and `wip.prefix`,
  `pinetrie-proposed/…`, `publish.catchUp`, `agents.budget`), and the
  titles of the commits pine·trie writes into jj history, which match the
  commits already there.
- **Stored kinds migrate.** A stored value that names a renamed concept
  is rewritten once: a record by `rewriteRecords`, a history message's
  details by `rewriteHistory` (`apps/pinetrie/host/migrations/rewrite.ts`),
  `content`, what the model read, never.
- **Words outside the glossary change in their word function**, and a
  value a suite or the protocol reads stays (`Density`'s `"raw"`).
- **jj's ids and bookmark names move from labels to titles and details**,
  never off the page.
- **`yours` takes one name per meaning:** `workingCopy` (and
  `ERR.WORKING_COPY_CONFLICT`, `workingCopyEdits`), `repo`, `other` (with
  `host`, and `othersChanged`), `accepted` (a base's checkout), `merged`
  (a land's details), and `mine` (`afterMine`, `isMine`, the refusal
  `someone-elses`). Accepted work's record, each proposed changes record
  and every land message are renamed in place by one-time migrations.
- **A check keeps it so** (`scripts/words.test.ts`): no identifier in
  `packages/` or `apps/`, tests included, holds a retired name, but a
  migration's old shapes; and nothing people or the agent read says a
  phrase the glossary's list of phrases nothing says names. A word is
  retired for its concept, not as English, so the identifier rule never
  reads strings: "queue after yours" stays a right page word.

**Consequences.** Several stack-shaped renames across `rules`,
`interface`, `web`, `session`, `jj`, `pi` and the host, each whole across
its layers, with a migration where a kind is stored. The glossary's
**retired** column grows, and its list of phrases nothing says starts
with "your folder". Old ADRs and findings keep their words.

**Alternatives rejected.**

- **Page words read as glossary words beneath** ("catch up, read as get
  the latest"). Smaller, but two words for one concept, and the agent
  would talk to people in words the page no longer shows.
- **Renaming the tool ids and bookmarks too.** They are the model's and
  jj's names, not ours.
- **Letting old stored kinds drop.** Past lands and facts would leave the
  columns, and a lane that reads its base's news by what its lands merged
  would hear that news again.
- **"steps" for a stack, "shared" for heard, "delete" for discard,
  "place" for put.** Each already meant something else on the same page.
