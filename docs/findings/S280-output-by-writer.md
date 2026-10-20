# S280 — The kernel can say which step of a command wrote each byte of its output, background jobs' late output included

- **Status:** Answered
- **Led to:** ADR-0196

Measured in a QEMU guest on the lane VM's kernel (Linux 6.18.57,
`linux-virt`, the observer suite's), two emulated CPUs, from a lane.

## Brief

**Question.** A tool call's command is a series of top-level steps, fed to
one shell one at a time. Can an eBPF program, beside the observer's,
attribute every byte that reaches the call's output pipe to the step whose
process tree wrote it, in the pipe's byte order, without changing the
command, its output, or what any process sees? "Its step" is the step the
shell was running when the writing process's line was started: a process
takes its parent's step at birth and keeps it, so a background job's late
output belongs to the step that started it. In particular:

1. **Order.** When writers of different steps write large chunks at once,
   and the kernel interleaves them in the pipe, does the order of the
   attribution events match the order of the bytes?
2. **Routes.** Bytes reach a pipe by `write`/`writev`, io_uring, `splice`
   from a file or a pipe, `sendfile`, `vmsplice` and `tee`. Which does the
   attribution see, and what does it not?
3. **Identity.** A pid reused after a step's process exits must not carry
   that step's tag to an unrelated writer.
4. **Completeness.** When some bytes escape attribution, can the reader
   tell, so the split falls back to the undivided output?

**Kill criterion.** Bytes attributed to the wrong step, in any route the
attribution claims to see, or a gap the reader cannot detect. Either means
the split could show output under a command that did not write it, and the
approach is dropped.

**Throw away.** The probe (`docs/findings/archive/S280-output-by-writer/`), unless
a plan builds on it: its BPF program, its driver standing in for the shell
and the wrapper, and the guest's init. It runs in a QEMU guest on the lane
VM's kernel, as `pnpm run e2e:observer` does.

## Answers

**Yes, on this kernel, for every route listed: no byte went to the wrong
step in three runs, and both deliberate bugs were caught.** The kill
criterion was not met. The remaining limits are a list of kernel functions
to keep true per kernel version, and an unknown route into a pipe being
attributed to whoever unlocks the pipe next (below).

### How it attributes

`attr.bpf.c`. Every event is sent while the pipe's mutex is held, so the
ring's order is the order bytes entered the pipe (Q1):

- **Write** (`write`, `writev`, io_uring's write, in its submitter or an
  io-wq worker): 6.18 names it `anon_pipe_write` (static, kprobe-able).
  It takes `pipe->mutex` and copies each page with `copy_page_from_iter`,
  dropping the mutex only to wait for room (`fs/pipe.c`). A kprobe on
  `anon_pipe_write` notes the task's `iov_iter`; a kprobe on
  `copy_page_from_iter` with that iter sends the copy's length. Entry
  probes only, so no kretprobe instance limit applies to a writer that
  sleeps.
- **Every other route** (`splice` from a file or a pipe, `sendfile`,
  `vmsplice`, `tee`) adds whole buffers under `pipe_lock` and drops it
  through `pipe_unlock` or `pipe_wait_writable`, real calls from
  `fs/splice.c` into `fs/pipe.c`. Read from source, not run: io_uring's
  splice goes through the same `do_splice`, and every file's
  `splice_read`, whatever its filesystem, runs inside
  `splice_file_to_pipe`'s lock. A per-pipe "accounted head" marks the
  buffers already attributed; at either unlock, the buffers between it and
  `pipe->head` are the holder's, and their lengths are summed by
  `bpf_loop`. Nothing reads from the pipe while the holder has the mutex,
  so those buffers are whole.
- **The step** is a hash from tid to step. `task_newtask` copies the
  parent's step to the child, or clears the child's tid when the parent
  has none; `sched_process_exit` clears it. The wrapper sets the shell's
  step as it feeds each one. A step is read at the write, in the kernel,
  so nothing looks a pid up afterwards (Q3).

### What ran

`drive.c` is the shell and the wrapper in one; each byte's value is the
step that wrote it (`0` for an untagged writer), so the check is the
stream itself. 3,806,163 bytes per run:

