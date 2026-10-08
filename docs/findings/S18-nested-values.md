# S18 — can pi's values be stored nested, `values[namespace][key]`?

- **Status:** Answered
- **Led to:** ADR-0016, ADR-0017, ADR-0095

**Answer: no.** A child container created lazily under a record key LOSES one
writer's contents when two replicas create it concurrently. Probe:
`sandbox/s18-nested-values/probe.ts`.

## Why it was asked

`values` is stored flat, keyed `namespace + "\0" + key`. Storing namespace and
key as structure instead would remove the encoding, make a namespace scan
O(namespace) instead of O(all values), and let a reader subscribe to one
namespace. The risk was that each namespace becomes a child container created
on first write, and step 3 makes concurrent first writes normal: two new lanes
both write `pi.branch.tip`.

## Result

Each trial: two fresh replicas each write a different key into the same
namespace, then exchange state both ways. 40 trials per row, so a
last-writer-wins tie cannot always favour the same side.

| scenario | kept both writers' values |
|---|---|
| sanity: one writer, then replicate (flat, nested) | pass, pass |
| flat `values["ns\0key"]` (control) | **40/40** |
| nested, namespace **created concurrently** | **0/40** |
| nested, namespace **already existed and synced** | **40/40** |
| negative control: same key twice | 0/40 (loss is detectable) |

The loss is specific to **creating** the child container concurrently. Once it
exists, per-key merging inside it is fine.

The first run of this probe had a vacuous negative control: it checked that a
key was *present*, which is true even after the other writer's value
overwrote it. It now compares values. Recorded because the same mistake was
made in step 3's headline check.

## The rule this establishes

**Never create a child container under a record key that two replicas could
create concurrently.** Same family as ADR-0009: a per-key register whose
violation is silent.

The current document is safe, for a reason that had not been written down:

| field | child container? | keyed by | safe because |
|---|---|---|---|
| `entries`, `usageRows`, `values`, `activeRuns` | no, leaves | — | no container to race |
| `pendingText` | `Schema.text()` | run id | globally unique key |
| `lists` | `Schema.list()` | pi's `operationId:responseEntryId` | globally unique key |

Both container-creating fields are also written by one replica, the host, whose
storage admission queue serialises writes. Either condition failing (a key two
replicas could share, or a second writing replica under multi-host S8) turns
this into silent data loss.

## Consequence for `values`

Keep the flat composite key. It is what gives one leaf register per address, so
there is no container to race. Make the key opaque: produced by one exported
function and never parsed, with readers using the `namespace` and `key`
properties each stored value already carries.
