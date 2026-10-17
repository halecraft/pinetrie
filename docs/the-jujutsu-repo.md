# The jujutsu repo: what pine·trie writes there, and how jj and jjui see it

The host serves one jj repo: the project's working copy on the machine the
host runs on. ADR-0118, accepted and not yet built, would make it serve several sources, each
branched repo with its own accepted work and proposed changes; ADR-0164,
proposed, would shelve that. This page is for someone who works in that repo with jj or
jjui beside pine·trie. It says what pine·trie puts there, what it expects, and
what to configure. Why each piece is shaped as it is: ADR-0105 and ADR-0156 (proposed changes),
ADR-0039 (thread names), ADR-0104 (accepted work and the ledger),
ADR-0154 (the host's version of proposed changes), ADR-0155 (tidying your op
log), ADR-0076 and ADR-0090 (publishing).

Two parties act on the repo. **The host** runs its jj commands as the
operation user `pinetrie-host@<hostname>`. **The owner** is whoever runs the
host, and works in the repo with jj directly. People in a session never
touch the repo: their threads' agents work in lanes of their own, and their
work reaches the repo as proposed changes.

pine·trie names these things by what they are for, one word each, in the
page, the code and here (ADR-0100, `docs/glossary.md`): **accepted work**,
**accept**, **proposed changes**, **WIP**, **catch up**, and **publish**. The jj names
are in the page's titles.

## Bookmarks

| bookmark | whose | what it is |
|---|---|---|
| `pinetrie-accepted` | the owner's, moved by the host on an acceptance, and by a publish of the owner's commits | **Accepted work**: where finished work lands. It only moves forward. Immutable once set up. Named `pinetrie-onto` before ADR-0100; a starting host renames it, once. |
| `pinetrie-proposed/<name>` | the host's | **Proposed changes**: a thread's work as one revision, or a stack, on the thread's base. Immutable while it sits on accepted work. `<name>` is the thread's two-word name. |
| `pinetrie-proposed/<name>@pinetrie-host` | the host's | **The host's version of proposed changes** (ADR-0154): a remote bookmark the proposed changes' bookmark tracks, moved by the host after each of its steps on the proposed changes. `pinetrie-host` is no git remote of yours: nothing fetches from it or pushes to it. While the two agree, `jj bookmark list` shows only the proposed changes; `--all-remotes` shows both. |
| `main` | the owner's, moved on a publish | **Where the project is published**: moved forward to `pinetrie-accepted`, with it, never anywhere else. |
| `wip/*` | the owner's | **A work in progress** a thread may start from, chosen at its first message. Never touched by the host, except an acceptance into it. |
| `tip@pinetrie-<lane>` | the host's | **A lane's history**, fetched from the lane. A remote bookmark, untracked, so jj treats it as immutable and leaves it out of the default log. Archiving a thread deletes its lane's, and abandons its proposed changes; restoring brings both back. Until then its history is parked under the git ref `refs/pinetrie/archived/<lane>`, which jj does not show, so a gc keeps it. |

The names `pinetrie-accepted`, `main` and `wip/` are the defaults. A project
sets its own in `pinetrie.json` (read from the working copy, since the names
find accepted work), or a person in `$XDG_CONFIG_HOME/pinetrie/pinetrie.json`;
the project's wins, and your file for the project beats both (ADR-0146).
`publish.catchUp` (default `false`) makes a publish catch the working copy up and
accept your commits first (ADR-0099):

```json
{ "accepted": { "bookmark": "trunk" },
  "wip": { "prefix": "wip/" },
  "publish": { "bookmark": "master", "catchUp": true } }
```

**The rename from `pinetrie-offer/*`** (ADR-0156, S217) is the first thing a
starting host does in your repo: each `pinetrie-offer/<name>` becomes
`pinetrie-proposed/<name>` (`jj bookmark rename`, as the host, one operation
each, which `jj op revert` undoes); the host's version of each moves with it
(one import, then one `jj bookmark forget` of the old names); and the
`bookmarks(glob:"pinetrie-offer/*")` setup wrote into your `immutable_heads()`
and `revsets.log` names `pinetrie-proposed/*` instead (`jj config set --repo`,
a file write, which the op log does not show). A name held under both is
left, and so is a `pinetrie-offer/<name>` you pushed to a remote of your own:
the startup line names each. A jjui revset of your own that names
`pinetrie-offer/*` needs the same edit by hand. (Accepted work's bookmark was
renamed from `pinetrie-onto` the same way, by ADR-0100.)