| step | writers |
|---|---|
| 0 | untagged: 1,500 one-byte writers, each its own process, after a pid wrap (`pid_max` 400) |
| 1 | the shell's own 100 bytes; a double-forked job that writes 1 MiB in 8 KiB writes during step 2 and 1 MiB in 6000-byte writes during step 3 |
| 2 | the shell's own 50 bytes; a process and its thread, each one 256 KiB `write` |
| 3 | five processes at once, 192 KiB each: `splice` from a file, `sendfile`, `vmsplice`, `tee` (from a pipe another process fills), `splice` from a pipe; and a sixth, io_uring writes, half `IOSQE_ASYNC` |
| 4 | the shell's own 200 ten-byte writes, against step 0's writers |

| run | bytes attributed | wrong | switches between two tagged steps | untagged writes on reused tids |
|---|---|---|---|---|
| 1 | 3,806,163 | 0 | 26 | 145 |
| 2 | 3,806,163 | 0 | 24 | 145 |
| 3 | 3,806,163 | 0 | 28 | 145 |
| control: count each write whole at `anon_pipe_write`'s entry, before the mutex | 3,806,163 | 744,844 | 26 | |
| control: never clear a tid's step | 3,806,163 | 192 | 28 | 193 |

Steps 1, 2 and 3 really interleaved: the stream switched between two
tagged steps 24 to 28 times a run, and every byte of every switch went
to its writer's step. No ring event was dropped, and no buffer was found
unaccounted (`ROUTE_ORPHAN`) or accounted and never landed (`ROUTE_LOST`).

The first control is two bugs in one: it counts writes in the wrong order,
and, since it never advances the accounted head, the next unlock also
claims the write's buffers. Either alone is a wrong attribution the check
must see, and it saw 744,844 bytes. The second shows the clearing is what
keeps a reused tid from carrying a step: 192 one-byte writers took a step
that was not theirs.

### Q4: completeness

Every run attributed exactly the bytes the reader read, so a total is a
check the host can make: the sum of a call's events against the bytes it
read. Two failures are caught inside the probe: buffers a writer finds
unaccounted (`ROUTE_ORPHAN`), and an accounted head past the real one
(`ROUTE_LOST`, a copy that faulted and was discarded). One is not caught:
a route this probe does not know, which adds buffers and lets go of the
mutex without `pipe_unlock` or `anon_pipe_write`, would have its buffers
claimed by the next `pipe_unlock` holder, with totals that still match.
Reading 6.18's source, the only such writer is a watch queue's
(`O_NOTIFICATION_PIPE`), which a command's output pipe never is. So the
guarantee rests on that list of entry points, read from the kernel's
source, and is kept per kernel version. The observer already supports
5.17 and later, and older kernels name the write path `pipe_write`:
each version the observer supports would need its list.

### Not answered here

- **Cost.** `copy_page_from_iter` is called for most copies from user
  memory, and the probe does a hash lookup on each. Emulated timings mean
  nothing, so this is unmeasured.
- **A write cut short.** `anon_pipe_write` returning early (`EPIPE`,
  `EAGAIN`, a fault) leaves its noted iter behind until the task's next
  write to the pipe or its exit. Only a later `copy_page_from_iter` on the
  same task with the same iter address could match it. Not exercised.
- **Learning the pipe.** The probe learns the pipe's `pipe_inode_info` and
  its head from the first write. A wrapper would register the pipe before
  starting the shell, while it is empty and has no writer.
- **Two pipes.** pi spawns a command with separate stdout and stderr
  pipes and joins them. Each pipe would be attributed on its own, and how
  their order joins stays as pi's is.

## Sources

`docs/findings/archive/S280-output-by-writer/`, which a plan would build on:

- `attr.bpf.c`, `attr.h`: the kernel side, and its `NAIVE` and `NOCLEAN`
  controls.
- `drive.c`: the driver, the reader and the check.
- `init`: the guest's PID 1. It runs the driver three times and each
  control once.
- `Containerfile`: builds the three drivers and the guest's initramfs in
  the lane's Docker, from the running kernel's BTF.
- `run.sh`: builds and boots it, with QEMU (`apt-get install
  qemu-system-arm`), on the kernel `@pinetrie/vm`'s `pinnedKernel` puts in
  `node_modules/.cache/pinetrie-observer-suite`.
