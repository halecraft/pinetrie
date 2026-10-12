# S171 — A tracer supervisor ends the EINTR at about a listener's cost, but takes `strace` and `gdb` from every lane; and a listener cannot nest, so today's supervisor fails under itself

- **Status:** Answered
- **Led to:** ADR-0135

**Question.** S170 found that any call the supervisor watches can return
EINTR to a program whose signal handler does not restart calls: seccomp's
user notification waits interruptibly until the supervisor receives the
call. A tracer avoids that wait: with `SECCOMP_RET_TRACE`, a watched call
stops its process at the call's entry, and a stopped process is not woken
by a signal, which waits until it resumes. That rests on:
1. **No EINTR.** Run S170's probe (`eintr.c`) and S170's `dash` stress
   under a tracer that stops on the same calls: is every count zero?
2. **Cost.** A stop is a context switch to the tracer and back, a
   `waitpid` and a register read. What does one cost against a user
   notification's (about 26 µs in S158), measured here for both, per call
   and on an everyday command?
3. **What breaks.**
   - A process has one tracer. `strace`, `gdb` and anything else that
     traces a process in a lane: can it start one, or attach to one? And
     a process it traces inherits the filter: does its call then stop for
     the wrong tracer, or fail?
   - Chromium's headless shell, which the default image carries for
     Playwright, and which sandboxes itself with seccomp and namespaces.
   - Job control and signals passing through the tracer, daemons that
     outlive the command, threads, `env -i` and static binaries.

**Kill criterion.**
- If a traced call can still return EINTR, a tracer is no better.
- If a stop costs much more than a notification (say three times), or a
  lane's ordinary tools (a debugger, `strace`, the browser) break under it
  with no way around, the tracer trades one hazard for a worse one.

**Throw away.** Probes and output in `.plans/disk-model-probes/S171/`,
and into `docs/findings/S171-tracer-supervisor/` once answered.

## Answers

Run in a lane (`linux 6.18.55-0-virt`, arm64), 2026-10-12.
`docs/findings/S171-tracer-supervisor/tracer.c` is a tracer supervisor:
it installs a filter returning `SECCOMP_RET_TRACE` for the calls
`supervise.c` watches, seizes the command, follows its forks, clones and
execs, and at each stop does the work `supervise.c` does for a call (reads
the path, resolves it, `lstat`s it). It sends no records. `bench.c` times
an open and close. S170's `eintr.c` is the EINTR probe.

1. **No EINTR.** Under the tracer, `eintr.c` made 200,000 watched calls
   with a signal every 50 µs through a handler without `SA_RESTART`: none
   returned EINTR, where the listener let 5 to 18% of each call through
   (S170). S170's `dash` stress (a redirection right after killing a
   background job, 8 at a time) failed 0 times in 3,000, against 13 under
   the listener.
2. **Cost: about a listener's.**

   | command | bare | listener (`--shared`) | tracer |
   |---|---|---|---|
   | `bench.c`, per open and close | 0.7–1.0 µs | 59–60 µs | 51 µs |
   | `vitest run` of `packages/rules` and `packages/interface` | 3.8–4.0 s | 5.7–5.9 s | 5.5–5.7 s |
   | `vitest run` of one file | 0.57 s | 0.72 s (no `--shared`) | 0.84 s |
   | `node -e "require('typescript')"` | 93 ms | 93 ms | 96 ms |

   The tracer's figures leave out sending a record per call, which the
   listener's include, so a full tracer would be a little slower than
   these: parity, not a gain. Threads and vitest's worker processes ran
   under it unchanged (131,220 stops in one run).
3. **What breaks.**
   - **`strace` and `gdb` cannot run under the tracer.** A process has one
     tracer: `strace -f` fails at `PTRACE_TRACEME`, `strace -p` at
     `PTRACE_ATTACH`, and `gdb` cannot start its program ("ptrace:
     Operation not permitted"). Under the listener, `strace -f` and `gdb`
     work (`strace -p` of a sibling is refused there too, by the
     container). A tracer under a tracer is refused the same way. No way
     around was found: a tracer that let a subtree go would leave its
     watched calls failing, as below.
   - **A process left with no tracer fails every watched call with
     ENOSYS** ("Function not implemented", even opening `/dev/null`), so
     the tracer must outlive every daemon. The listener has the same
     constraint, and `supervise.c` already meets it.
   - **Chromium's headless shell** renders a page under the tracer, the
     listener and neither alike, with `--no-sandbox` as root. Its own
     sandbox refuses root under all three.
4. **A listener cannot nest (found here, about today's build).** The
   kernel refuses a filter with a listener when any filter already on the
   process has one (`kernel/seccomp.c`, `has_duplicate_listener`:
   EBUSY), so `supervise` under `supervise` exits 126 ("the seccomp
   listener was refused: Resource busy"). Run under a supervisor, as a
   lane's tool call is, `packages/lanes/supervise.test.ts` failed 8 of its
   tests both times. And a lane's inner Docker started from a tool call
   (as `apps/pinetrie/e2e/TECHNICAL.md` says to do by hand) would carry
   the listener's filter, which cannot be removed, to every inner lane it
   starts, whose supervisor would then be refused. Inferred from the
   refusal above, not run. The inner Docker the container's own command
   starts is outside supervision, and is not affected.

**Kill criterion met** on what breaks: a lane's debugger and `strace`
stop working with no way around, where today they work. The tracer ends
the EINTR at no cost, so the choice is between two hazards: a rare EINTR
for programs whose handlers do not restart calls, or no tracing tools in
any lane.
