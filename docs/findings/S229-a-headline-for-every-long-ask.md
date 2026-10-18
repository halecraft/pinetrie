# S229 — Asked for a headline always and points only when they add, does a model give every long ask a headline, and leave the points out when the last word says it all?

- **Status:** Open

## Brief

**Question.** Today the digest skill (`packages/pi/skills/ask-digest/SKILL.md`)
asks for `nothing to add` whenever the agent's last message already says
what the work came to, or the work was routine. A digest is then stored
with no headline (`digestOf`, `packages/rules/digest.ts`), so most long
asks show none, in any density, and nothing a later feature reads (a
thread's topic, S230) has a headline to read.

The candidate skill (`S229-a-headline-for-every-long-ask/digest-skill.md`)
drops the sentinel. It asks for a headline every time, and for points
only when the work in between adds to the last word. If a model follows
it, whether the points are empty can stand for "adds to the last word",
and the record needs no flag of its own. Then:

1. How often is the reply out of shape (no headline, the old sentinel,
   too long, not a list)? The parser is the candidate `readDigest` in the
   probe, the same limits as `digestOf`: a headline of at most 14 words,
   at most 4 points of at most 40 words each.
2. Is the headline worth showing: does it tell a reader skimming a column
   what the ask came to, or does it only restate the last word?
3. Are the points left out when the last word covers the work, and kept
   when it does not?

**Kill criterion.** If more than 1 in 20 replies is out of shape, or
Duane reads more than a quarter of the headlines as noise, the headline
is not asked for every ask, and the plan keeps the sentinel for the
digest and finds the topic's input elsewhere. If the points come and go
regardless of the last word, the record keeps an explicit flag.

**Throw away.** The store copy, `/tmp/s229`, and the probe's copy in
`apps/pinetrie/host/`.

## How to run it

On the Mac, with the host stopped, copy the session's `pinetrie.db` (in
its data directory) to `/tmp/probe.db`, then from the repo root:

```sh
cp docs/findings/S229-a-headline-for-every-long-ask/probe.ts apps/pinetrie/host/summaries-probe.ts
node apps/pinetrie/host/summaries-probe.ts digest /tmp/probe.db 40
rm apps/pinetrie/host/summaries-probe.ts
```

It needs no key of its own. It loads pi's setup as the host does
(`loadPiSetup`, from your config and the folder's `pinetrie.json`), so it
asks the model that writes digests now, the run's (the describe model is
the run's model, `packages/pi/config.ts`), with the credentials
`pnpm sign-in` keeps, a subscription's included, through the host's own
`complete`. The probe
reads the newest 40 ended long asks (`isLongAsk`) with the host's own
readers and builds each request with `askLines` and `digestRequest`, so
only the skill differs from the host's request. It writes
`/tmp/s229/digest-report.md`, where each ask shows its message, its last
word, the digest stored now and the candidate reply, with a line for
Duane's read, and `/tmp/s229/digest.jsonl`. It writes nothing to the
store.

The probe's reading and reporting were checked against a store a suite's
scripted host wrote, with a stand-in for the model; its model setup
type-checks, and in a lane with no credentials it stops with "no model".
It has not met a real model.

## Answers

Not run yet.
