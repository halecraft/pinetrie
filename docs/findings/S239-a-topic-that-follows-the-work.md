# S239 — Asked to name the phase a thread is in, with each long ask's headline, does the topic follow a thread's phases without changing on every follow-up?

- **Status:** Answered (Duane's read of the timelines to come)
- **Led to:** ADR-0173

## Brief

**Question.** S230 asked for the thread's topic after each run, or
`same`, and the topic held: 76 of 80 requests kept it. Too well, in
Duane's read: wakeful-bloom went from the header idea to the `verdict`
rename to these probes, and cool-hornet from slow accepting to prompt
caching, and each kept its first topic. Duane wants the header to show
"a high-level but accurate reflection" of the phases a thread goes
through.

The candidate skill (`S239-a-topic-that-follows-the-work/topic-skill.md`)
asks for the phase the thread is in now, and says when a phase ends
(a different problem, a different thing made or decided, or a step that
changes what the work is), even when it grew out of the last. And the
model now reads what the plan gives it: S230 saw almost no headlines,
since 39 of 40 stored digests were `nothing to add` (S229). The probe
gives each long ask without one a headline, asked with S229's digest
skill. On the same 12 threads:

1. Does the topic follow the phases Duane sees in wakeful-bloom and
   cool-hornet?
2. How many changes does Duane read as noise: a rewording, or a
   follow-up named as new work?
3. How often is the reply out of shape (more than one line, more than
   10 words)?

**Kill criterion.** If the topic still misses the phases Duane named, or
more than a quarter of its changes are noise, the topic is not asked
after every run, and the plan falls back to a topic written once, as a
title is, with "Auto-update" by hand.

**Throw away.** The store copy and the probe's copy beside the host.

## How to run it

One command on the Mac, from the repo root, with the host stopped:

```sh
sh sandbox/summary-probes.sh topic
```

It copies the store, puts `S239-a-topic-that-follows-the-work/probe.ts`
beside the host, and runs it with S229's digest skill and this spike's
topic skill, from `sandbox/summary-probes/src/` (the same files as here,
since the Mac's copy of the repo may not have this spike yet). The
report goes to `sandbox/summary-probes/s239/topic-report.md`.

## Answers

Run on Duane's Mac, 2026-10-18, on a copy of his session's store, with
`anthropic/claude-opus-5-5`, on S230's 12 threads. The report is
`S239-a-topic-that-follows-the-work/report.txt`.

1. **The topic follows the phases: 23 changes after the first topic in
   82 requests, against S230's 4 in 80.** wakeful-bloom reads "Making
   threads easier to pick back up" → "Plan to rename verdict to
   RunEndReport" → "Implementing the verdict to RunEndReport rename" →
   "Picking next work on thread context features" → "Building model
   probes for thread context features" → "Making thread topics follow
   each phase of work". cool-hornet's 23 asks show 11 topics, from "Why
   accepting changes got slow" through "Redesign lane metadata so history
   needn't load" and "Trim what bloats the session database" to "Decide
   fixes for the latest slowdown".
2. **Retries and follow-ups keep it.** orderly-koala's six "can you try
   ssh again?" asks are all `same`; it changed once, when Duane asked why
   the VM's disk grew rather than how to get in. safe-walnut's
   follow-ups ("Do you have a disk now?", "Any trade-offs?") keep "Server
   needs two Ctrl-C presses to shut down".
3. **Noise, in my read: about 3 of the 23,** each a step the skill names
   as a phase, worded too close to the last: plush-finch's "Preparing to
   build the end-of-run report" → "Building the end-of-run report",
   cool-hornet's "Find causes of the latest slowdown" → "Decide fixes for
   the latest slowdown", and "Rethink how the session store is organized"
   → "Measure session store growth and root loading". Under the kill
   criterion's quarter; Duane's read decides.
4. **The headlines carry it.** A bare first ask (spry-llama's `@agent`)
   now gets a topic from its headline, "Keep and restore changes in
   review rules", not "Getting started with the agent".
5. **Out of shape: 0 of 82.** No reply was over 10 words, and no request
   failed.

**So:** the topic is asked after every run with this skill, given each
ask's headline; it changes about once every three or four asks in a long
thread.