**An acceptance** moves one bookmark forward to proposed changes:
`pinetrie-accepted`, or the thread's `wip/` bookmark. It never rebases, and never
touches `@`. jj itself refuses a move that is not forward, so a stale
acceptance fails instead of dropping commits. Only proposed changes with no
conflicts can be accepted into accepted work. The commit it leaves there is an
**accepted thread commit** (ADR-0083).

**Publish**, the page's one button for accepted work (ADR-0090), shows only while
there is something to publish. With `publish.catchUp` on, it is up to three
steps, as one act:

1. When the owner's files are behind accepted work, `jj rebase -b @ -d
   pinetrie-accepted`, run as the owner: the owner's work above accepted work, and
   every head on it besides `@`, moves onto accepted work. Before it, the
   button's title says what this does, from a preview made with `git
   merge-tree`, which writes nothing jj or jjui shows: how many files
   change, and the other heads that move.
2. and 3. `jj bookmark move pinetrie-accepted main --to @-`, run as the owner,
   when the owner has commits below `@` accepted work lacks: they are
   accepted, and `main` moves with them, in one operation. Without such commits,
   `jj bookmark move main --to pinetrie-accepted`, as `pinetrie-host`.

With `publish.catchUp` off, the default, a publish is the last move alone,
as `pinetrie-host`, and changes no file. Either way anyone admitted may
publish, and the host does the same whoever presses it and wherever it
listens (ADR-0099). It does not push.

Publishing is refused before its first step when `main` has commits
accepted work lacks (someone pushed to it outside pine·trie), which must be brought
into accepted work first; and, with `publish.catchUp` on, when the owner's files
have conflicts or the preview says catching up would conflict. When the rebase leaves one of the
owner's commits conflicted (one that `@`'s own tree resolves, so the
preview could not see it), or the move fails, the host reverts the rebase's
operation with `jj op revert`, as the owner, and the repo is as it was. It
never uses `jj op restore`, which would delete from disk an edit made since
(S111). When the owner's files conflict, the page's toast offers "resolve
with the agent", which opens a thread working in the owner's files with the
`resolve-conflicts` skill, which resolves at the lowest conflicted commit
(`jj new`, resolve, `jj squash`).

The host watches `main` as it watches accepted work, so moving it in jj updates
what the publish button says. Moving accepted work or `main` by hand is the same
act as the host's: `jj bookmark move pinetrie-accepted main --to @-`.

## Files the host writes

None of pine·trie's own: the session's store, and its lanes' runtime,
ignore file and ssh files, are in the session's data directory,
`$XDG_DATA_HOME/pinetrie/sessions/<name>/` (ADR-0150), never in your
project. Nor does it add a line of its own to `.git/info/exclude`: the
only lines it writes there are shared directories (`lanes.shared`) that
nothing already ignores, so no commit of yours takes in what lanes write
to them. A jj repo with no git directory beside it is refused at startup:
lanes' history reaches your repo through git.

## Config the host writes

"Set up", the page's button before accepted work exists, writes two settings to the
repo's own config (`jj config set --repo`), shown in full before anything
is written, and only when chosen:

```toml
[revset-aliases]
"immutable_heads()" = 'builtin_immutable_heads() | present("pinetrie-accepted") | (bookmarks(glob:"pinetrie-proposed/*") & children(present("pinetrie-accepted")))'

