# S304 — The lane's own `exec` keeps every byte of a call's output, per pipe, and gives pi the view its own `exec` gives; the kernel finds the pipes itself

- **Status:** Answered
- **Led to:** ADR-0204

Q1 and Q2 measured in a lane against pi 0.99.2; Q3 in a QEMU guest on the
lane VM's kernel (Linux 6.18.57) with S298's patched bash.

**Question.** ADR-0204 splits a call's output by the statement that wrote
it, from the bytes in the shell's stdout and stderr pipes. Today the lane
helper forwards a tool call's `exec` to pi's `NodeExecutionEnv`, which
mixes both pipes into one decoded, sanitised, tail-truncated text view,
and that view is all the host gets. pi's bash tool only needs `exec` to
honour pi's `Shell` contract (`ShellExecOptions`, `ShellOutputUpdate`,
`ShellExecResult`), and pine·trie already implements that contract for
lanes (`laneEnv`). In particular:

1. **Sameness.** An `exec` of the helper's own, which spawns the shell and
   reads both pipes as bytes, builds its view with pi's exported pieces
   (`truncateTail`, `sanitizeBinaryOutput`, `applyShellOutputUpdate`):
   does the view its updates leave, and its result's metadata (exit code,
   truncation, `lastLineBytes`, spill file), equal pi's `exec`'s for the
   same command? Over empty, short, long by bytes and by lines, one long
   line, binary bytes, invalid UTF-8, a character split across writes,
   stderr alone and both pipes, a non-zero exit, a signal, a timeout, an
   abort, and a background job that keeps the pipes open.
2. **Bytes.** Does its log of raw chunks, each with its pipe, hold every
   byte each pipe carried, in each pipe's order?
3. **The pipes, from the kernel.** Can the observer learn a run's output
   pipes itself, from its first task's descriptors 1 and 2 at that task's
   `exec`, and attribute both pipes, each in its own order, with no
   registration of an inode?

**Kill criterion.** A command whose model-facing view or result differs
between the two, beyond the order in which two pipes' chunks happen to
interleave, which pi's own `exec` does not fix either; or pipes the
observer cannot find from the task.

**Throw away.** The probe (`docs/findings/S304-an-exec-of-our-own/`),
unless a plan builds on it: the `exec`, the differential test, and the
guest. Q1 and Q2 run in the lane against pi 0.99.2; Q3 in a QEMU guest on
the lane VM's kernel, as S283 and S298 did.

## Answers

**Yes to all three.** The kill criterion was not met.

### How pi's `exec` builds its view

Read from pi 0.99.2's source (`harness/env/nodejs.js`,
`harness/utils/output-capture.js`, `harness/tools/bash.js`):

- **pi's bash tool asks `exec`** for tail retention at pi's default
  limits (`DEFAULT_MAX_BYTES`, 51,200; `DEFAULT_MAX_LINES`, 2,000), with
  `spill: true`. It reads the view from `onUpdate`, folding each update
  with `applyShellOutputUpdate`, and the truncation, spill path,
  `lastLineBytes` and exit code from the result, then words its own
  "Showing lines …" note.
- **`exec` feeds both pipes into one `OutputCapture`** in the order their
  chunks arrive, through one shared `TextDecoder`. The view is the
  decoded text, truncated by `truncateTail`, with `sanitizeShellOutput`
  removing control characters, and running totals of bytes and lines.
  Its updates are adaptive diffs, rate-limited; the final flush
  publishes only if something changed.
- **The spill** is every raw byte, from the first chunk, once the view is
  first truncated, in a file from `createTempFile({ prefix: "pi-output-",
  suffix: ".log" })`.
- **It finishes** at the shell's exit and both pipes' ends, or, once the
  shell has exited, after the pipes are quiet for 100 ms
  (`EXIT_STDIO_GRACE_MS`), so a background job holding the pipes does
  not hold the call.
