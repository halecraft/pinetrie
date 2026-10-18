# S230 — Asked after each run for a thread's topic, or `same`, does a model keep a topic while the work goes on and change it only when the thread moves on?

- **Status:** Answered (Duane's read of the timelines to come)
- **Led to:** ADR-0173

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
`/tmp/s229/topic-report.txt`, one timeline per thread with each change in
bold and a line for Duane's read, and `/tmp/s229/topic.jsonl`.

The probe was checked against a three-ask thread a suite's scripted host
wrote, with a stand-in for the model. It has not met a real model.

## Answers

Run on Duane's Mac, 2026-10-18, on a copy of his session's store, with
`anthropic/claude-opus-5-5`. The report is
`S230-a-thread-topic-that-holds/report.txt`. Almost no ask had a stored
headline (S229: 39 of 40 were `nothing to add`), so the model saw the
asks alone: less than the plan gives it.

1. **The topic holds: 80 requests over 12 threads, and 76 answered
   `same`.** A thread of 23 asks (cool-hornet) changed topic once.
2. **Out of shape: 1 in 80.** "Investigating why the HQL server disk is
   nearly full" is 9 words, over the skill's 8, and was refused; the next
   ask set the topic. A reader that refuses at 10 words, with the skill
   still asking for 8, gives the margin `digestOf` gives a headline (14
   against the skill's 12).
3. **Of the 4 changes after the first topic, 2 are the probe's own
   fault, and 2 are real.**
   - A failed request (wakeful-bloom's 11th ask) was taken by the probe
     as a topic, "(the request failed)", and the next ask set it back,
     reworded. The host keeps the stored topic on a failed request, as
     it keeps a digest, so neither change happens there.
   - spry-llama's first ask was a bare `@agent`, topic "Getting started
     with the agent"; its second, the real work, changed it. A thread's
     first ask is sometimes empty of meaning, so the header shows the
     first ask's first line until a topic exists, and a topic named from
     nothing can be replaced.
   - cool-hornet broadened "Why accepting changes in the repo got slow"
     to "Slow startup and slow accepting of changes" once startup was
     the subject too.
4. **The risk is the other way: moves missed, not noise.** wakeful-bloom
   went from the topic header to the `verdict` rename to these probes
   and kept "Show each conversation's topic in its column header";
   cool-hornet went on to prompt caching and stored diagnostics under
   its slowdown topic. Both are arguably one piece of work. Duane's read
   decides whether these are misses.
5. **The topics are plain**, as the skill asks: "Throwing away items from
   a full inventory", "Server needs two Ctrl-C presses to shut down".

**So:** asked after every run, with `same`, the topic does not change
under the reader. Duane's read of point 4 decides whether the skill
should lean less on `same`.
