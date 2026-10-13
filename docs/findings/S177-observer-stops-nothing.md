# S177 — Under the eBPF observer, a run sees no EINTR, `dash`'s loop of S170 never fails, and `strace` traces a run's command

- **Status:** Answered
- **Led to:** ADR-0135

**Question.** The observer replaced the supervisor because a stopped call
could be cut short with EINTR (S170) and because a second listener or a
tracer could not attach (S171). The plan's success criteria ask that
S170's probe show no EINTR under a run and that `strace` run in a tool
call. Neither can be a suite check: no deliberate bug in pine·trie's code
makes the observer stop a call. Do they hold, measured once?

**Kill criterion.** Any EINTR, any failed redirection in `dash`'s loop, or
`strace` failing or taking a run's write from it, under a run.

**Throw away.** The guest's extra cases and its extra programs. Kept in
`docs/findings/S177-observer-stops-nothing/`: `eintr.c` (S170's probe,
unchanged) and `probe.sh` (the cases, as pasted into the guest's `init`).

## Answers

Measured 2026-10-13 in the observer suite's QEMU guest on the lane VM's
Linux 6.18.56 kernel, with the product loader and BPF program, lane `a`
registered in a PID namespace of its own. For the run, the suite stage
also ran `apk add dash strace`, copied `dash`, `strace` and the libraries
`ldd` names into the guest, and built `eintr.c` statically.

1. **`dash`'s loop, 3,000 redirections each right after killing a
   background job:** 0 failures as run 30 and 0 outside any run. Run 30
   reported 6,078 events, among them all 3,000 opens of its file: the
   loop was observed throughout.
2. **S170's probe, a SIGALRM every 50 µs through a handler without
   `SA_RESTART`, 5,000 rounds:** 0 EINTR on every call it makes (open for
   writing and reading, `dup3`, `close`, `rename`, `unlink`, `mkdir`,
   `rmdir`; 45,000 calls), as run 31 and outside any run. Run 31 reported
   35,002 events. Under the supervisor the same probe saw thousands per
   call (S170).
3. **`strace -f` of `sh -c 'echo t > /w/p/traced.txt'` as run 32:** exits
   0, its trace holds the traced command's `openat`, and the open and
   release of `traced.txt`, the run's exit and its end all reached run 32.

The kill criterion does not fire. QEMU emulates, so the guest's timings
mean nothing: these are counts. On the Mac's lane VM and in `e2e:lanes`
they are still to be seen in a lane's own tool calls.
