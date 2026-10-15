# S214 — A test counts a function's Map and Set iteration steps by wrapping their prototypes' iterators: linear code takes 2n and 8 per directory, the quadratic mutants n²

- **Status:** Answered
- **Led to:** ADR-0152

**Question.** Two unit tests prove that a fold is linear by timing it
against a wall-clock limit: `unattributed` (`packages/rules/disk.ts`) and
the send stream's fold (`packages/lanehost/send-stream.ts`). Each has a
mutation that scans a whole collection once per item, and each collection
it scans is internal to the function, so no input can be instrumented.

1. Does wrapping `Map.prototype` and `Set.prototype`'s `keys`, `values`,
   `entries`, `[Symbol.iterator]` and `forEach` count every step of the
   iterations the code and its mutants make: spread, `for … of`,
   `new Set(iterable)`, `Array.from`, `forEach`? V8's fast paths for a
   spread of a Set or a Map could skip a patched iterator.
2. Do the real functions take a number of steps linear in their input, and
   their mutants a quadratic one, far enough apart to bound at a small
   input?

**Kill criterion.** A form of iteration the mutants use goes uncounted, or
the real code's count is not linear.

**Throw away.** The probe, in this spike's folder of sources:
`count.ts` (the counter), `steps.ts` (the real `unattributed` and two hand
mutants, shaped as the mutation lists' are), `stream.ts` and
`stream-of.ts` (the real fold over `send-stream.test.ts`'s generated
stream). Run with `node` on Node 24.21 from that folder.

## Answers

1. **Every form is counted.** A spread of a Set or a Map's `keys()`,
   `for … of`, `new Set(set)`, `Array.from(map)` and `forEach` each took
   exactly n steps over n entries. Replacing a prototype's iterator turns
   V8's fast path off, so a spread goes through the wrapper.
2. **Linear and quadratic, three orders apart at n = 1,000:**

   | | n = 1,000 | n = 2,000 |
   |---|---|---|
   | `unattributed`, real | 2,000 | 4,000 |
   | `unattributed`, mutant (`[...written].some(…)` per path), applied to a copy of `disk.ts` | 1,003,000 | 4,006,000 |
   | a hand mutant scanning a Set per item | 1,001,000 | 4,002,000 |

   | the send stream's fold, by directories (each a mkdir, two files and three renames) | 500 | 1,000 |
   |---|---|---|
   | real | 4,000 | 8,000 |
   | mutant (`[...changes.keys()].filter(…)` per rename), applied to a copy of `send-stream.ts` | 1,129,750 | 4,509,500 |

So a bound of a few steps per item, at a thousand items, separates the
real code from either mutant by a factor of hundreds, and the test runs in
milliseconds where the timed ones built 50,000 and 15,000 items.

**Constraints the counter carries:**
- It patches globals: the function counted must be synchronous, so no
  other work runs while the prototypes are wrapped, and the counter
  restores them in a `finally`.
- It counts iteration, not `get`, `has`, `set` or `delete`: a quadratic
  regression made of lookups alone (a nested loop over an array) is not
  seen. Both folds' mutants, and the failure S179 found, scan a
  collection.
