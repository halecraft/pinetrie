# Glossary

One word per concept, in the page, the agent's orientation, the docs, the
code, what is stored and what is sent (ADR-0100). When you write about
pine·trie's work in your repo, use these words. ADRs and findings keep the
words they were written with.

## Your repo

| word | what it is | in code | retired |
|---|---|---|---|
| **accepted work** | The commits finished work lands on, under the bookmark `pinetrie-accepted` (config `accepted.bookmark`). It only moves forward. | `accepted`, `AcceptedRecord`, `AcceptedFacts`, `acceptedBookmark` | the line, the integration line, the project, `onto`, `pinetrie-onto` |
| **accept** | Move an offer into accepted work, or into a WIP: its bookmark moves forward to the offer. | `accept`, `planOfferAcceptance`, `acceptedAs` | integrate, take (of an offer), land, add to the project |
| **accepted-offer commit** | The commit an accepted offer leaves, carrying `Pinetrie-Source`. | `AcceptedOfferCommit`, `acceptedOfferCommits` | integrated-offer commit |
| **offer** | A thread's work, as one revision or a stack, waiting to be accepted, under `pinetrie-offer/<thread name>`. | `offer`, `OfferRecord` | |
| **WIP** | A bookmark (prefix `wip/`, config `wip.prefix`) a thread may start from and be accepted into. | `wip`, `wipPrefix` | |
| **publish** | Move `main` (config `publish.bookmark`) forward to accepted work; with `publish.catchUp` on, catch your files up and accept your commits below `@` first (ADR-0099). | `publish`, `publishCatchesUp` | |
| **set up** | Create accepted work's bookmark at your `@-` and write its `immutable_heads()` and `revsets.log` to your repo's config. | `setup`, `planSetup`, `setupProposal` | |

## A thread's work

| word | what it is | in code | retired |
|---|---|---|---|
| **base** | Where a thread started: accepted work, or a copy of a WIP. Its first commit's `Pinetrie-Base` trailer says which (`accepted@<commit>`, or `<wip>@<commit>`). | `base`, `LaneBase`, `BaseTrailer` | the line (as a base) |
| **catch up** | Bring your files, or a thread's copy, up to date with what it is based on. Its commit is titled `catch up: accepted work`, `catch up: <thread>`, or `copy of <wip>`. | `catchUp`, `CatchUpFrom`, `catchUpName` | update, follow, bring up to date |
| **lane** | A thread's own copy of your repo, in a container of its own (ADR-0034). | `lane`, `LaneName` | |

## Words that look alike and are not these

- **line**: a line of text (`firstLine`, a column's one-line fact), the
  cards' line in a column (above it queued, below it drafting, ADR-0048),
  and Kyneta's command **Line** (`host/control.ts`), one per seat. None of
  them is accepted work.
- **take**: take a card into your inventory (ADR-0083). Nothing is done to
  an offer by taking it.
- **accept** in plain English: the host accepts a command or a write
  (`acceptsWrite`, a move `accepted`). Only an offer is *accepted* into
  accepted work.

## Where these are configured

`pinetrie.json` in the project, or `$XDG_CONFIG_HOME/pinetrie/config.json`;
the project's value wins (`docs/the-jujutsu-repo.md`):

```json
{ "accepted": { "bookmark": "pinetrie-accepted" },
  "wip": { "prefix": "wip/" },
  "publish": { "bookmark": "main", "catchUp": false } }
```
