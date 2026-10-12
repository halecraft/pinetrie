# S170 — Every call the supervisor watches can be cut short with EINTR, opens as much as releases; so not watching the release calls removes nothing, and the hazard belongs to seccomp's user notification itself

- **Status:** Answered
- **Led to:** ADR-0135

**Question.** Under a lane with shared directories, the supervisor also
watches `close`, `dup3`, `exit_group` and `execve`, to read the version a
write leaves when its descriptor is let go of (S161). Every watched call
waits for the supervisor's answer, and a signal that arrives during the
wait cuts the call short with EINTR, which these calls never return
unsupervised. `dash` (Debian's `/bin/sh`), whose SIGCHLD handler does not
restart calls, failed 13 times in 3,000 runs of a redirection right after
killing a background job; `bash` never did, nor `dash` with no shared
directory. Option B: stop watching those four, and take a write's version
from the host's watcher instead (S169: it sees every version, with the
stamp a lane reads). That rests on:
1. **Which watched calls leak EINTR.** If an open, rename, unlink or mkdir
   can be cut short too, dropping the four release calls narrows the
   hazard and does not remove it, and B is a mitigation as A is. Measured
   per call, with a handler that does not restart, children exiting
   throughout, the supervisor idle and flooded, with and without its
   release calls watched.
2. **Attribution without release.** With only the opens, a run's writes
   to a file are its writable opens, each with the stamp it found, and the
   file's stamp when the run ends. Do those, with the watcher's versions,
   name every version the run made, and no other writer's? Checked for:
   one write; several opens of one file; several writes through one
   descriptor; a save by rename (`sd`, an editor); a daemon that keeps a
   file open; and two lanes racing (S161's shape).

**Kill criterion.**
- If an open-like call leaks EINTR at a rate near the release calls',
  B removes nothing that matters; the hazard is the supervisor's, and the
  next question is whether any blocking design avoids it.
- If attribution without release cannot tell a run's own intermediate
  versions from another writer's, B trades this bug for false concurrency.

**Throw away.** Probes and output in `.plans/disk-model-probes/S170/`, and
into `docs/findings/S170-release-capture/` once answered.

## Answers

Run in a lane (`linux 6.18.55-0-virt`, arm64), 2026-10-12.
`docs/findings/S170-release-capture/eintr.c` installs a SIGALRM handler
without `SA_RESTART`, as `dash`'s SIGCHLD is, fires it every 50 µs, and
makes each watched call 20,000 times on files in its directory, counting
each that failed with EINTR (and retrying it).

1. **Every watched call leaks EINTR, opens as much as releases.**

   | run | open (write) | open (read) | dup3 | close | rename | unlink | mkdir | rmdir |
   |---|---|---|---|---|---|---|---|---|
   | unsupervised | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
   | supervised, no shared directory | 2,616 | 1,369 | — | — | 3,642 | 1,773 | 2,341 | 1,670 |
   | supervised, shared | 2,771 | 2,712 | 2,036 | 0 | 1,335 | 1,920 | 3,221 | 2,214 |
   | supervised, shared, flooded | 2,527 | 2,864 | 3,172 | 0 | 3,347 | 3,492 | 3,165 | 2,257 |
   | flag and receiving thread, shared, flooded | 1,790 | 1,570 | 1,560 | 0 | 1,282 | 1,557 | 1,854 | 1,613 |

   Each is of 20,000 calls (close: 60,000); "—" is a call not watched in
   that run. "Flooded" adds a busy loop of opens under the same
   supervisor; it changes little. The flag
   (`SECCOMP_FILTER_FLAG_WAIT_KILLABLE_RECV`) with a thread that only
   receives notices halves the rate.
2. **Why, from the kernel** (`kernel/seccomp.c`,
   `seccomp_do_user_notification`, read at `master` on 2026-10-12): a
   notified call waits with `wait_for_completion_interruptible` until the
   supervisor has received its notice. The flag only makes the wait
   killable once it has (`should_sleep_killable`: state at least
   `SECCOMP_NOTIFY_SENT`). A signal before that returns `-ERESTARTSYS`,
   which the kernel restarts for a handler with `SA_RESTART`, and turns
   into EINTR for one without. So no listener can close the window: a
   notice is always queued for some time before it is received.
3. **Attribution without release (question 2)** was not measured: it
   matters only if dropping the release calls removed the hazard, and it
   does not.

**Kill criterion met:** an open-like call leaks EINTR at the release
calls' rate. Option B removes nothing that matters, and the flag with a
receiving thread (option A) only narrows the window.

**Who it reaches.** A program sees it only when a signal it handles
without `SA_RESTART` arrives while a watched call waits: about 26 µs per
call (S158), longer when the supervisor is busy. `bash`, glibc's `signal`
(which sets `SA_RESTART`) and Python, which retries calls cut short (PEP
475), were not affected. `dash`, Debian's `/bin/sh`, was: 13 of 3,000 runs
of a redirection right after killing a background job, under a flood.

**What would avoid it, not measured here:**
- **A stop rather than a sleep:** `SECCOMP_RET_TRACE` with the supervisor
  as the call's `ptrace` tracer. A tracee stopped at a call's entry is not
  woken by a signal, which is held until it resumes. Its cost per stop,
  and that a debugger or `strace` in a lane can no longer attach to a
  supervised process, are to be measured.
- **Not blocking at all:** fanotify, the audit log or eBPF see without
  stopping the caller, but need a privilege a lane lacks (S158 rejected
  fanotify for that, and for its pid races).
