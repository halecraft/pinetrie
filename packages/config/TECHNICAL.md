# `@pinetrie/config`: technical notes

pine·trie's config (ADR-0146): every setting declared once with its rule
and the layers that may set it, each layer's file decoded against those
declarations, and one pure `settle`. It declares only `@pinetrie/core`, and
only the app declares it: the table is the host's (`apps/pinetrie/host/settings.ts`).
`@pinetrie/ssh`, `@pinetrie/lanes` and `@pinetrie/jj` take settled values,
typed, and export the value parsers the table's kinds wrap.

| file | what it holds |
|---|---|
| `kinds.ts` | a kind: how one value decodes, and whether it narrows (`meet`) or adds up (`join`, `empty`); `hostCode`; `size`, a size read by core's `parseSize` (binary units, a bare `B` refused), whose limit is the smaller |
| `setting.ts` | a setting's rule and layers; `pick`, `join`, `limited`, `defineTable`; `admits` |
| `decode.ts` | a layer's file decoded (`decodeLayer`, `decodeProject`, `decodeEnv`), and its refusals |
| `settle.ts` | `settle`: every setting's value, its origins and its limits, with every refusal, in one report |
| `places.ts` | where each layer's file is, from the XDG variables (`configPlaces`); `ownDirs` |
| `sessions.ts` | a session found by its folder's real path and named for people: the registry's shape, the plans that find a session (`planSession`) and rename one (`planRename`), and the words of their refusals (`sessionWords`) |
| `read.ts` | the package's only I/O: `readConfigFile`, `readStartLayers` |
| `testing.ts` | `@pinetrie/config/testing`: `tableProblems`, the checks every table must pass; `configText`; `sessionNameFor`, a test's session name |

## The layers

From the broadest to the most specific: `system` (the first
`$XDG_CONFIG_DIRS` entry's `pinetrie/pinetrie.json`, by default
`/etc/xdg`), `user` (`$XDG_CONFIG_HOME/pinetrie/pinetrie.json`), `project`
(the project's `pinetrie.json`, as one of its copies), `local`
(`$XDG_CONFIG_HOME/pinetrie/sessions/<session>/pinetrie.json`) and `env`
(a variable a setting names). A relative XDG variable is ignored, as the
XDG spec says.

- **The local layer is keyed by the session's name** (ADR-0149), a
  `SessionName`: branded, made only by the registry's plans and its
  decoder, so `configPlaces` cannot be handed a folder's name. Two folders
  with one name are two sessions, each with its own local file.
- **A project layer is named with its copy:** `{ project: "accepted" }`,
  `"working"` or `"lane"`. A copy cannot be declared without the project
  layer. `settle` takes each decoded copy under its name, and
  `DecodedProject<C>` carries its copy in its type, so a working copy
  cannot be handed in where accepted work's is due.
- **Credentials are not config.** pi's `auth.json` is in
  `$XDG_DATA_HOME/pinetrie`, written only by sign-in. `places.dirs` names
  pine·trie's own directories, and the lanes' mount guard refuses all of
  them (`ownDirs`): a directory added to `dirs` is guarded with no other
  change.

## Sessions (`sessions.ts`, ADR-0149)

- **A session is found by its folder's real path,** in one registry,
  `$XDG_DATA_HOME/pinetrie/sessions.json`: each entry a real path, a name,
  and when a host last served it. A path and a name are each in at most
  one entry; a registry that breaks either, is not JSON, or has another
  `version` does not decode, and is never overwritten.
- **A name is the folder's** (`nameFrom`: NFC, lowercase, each run of
  what is not a letter or digit one `-`), or, when another session holds
  it, that name with a two-word suffix: the pair the path hashes to, or
  the next free one, from core's thread-name words. A name is valid when
  `nameFrom` leaves it as it is, which is what `PINETRIE_SESSION` and a
  rename are checked by.
- **`PINETRIE_SESSION` attaches a folder to a session by name** only when
  that session's folder is gone. Over the folder's own session it attaches
  only when that one holds no file (`ownHolds`, gathered). A session's
  directory holds its store from its first start (ADR-0150), so a moved
  folder is attached by `PINETRIE_SESSION` on its first start in its new
  place; a start without it makes a new session, and says only that it is
  new: nothing hints at a gone session of the same name.
- **The plans are pure:** the host gathers the real path, which entries'
  folders are gone (their path no longer its own real path) and what the
  own session holds, then writes the plan's registry
  (`apps/pinetrie/host/sessions.ts`).
- **A session another host serves is refused by the plan** (`served`,
  ADR-0211): the host tries each session's lock it may pick or drop, and
  passes those another holds, with the pid each holder wrote, for words
  only. `planRename` refuses the same way.

## The rules

- **pick:** the most specific layer in the setting's order that sets it
  decides; else its `fallback`. A setting may declare its own order:
  `lanes.ssh.personal` orders the project before you, so your choice wins.
- **join:** every layer that sets it adds to it, in its declared order,
  from the kind's `empty`. A list keeps the first of duplicates, so the
  person's shared directories come first.
- **limits:** then each limit layer's value narrows the result with the
  kind's `meet` (`and`, `min`, intersection). A limit can only narrow,
  because `meet` is a lower bound of both. A setting whose kind has no
  `meet` cannot be limited: `limited`'s type refuses it, and it throws.
- **reach:** a `hostCode` kind runs code on the host or sends a key
  somewhere. It may name only `system` and `user`: `AdmissibleLayers` holds
  it in the types, and `tableProblems` holds it for a table built around
  them.
- **`effectiveLaneConfig` is the one narrowing outside the table.** A
  lane's own copy of `pinetrie.json` gives up what it dropped from the copy
  it started on, which needs three copies, not two values a `meet`
  combines. The host applies it to the project layer before `settle`, so a
  system limit still applies after it (`laneCopy` in the host's settings).

## Decoding

`decodeLayer` takes a file's text, so no other package parses a config
file. It walks the JSON:
- at a key a setting names, the setting's kind decodes the whole subtree;
- at a path that is a prefix of some key, it expects an object and
  recurses; anything else there is `malformed`;
- at any other path, the key is `unknown`.

A key a setting has, in a layer it does not admit, is `not-here`, and is
not decoded. A file that is not JSON, or not an object, is `broken`, refused
whole. `defineTable` throws at load when one key is a prefix of another: the
walk could not tell which setting owns the subtree. Every refusal names its
layer, file and key.

## Settling

`settle` returns one `ConfigReport`: each setting's value, the value before
its limits (`unlimited`), where it came from (`origins`: one for a pick,
every contributor for a join, none for the fallback) and what narrowed it
(`limits`); every layer file's state; and every refusal, each once. The
values and the refusals come together, so no caller takes one without the
other.

## Checks

`tableProblems(table)` checks every declared setting with values from a
fixed pool of JSON: a value in a layer the setting does not admit is refused
and changes nothing; a pick takes the most specific layer in its order; a
limit is below both the unlimited value and the limit's own; no host-code
setting admits a project or local layer; and an unknown key's refusal names
its file and key. A setting needs two pool values its kind decodes, or the
check says so. A setting added later is checked with no test of its own.

`types.test.ts` holds what does not compile: a limit on a kind with no
`meet`, a join on one with no `join`, host code naming a project layer, and
one layer's values handed in as another's.
