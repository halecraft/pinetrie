# S230 — Asked after each run for a thread's topic, or `same`, does a model keep a topic while the work goes on and change it only when the thread moves on?

- **Status:** Open

## Brief

**Question.** A column's header names its agent (`amber-fox`) and where
it forked, never what the thread is about. The plan would add a thread
topic: at each run's end, the request that already asks for the run-end
report (`planRunEnded`, `packages/rules/run-end-report.ts`) also asks for
the topic, given the topic shown now and the thread's asks with their
digests' headlines, newest last. The model answers `same` to keep it. A
person's edit wins. The canvas's title stays as it is (ADR-0074).

A topic that changes under the reader is what ADR-0074 rejected for
titles, so the topic has to hold. With the candidate skill
(`S230-a-thread-topic-that-holds/topic-skill.md`), asked after each of a
real thread's asks in order:

1. How often is the reply out of shape (more than one line, more than 8
   words)?
2. Of the changes after the first topic, how many does Duane read as the
   thread really moving on, and how many as noise (a rewording, a
   follow-up named as new work)?
3. Where Duane sees the thread move on, did the topic follow, and how
   many asks late?
4. Is the first topic, from the first ask alone, worth showing, or should
   the header keep the first ask's first line until a later run?

**Kill criterion.** If more than a quarter of the changes are noise, or
more than a quarter of real moves are missed, the topic is not asked
after every run: the plan falls back to a topic written once, as a
title is, with "Auto-update" by hand.

**Throw away.** The store copy, `/tmp/s229`, and the probe's copy in
`apps/pinetrie/host/`.

## How to run it

The probe is S229's (`docs/findings/S229-a-headline-for-every-long-ask/probe.ts`),
in its `topic` mode, on the same copy of the store:

```sh
cp docs/findings/S229-a-headline-for-every-long-ask/probe.ts apps/pinetrie/host/summaries-probe.ts
node apps/pinetrie/host/summaries-probe.ts topic /tmp/probe.db 12
rm apps/pinetrie/host/summaries-probe.ts
```

It asks the model and credentials the host uses (S229, How to run it).
It takes the 12 newest threads with two asks or more in their own
entries, and asks after each ask in order: the topic so far, then the
thread's first ask and its 29 newest, each with its stored digest's
headline when there is one. Today most asks have no stored headline
(S229), so this is the topic with less to go on than the plan gives it;
a run after S229's skill lands would have more. It writes
`/tmp/s229/topic-report.md`, one timeline per thread with each change in
bold and a line for Duane's read, and `/tmp/s229/topic.jsonl`.

The probe was checked against a three-ask thread a suite's scripted host
wrote, with a stand-in for the model. It has not met a real model.

## Answers

Not run yet.