[revsets]
log = 'builtin_log() | bookmarks(glob:"pinetrie-proposed/*")'
```

Each is added to the repo's current definition, not put in its place: a
repo that defines its own `immutable_heads()` or `revsets.log` keeps it,
with pine·trie's terms joined on.

- **`present()` is required.** Without it, a repo with no `pinetrie-accepted`
  fails every jj command (S77 item 3).
- **The log setting is needed because the proposed changes are immutable.** jj's
  default log, `builtin_log()`, shows mutable commits and their near
  ancestors. Proposed changes on accepted work are an immutable commit with nothing
  mutable above it, so the default log leaves it out (S77 item 8).

## Your op log

Every jj command the host runs on your repo is an operation, and jj never
removes one: in a month a busy repo gathers tens of thousands, and its
`.jj/repo` grows past a gigabyte. Nothing the host reads depends on them
(ADR-0154), so they can be cut. `pnpm tidy` does it, when you run it
(ADR-0155):

```
pnpm tidy [folder] [--days N] [--dry-run]
```

- **It keeps the last `N` days, seven by default,** and cuts the rest:
  after it, `jj undo` and `jj op restore` reach back `N` days. It says how
  many operations it keeps and cuts, and how long it should take, before
  it starts; `--dry-run` stops there. A folder is read as `pnpm dev` reads
  one: pine·trie's own repo without one.
- **It runs only while no host serves the repo,** and holds the session's
  store while it runs, so a host cannot start beside it. A host's writes
  during the cut would undo it. So a cron or launchd entry works only
  while the host is stopped.
- **It refuses a repo with a second workspace,** which the cut would leave
  stale.
- **Run no jj in the repo while it runs.** A command of yours that writes
  during it loses nothing, but leaves the log holding the window twice, and
  the tidy says so; the next tidy finishes the cut.
- **Its steps:** `jj util snapshot`; `jj op abandon ..<the newest operation
  older than the window>`, which re-points your working copy; `jj debug
  reindex`, since jj's gc never clears the index; and `jj util gc` with jj's
  own expiry, which keeps anything newer than two weeks, so what was cut
  leaves the disk at a later tidy. On a Mac a first tidy of a month's log
  took minutes (S215 item 12).
- **A starting host says when one is due:** once your oldest operation is
  more than fourteen days old, it logs "your repo's op log goes back 26 days
  (63,162 operations); `pnpm tidy` would keep the last 7".

## jjui

jjui's own `[revisions] revset`, in `~/.config/jjui/config.toml`, replaces
`revsets.log` for jjui, so the setting above does not reach it. A revset
built like jj's default hides every proposed changes on accepted work. Add the proposed changes to it:

```toml
[revisions]
  revset = '(present(@) | ancestors(immutable_heads().., 2) | ancestors(@, 5) | present(trunk())) | bookmarks(glob:"pinetrie-proposed/*")'
```

Accepted work and the proposed changes on it show as immutable (◆). The owner's commits
above accepted work stay mutable.

## Trailers

pine·trie keeps what it needs as trailers on the commits it makes. It reads
them from every paragraph of a message, since a squash keeps both messages
and jj's `trailers` template reads only the last.

| trailer | on | says |
|---|---|---|
| `Pinetrie-Base: accepted@<commit>`, `Pinetrie-Base: <wip>@<commit>` | a lane's start (`base: accepted work`, `copy of <wip>`), and each catch-up (`catch up: accepted work`) | the thread's base: accepted work, or a `wip/` bookmark, at that commit. A name with the WIP prefix is that WIP; any other, `pinetrie-onto` in older commits included, is accepted work |
| `Pinetrie-Source: <commit>` | every revision of proposed changes | the lane tip the proposed changes hold; on accepted work, that work has been accepted |
| `Pinetrie-Start: <commit>` | every revision of proposed changes | where the proposed changes start |
| `Pinetrie-Thread`, `Pinetrie-Lane`, `Pinetrie-Entry` | every revision of proposed changes | the thread, its lane, and the newest entry its work came from |

A trailer is a statement pine·trie acts on. Removing one changes what it
believes:

- **A squash that keeps one message** (`jj squash -u`, or a message written
  by hand) drops the other commit's `Pinetrie-Source`. pine·trie then reads that
  work as not accepted, and offers it again.
- **Proposed changes' message rewritten without `Pinetrie-Thread`** still has its
  top found by its bookmark, but a stack's lower revisions are no longer
  recognised as the proposed changes', so the proposed changes read as edited.

## Rewriting under pine·trie

- **Accepted work is immutable on purpose.** Rewriting it takes
  `--ignore-immutable`, which is the point: accepted work is final unless it
  is rewritten deliberately.
- **Rewording or rewriting a commit under proposed changes are safe.** jj rebases
  the proposed changes as part of that operation. The host sees a version it did not
  make that changes nothing, and does not count it as an edit.
- **Editing proposed changes make it the owner's.** Once a version an operation
  not the host's made changes proposed changes (its message, or its files), the
  host never touches that proposed changes again. jj shows such proposed changes as
  `pinetrie-proposed/<name>*`, and `jj bookmark list --all-remotes` says how
  far it is from the host's version. The host's version is a ref in your
  repo, so this holds across a host restart, and after your op log is cut.
- **Abandoning proposed changes, or deleting its bookmark,** discards it: the host
  builds a new one when the thread has work not accepted. Until then jj
  lists the bookmark as `(deleted)`, beside the host's version, which the
  host forgets once there is nothing to offer. To be rid of a
  thread's proposed changes, archive the thread: the host abandons the proposed changes, and
  builds it again if the thread is restored.
- **A `wip/` bookmark** is the owner's to rebase, amend or move. A thread
  started from it catches up with a fresh copy of it. Once the WIP's
  commits are on accepted work, its threads move to accepted work; if the
  bookmark is deleted before then, their catch-ups stop until "continue on
  accepted work".
