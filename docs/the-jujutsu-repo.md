# The jujutsu repo: what Pineta writes there, and how jj and jjui see it

The host serves one jj repo: the project's working copy on the machine the
host runs on. This page is for someone who works in that repo with jj or
jjui beside Pineta. It says what Pineta puts there, what it expects, and
what to configure. Why each piece is shaped as it is: ADR-0038 (offers),
ADR-0039 (thread names), ADR-0060 (the integration line and the ledger),
ADR-0076 (publishing).

Two parties act on the repo. **The host** runs its jj commands as the
operation user `pineta-host@<hostname>`. **The owner** is whoever runs the
host, and works in the repo with jj directly. People in a session never
touch the repo: their threads' agents work in lanes of their own, and their
work reaches the repo as offers.

The page names these things by what they are for, not by their jj names
(ADR-0061): the line is **the project**, integrating an offer is **add to
the project**,
bringing a thread up to date is **catch up**, and landing your work is
**add my work to the project**. The jj names are in the page's titles.

## Bookmarks

| bookmark | whose | what it is |
|---|---|---|
| `pineta-onto` | the owner's, moved by the host on an offer integration | **The integration line**: where finished work lands. It only moves forward. Immutable once set up. |
| `pineta-offer/<name>` | the host's | **An offer**: a thread's work as one revision, or a stack, on the thread's base. Immutable while it sits on the line. `<name>` is the thread's two-word name. |
| `main` | the owner's, moved by the host on a publish | **Where the project is published**: moved forward to `pineta-onto`, never anywhere else. |
| `wip/*` | the owner's | **A work in progress** a thread may start from, chosen at its first message. Never touched by the host, except an offer integration into it. |
| `tip@pineta-<lane>` | the host's | **A lane's history**, fetched from the lane. A remote bookmark, untracked, so jj treats it as immutable and leaves it out of the default log. Archiving a thread deletes its lane's, and abandons its offer; restoring brings both back. |

The names `pineta-onto`, `main` and `wip/` are the defaults. A project sets its own
in `pineta.json`, or a person in `$XDG_CONFIG_HOME/pineta/config.json`; the
project's wins:

```json
{ "offers": { "onto": "trunk", "wipPrefix": "wip/", "publish": "master" } }
```

**An offer integration** moves one bookmark forward to an offer:
`pineta-onto`, or the thread's `wip/` bookmark. It never rebases, and never
touches `@`. jj itself refuses a move that is not forward, so a stale
integration fails instead of dropping commits. Only an offer with no
conflicts can be integrated into the line. The commit it leaves there is an
**integrated-offer commit** (ADR-0083).