- **`OutputCapture` is not exported**: the package's `exports` map has
  no path to it. `truncateTail`, `truncateHead`, `utf8ByteLength`,
  `sanitizeBinaryOutput` (the same function as `sanitizeShellOutput`),
  `applyShellOutputUpdate`, the default limits and `ExecutionError` are.

### Q1: sameness

`own-exec.ts`, 296 lines: it spawns the shell with its own pipes, builds
the view with pi's exported pieces, and ports what pi does not export
(the running totals, the buffer's guard, the spill, the wait for the
pipes). It publishes a `replace` per change, throttled, where pi
publishes diffs: pi's bash tool folds both into the same view.

`difftest.ts` ran 21 commands through both, as pi's bash tool calls
`exec`, and compared the view the updates leave, the result's metadata,
the spill file's bytes and any error's code:

| | |
|---|---|
| the same | 21 of 21, in each of three runs |
| cases | empty; short; no final newline; long by lines, by bytes; one 100 kB line; a partial last line; control bytes; invalid UTF-8; a character split across writes; CRLF; stderr alone; both pipes in turn and at once; 100 kB of binary across both; exit 3; killed by a signal; timeout; abort; a background job holding the pipes; 2 MB spilled |
| control | without `sanitizeBinaryOutput`, 3 of 21 differ (control bytes, CRLF, binary) |

The first run differed in one case: with no output, pi publishes no
update, and the probe published an empty view at the end. The model read
the same, but the card would have had one more update. The probe now
publishes at the end only when its view changed, as pi's final flush
does.

Two pipes written at once interleave as their chunks happen to be read,
in pi's `exec` and in ours alike; that case is compared by its lines as a
multiset.

### Q2: bytes

The probe's log, each chunk tagged with its pipe as it is read, held
exactly the 70,000 bytes given to stdout and the 30,000 given to stderr,
invalid UTF-8 and control bytes included, in order.

### Q3: the pipes, from the kernel

In `guest/attr.bpf.c`, at the registered shell's `exec`, the observer
reads its descriptors 1 and 2 (`task->files->fdt->fd`), keeps each whose
inode is a FIFO, and attributes writes by the pipe (`private_data`), in a
map of a run's output pipes, each with the descriptor it was. The
inode's mode is what says it is a pipe: `i_pipe` shares a union with
other fields, so its being set says nothing. One pipe on both
descriptors is kept once.

S298's 64 statements, run by the patched bash with stdout and stderr on
pipes of their own:

| pipe | bytes tagged | lines right | wrong |
|---|---|---|---|
| stdout | 211 of 211 | 54 | 0 |
| stderr | 458 of 458 | 8, and 8 of `time`'s report without a statement's token | 0 |

No buffer was found unaccounted or lost; all 64 signals were taken and
the 6 forgeries refused, as in S298. Nothing registered an inode.

### What the decision takes from this

- **The bytes are there to take**, before any capture decodes them. pi's
  maintainers cannot take a change to hand them over, and this probe's
  port of pi's capture stays pi's only by a test (`difftest.ts`). So
  ADR-0204 has pine·trie make the `bash` tool itself, in pi's shape:
  this probe's capture becomes pine·trie's own, the view ours to define,
  and nothing has to stay pi's.
- **The observer finds a run's output pipes where it finds the run**, at
  its first task's `exec` with `PINETRIE_RUN`: nothing new crosses from
  the helper or the host for it.

## Sources

`docs/findings/S304-an-exec-of-our-own/`:

- `own-exec.ts`: the `exec`, and its log of raw chunks.
- `difftest.ts`: the 21 cases through pi's `exec` and ours. Run from
  `packages/pi`.
- `guest/`: S298's guest, with the observer learning the pipes from the
  shell's descriptors (`attr.bpf.c`, `attr.h`), a driver with stdout and
  stderr on pipes of their own (`drive.c`), and the check per pipe
  (`guest.py`). Built and booted as S298's `run.sh` does.
