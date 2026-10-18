# S231 — With a required `intent` on `bash`, `read`, `edit` and `write`, how often does a model leave it out, and do its intents tell a person what each call did?

- **Status:** Open

## Brief

**Question.** In story, a tool row would show the call's intent ("Run the
unit tests") in place of its command, with the command a click away. The
model writes the intent as it makes the call: each tool's schema gets a
required `intent` before its own parameters, and the host strips it
before pi's `execute`.

Read from pi 0.99.2's source, before any run:

- **A call without it fails, and the run goes on.** pi-agent-core's
  `prepareToolCall` checks arguments with pi-ai's `validateToolArguments`,
  which throws on a missing required field. The loop turns that into an
  error result the model reads, and the model can call again
  (`agent-loop.js`).
- **pi's tools ignore the extra field.** `bash`'s `execute` reads
  `{ command, timeout }`, `read`'s `{ path, offset, limit }`, `write`'s
  `{ path, content }`.
- **On a model with strict tools, it cannot be left out.** pi's tools ask
  for constrained sampling (`constrainedSampling: { type: "json_schema",
  strict: "prefer" }`), and pi-ai sends an Anthropic tool with
  `strict: true` when the model supports it (`convertTools`,
  `api/anthropic-messages.js`). So a miss costs a retry only on a model
  or provider without it.

That leaves what only a run can show:

1. Without strict sampling, how often is `intent` missing or empty, and
   does the model get it right on the retry?
2. With strict sampling, is anything refused?
3. Read in a row with no command, do the intents say what each call was
   for, in words a person who is not a programmer follows? How many are
   vague ("Run command") or wrong?

**Kill criterion.** If, without strict sampling, more than 1 call in 20
is refused for its intent, `intent` is optional with a fallback worded
from the command. If Duane reads more than a quarter of the intents as
vague or wrong, story keeps the command and shows the intent beside it.

**Throw away.** `/tmp/intent-work`, `/tmp/s231`, and the probe's copy in
`packages/pi/`.

## How to run it

The probe (`S231-a-required-tool-intent/probe.ts`) is a small agent loop
on the model your threads run on, with no key of its own. It loads pi's
setup as the host does (`loadPiSetup`, from your config and the folder's
`pinetrie.json`), with the credentials `pnpm sign-in` keeps, a
subscription's included, and each turn is pi's own `completeSimple`, so
tools go out as pi sends them: strict where the model supports it. The
tools are pi's own `bash`, `read`, `edit` and `write`: their
descriptions, their schemas with `intent` added first, and `execute`. It
checks arguments with pi's `validateToolArguments` and sends a failure
back as an error result, as pi's loop does. Its system prompt is a short
one of its own, not pi's. It runs each task in
`S231-a-required-tool-intent/tasks.md` in a scratch copy of pine·trie,
which the editing tasks change.

```sh
cp docs/findings/S231-a-required-tool-intent/probe.ts packages/pi/intent-probe.ts
git clone . /tmp/intent-work && (cd /tmp/intent-work && pnpm install --frozen-lockfile)
node packages/pi/intent-probe.ts /tmp/intent-work
(cd /tmp/intent-work && git checkout .)
PROBE_STRICT=0 PROBE_OUT=/tmp/s231-loose node packages/pi/intent-probe.ts /tmp/intent-work
rm packages/pi/intent-probe.ts
```

The first run sends the tools as pi does. `PROBE_STRICT=0` turns
constrained sampling off for every tool, so the model may leave `intent`
out, as on a provider without it. Each run writes `intent-report.md`, a
table per task of tool, intent, the command or path, and whether it ran,
with a line for Duane's read, and `intent.jsonl`.

The probe was checked with pi's scripted model in place of yours: a call
without `intent` was refused with pi's validation message, the next ran
pi's `bash`, and the report was written. It has not met a real model.

## Answers

Not run yet.