**Publish** ("publish to main", in the page's project menu) moves `main`
forward to `pineta-onto`, as `pineta-host`: `jj bookmark move main --to
pineta-onto`. It changes no file, so anyone in the session may, on a host
that admits others too. It does not push. jj refuses a move that is not
forward, so once `main` has commits the line lacks (someone pushed to it
outside Pineta), publishing is refused until they are brought into the
line. The host watches `main` as it watches the line, so moving it in jj
updates the menu's count of unpublished commits.

**Update my files**, in the page's project menu, is the one act of
Pineta's that moves the owner's `@` (ADR-0061, S80): `jj rebase -b @ -d
pineta-onto`, run as the owner. It moves the owner's work above the line
and every head on it, other heads besides `@` included. Before it is
offered, the menu shows a preview made with `git merge-tree`, which writes
nothing jj or jjui shows: the files that change, those that would
conflict, and the other heads that move. A conflict does not stop it: jj
marks the lowest conflicted commit and those above it, and the markers are
in `@`'s files. "Resolve with the agent" then opens a thread working in
the owner's files with the `resolve-conflicts` skill, which resolves at
the lowest conflicted commit (`jj new`, resolve, `jj squash`).

**Land my work** ("add my work to the project", in the page's project
menu) moves `pineta-onto` forward to the owner's `@-`. It runs as the owner, not as `pineta-host`, since it
moves the line to the owner's commits: the operation log shows it as the
owner's act. Moving the line by hand is the same
act: `jj bookmark move pineta-onto --to @-`.

## Config the host writes

"Set up the project", in the page's project menu, writes two settings to the
repo's own config (`jj config set --repo`), shown in full before anything
is written, and only when chosen:

```toml
[revset-aliases]
"immutable_heads()" = 'builtin_immutable_heads() | present("pineta-onto") | (bookmarks(glob:"pineta-offer/*") & children(present("pineta-onto")))'

[revsets]
log = 'builtin_log() | bookmarks(glob:"pineta-offer/*")'
```

Each is added to the repo's current definition, not put in its place: a
repo that defines its own `immutable_heads()` or `revsets.log` keeps it,
with Pineta's terms joined on.

- **`present()` is required.** Without it, a repo with no `pineta-onto`
  fails every jj command (S77 item 3).
- **The log setting is needed because the offers are immutable.** jj's
  default log, `builtin_log()`, shows mutable commits and their near
  ancestors. An offer on the line is an immutable commit with nothing
  mutable above it, so the default log leaves it out (S77 item 8).

## jjui

jjui's own `[revisions] revset`, in `~/.config/jjui/config.toml`, replaces
`revsets.log` for jjui, so the setting above does not reach it. A revset
built like jj's default hides every offer on the line. Add the offers to it:

```toml
[revisions]
  revset = '(present(@) | ancestors(immutable_heads().., 2) | ancestors(@, 5) | present(trunk())) | bookmarks(glob:"pineta-offer/*")'
```

The line and the offers on it show as immutable (◆). The owner's commits
above the line stay mutable.

## Trailers

Pineta keeps what it needs as trailers on the commits it makes. It reads
them from every paragraph of a message, since a squash keeps both messages
and jj's `trailers` template reads only the last.

| trailer | on | says |
|---|---|---|
| `Pineta-Base: <bookmark>@<commit>` | a lane's start, and each update | the thread's base: the line, or a `wip/` bookmark, at that commit |
| `Pineta-Source: <commit>` | every revision of an offer | the lane tip the offer holds; on the line, that work has been integrated |
| `Pineta-Start: <commit>` | every revision of an offer | where the offer starts |
| `Pineta-Thread`, `Pineta-Lane`, `Pineta-Entry` | every revision of an offer | the thread, its lane, and the newest entry its work came from |

A trailer is a statement Pineta acts on. Removing one changes what it
believes:

- **A squash that keeps one message** (`jj squash -u`, or a message written
  by hand) drops the other commit's `Pineta-Source`. Pineta then reads that
  work as not integrated, and offers it again.
- **An offer's message rewritten without `Pineta-Thread`** still has its
  top found by its bookmark, but a stack's lower revisions are no longer
  recognised as the offer's, so the offer reads as edited.

## Rewriting under Pineta

- **The line is immutable on purpose.** Rewriting it takes
  `--ignore-immutable`, which is the point: integrated work is final unless it
  is rewritten deliberately.
- **Rewording or rewriting a commit under an offer is safe.** jj rebases
  the offer as part of that operation. The host sees a version it did not
  make that changes nothing, and does not count it as an edit.
- **Editing an offer makes it the owner's.** Once a version an operation
  not the host's made changes an offer (its message, or its files), the
  host never touches that offer again. The evolog says who made each
  version, so this holds across a host restart.
- **Abandoning an offer, or deleting its bookmark,** discards it: the host
  builds a new one when the thread has work not integrated. To be rid of a
  thread's offer, archive the thread: the host abandons the offer, and
  builds it again if the thread is restored.
- **A `wip/` bookmark** is the owner's to rebase, amend or move. A thread
  started from it is brought up to date with a fresh copy of it. Once the
  WIP's commits are on the line, its threads move to the line; if the
  bookmark is deleted without landing, their updates stop until "continue
  from the project".
