# ADR-0100 — One vocabulary: accepted work, accept, publish, catch up; `pinetrie-accepted`, and config by concept

- **Status:** Accepted (Duane, 2026-10-07)
- **Area:** `docs/glossary.md`, `docs/the-jujutsu-repo.md`
- **Evidence:** S121
- **Amends:**
  - ADR-0060: the line is *accepted work* in code too, and its bookmark is
    `pinetrie-accepted`; a base names accepted work by kind.
  - ADR-0083: the code's verb for an offer integration is *accept*, and an
    integrated-offer commit is an accepted-offer commit.
  - ADR-0090: the code says *accepted work* and *accept* as the page does;
    `offers` is replaced by `accepted`, `wip` and `publish`.
  - ADR-0099: `offers.catchUp` is `publish.catchUp`, and `publishCatchesUp` in
    code.
- **Amended by:**
  - ADR-0118: accepted work is a branched source's.
  - ADR-0153: the accepted-offer commit is the accepted thread commit.
  - ADR-0156: *offer* is retired; the word is **changes**, and **proposed
    changes** in code.

**Context.** ADR-0090 made the page say **accepted work** and **accept**,
and left the code saying *the line* and *integrate*, and the repo and the
config saying *onto*. One concept has had five names: the integration
line, the line, the project, `onto`, accepted work. One act has had four:
take, land, integrate, accept, and *take* also names putting a card in
your inventory. A person reading the page, the agent reading
its orientation (`packages/pi/lane.md`), and anyone reading the code or the
docs each meet different words, and a conversation about the work has to
translate between them. "Line" also already means two other things in the
code: a Kyneta command Line (`host/control.ts`) and a line of text.

`pinetrie-onto`, the bookmark in your repo, was always the least clear of
them: it names a preposition, not a thing. And `offers.catchUp` sits beside
names of bookmarks it has nothing to do with: it is about publishing.

**Decision.**

- **One word per concept, everywhere**: the page, the agent's orientation,
  the docs, the code, the wire and the store. `docs/glossary.md` is the
  list, and the living docs link to it.

  | concept | word | code | retired |
  |---|---|---|---|
  | the commits finished work lands on | **accepted work** | `accepted` | the line, integration line, the project, `onto` |
  | moving an offer into accepted work or a WIP | **accept** | `accept` | integrate, take (of an offer), land, add to the project |
  | the commit an accepted offer leaves | **accepted-offer commit** | `AcceptedOfferCommit` | integrated-offer commit |
  | moving the publish bookmark to accepted work | **publish** | `publish` | |
  | bringing your files or a thread up to date | **catch up** | `catchUp` | update, follow |
  | a thread's work, waiting to be accepted | **offer** | `offer` | |
  | a bookmark a thread may start from and be accepted into | **WIP** | `wip` | |
  | where a thread starts | **base**: accepted work or a WIP | `base` | |

  *Take* stays the inventory's verb (ADR-0083: a person takes a card into
  the inventory); it no longer names anything done to an offer. Kyneta's
  command Line keeps its name: it is Kyneta's word, and once
  accepted work is not a line, it is the only Line in the code.

- **The bookmark is `pinetrie-accepted`.** A starting host renames
  `pinetrie-onto` to it in your repo, once: the bookmark (`jj bookmark
  rename`), and the `immutable_heads()` setup wrote in your repo's config,
  the one value there that names it (`revsets.log` names only the offers).
  It is the first command on the repo owner, which a starting host waits
  for before lane work or the offers read your repo, so one writer still
  writes your repo (ADR-0065). It acts only when the
  config names no bookmark of its own; it is gather, plan (pure) and
  execute, and each of its two writes is planned from what the repo holds,
  so a start that stopped between them finishes the other on the next.
  Otherwise it does nothing and says why. Its code is tagged
  `pre-accepted:`, as the lanes' rename is `pre-rename:`, and is deleted
  once Duane's repo has passed it.

