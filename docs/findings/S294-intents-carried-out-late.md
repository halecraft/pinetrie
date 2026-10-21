# S294 — which of pine·trie's requests must not be carried out late, and what each needs to be judged when it arrives

- **Status:** Open

For ADR-0202, under which a request made offline is an intent in a log,
taken when its authority next sees it: minutes or days after it was made.
The host judges each request against what holds when it arrives, and some
already carry what they assumed (a move's `from`).

**Question.**

1. For every kind of `Intent` (`packages/interface/intent.ts`) and every
   host command (`apps/pinetrie/host/commands/`): what does it assume
   about the state it was made in, and does the host check that
   assumption now (the gate, `packages/rules/gate.ts`, and each command's
   plan)?
2. Which become wrong, harmful or surprising when carried out late, and
   why: a send whose thread has moved on, a stop after the run ended, an
   accept of proposed changes that changed since, a publish, a move of a
   card someone moved since, a restore?
3. For each of those: is it refused, carried out with words saying it
   was late, or carried out as is? What would the intent need to carry
   (the version it saw, the tip, a time) for the authority to decide?
4. Is there a kind no intent should be for, because it only makes sense
   while connected?

**Kill criterion.** None: the answer is a table, read from the source.
If a kind cannot be judged late from anything an intent could carry, it
stays a request that needs the authority connected, and the ADR says so.

**Throw away.** Nothing is built. The table goes in this file.