- **A base names accepted work by kind, not by bookmark.** A new base's
  trailer is `Pinetrie-Base: accepted@<commit>`; a WIP's still names its
  bookmark (`wip/x@<commit>`). A trailer whose name starts with the WIP
  prefix is a WIP base; any other is accepted work. Old trailers
  (`pinetrie-onto@…`) live in lanes' histories, which nothing rewrites, and
  read as accepted work by that rule, with no shim; a later rename of the
  bookmark in config strands no thread. The same rule reads the
  `Pineta-Base: pineta-onto@…` trailers from before the pine·trie rename,
  which core special-cased as no base. One function in core decides a
  base's kind from its trailer, for every reader. A lane's base and
  catch-up commits are titled in the words too: `base: accepted work`,
  `catch up: accepted work`, and `copy of <wip>`.

- **Config by concept.** The `offers` key goes:

  ```json
  { "accepted": { "bookmark": "pinetrie-accepted" },
    "wip": { "prefix": "wip/" },
    "publish": { "bookmark": "main", "catchUp": false } }
  ```

  Each key is read from the user's config and the project's `pinetrie.json`,
  the project's winning (ADR-0099). A config that still has `offers` is
  not read for it, and the host says at startup what replaced it. Nothing
  rewrites a config file.

- **Stored and sent names change with the words.** The record
  `pinetrie.line` becomes `pinetrie.accepted`; a base's kind `"line"`
  becomes `"accepted"`; the `line` command becomes two, `setup` and
  `publish`; the offer action `integrate` becomes `accept`; error codes
  follow (`no_line` → `not_set_up`). Records are the host's caches: the
  host rewrites them. A starting host deletes every record whose namespace
  no `RecordSpec` declares, so a renamed record leaves nothing behind, this
  time or later. An offer record's `integratedAs` is read as `acceptedAs`
  until every host has rewritten its records, as ADR-0083 did for `taken`.
  The page and the host ship together, so the wire needs no overlap.
- **What a thread's history holds keeps its stored form.** A fact (ADR-0080)
  and a catch-up's message are pi messages in a thread's history, which
  nothing rewrites. Their stored values keep the words they were written
  with (an acceptance's fact is stored as `integrated`, a base as `line`),
  and are mapped at the storage edge to the words inside (AGENTS.md:
  awkward representations only at the edges). The model reads their
  worded content, never the stored kind.

- **The publish setting is `publishCatchesUp` in code**, so `catchUp` names
  only catching up: the act, and its preview.

**Consequences.**

- The first start after this renames a bookmark in your repo, which `jj op
  log` shows and `jj op revert` undoes, and rewrites `immutable_heads()` in
  your repo's config, which is a file, not a jj operation: undoing it is
  `jj config set --repo` by hand. jjui with a revset of its own that names
  `pinetrie-onto` needs the same edit by hand; the startup line says so.
- Your `config.json` and a project's `pinetrie.json` that set `offers` need
  editing once. Until then the defaults hold, and the startup line names
  the keys.
- A large mechanical rename touches most packages. It lands as a stack by
  concept (accept, accepted work, config, the bookmark, the docs), each
  step whole across every layer, so each passes the gates on its own.
- A record namespace no spec declares is deleted at start, whatever left
  it: a record type is retired by deleting its spec.
- Old ADRs keep their words: they record what was decided then. Each ADR
  this amends says so in its status.

**Alternatives rejected.**

- **Keep the code's words, translate at the page** (ADR-0090's choice).
  Every conversation about the work translated between them, and the agent
  read the code's words in its orientation.
- **Keep `pinetrie-onto` as a name, not a word.** It is the one name a
  person sees in jj and jjui, and it said nothing about what it held.
- **A shim that reads `pinetrie-onto` trailers by name.** Lanes' histories
  are never rewritten, so a shim could never be deleted. Reading by kind
  needs none.
- **Rewrite config files at boot.** A project's `pinetrie.json` is tracked;
  a host editing it leaves a change in your working copy you did not make.
- **A `line` command kind renamed to `accepted`.** "Set up" and "publish"
  are what a person presses; one command each says so.
