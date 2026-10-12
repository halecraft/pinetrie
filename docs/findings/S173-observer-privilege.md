# S173 — An eBPF observer's container needs CAP_BPF, CAP_PERFMON and CAP_SYS_PTRACE, under Docker's own seccomp profile, and must reach a lane's files through a process that outlives the write

- **Status:** Answered
- **Led to:** ADR-0135

**Question.** S172 ran the observer `--privileged`. A machine's observer
would be a lanehost container of its own, and should hold no more than it
needs. Docker's default seccomp profile allows `bpf` to a container with
`CAP_BPF` and `perf_event_open` to one with `CAP_PERFMON`. So:
1. Does the observer load, attach its kprobes and raw tracepoints, and
   see a run's open and release, with every capability dropped but
   `CAP_BPF` and `CAP_PERFMON`, under Docker's default profile, the host's
   pid and cgroup namespaces, a read-only root and no network?
2. Does its `lstat` through `/proc/<pid>/root` need `CAP_SYS_PTRACE`?
   The lanes' processes are root, as the observer is.
3. Is each of the two capabilities needed, or is one enough?

**Kill criterion.** If it needs `CAP_SYS_ADMIN` or an unconfined seccomp
profile, the machine's observer runs with nearly all of root, and the
plan must say so.

**Throw away.** The probe is `run-caps.sh` in
`.plans/disk-model-probes/S172/`, using S172's image; it and the Mac's
log are in `docs/findings/S173-observer-privilege/`.

## Answers

Run on the Mac's lane VM (`6.18.55-0-virt`), 2026-10-12, twice. Every set
had the host's pid and cgroup namespaces, a read-only root and no network;
each wrote one file from an ordinary container under Docker's defaults.

1. **`CAP_BPF` and `CAP_PERFMON` load it, under Docker's default
   profile,** which allows `bpf` to the one and `perf_event_open` to the
   other. It attached, and saw the run's open and release. Neither
   capability alone loaded it (EPERM), nor did Docker's default
   capabilities. An unconfined profile changed nothing.
2. **Its `lstat` through `/proc/<pid>/root` needs `CAP_SYS_PTRACE`,** for
   a writer running as root as much as for one as uid 1000. Without it,
   neither was read; with it, both were. The kernel lets a process into
   another's `/proc/<pid>/root` without it only when its own capabilities
   cover the other's, and a lane's root holds Docker's default set.
3. **A process that has exited has no `/proc/<pid>/root`.** In the first
   run each writer exited right after its write, and no set, `--privileged`
   included, could `lstat` the file. The observer must reach a lane's
   files through a process that lives as long as the lane: its
   container's first process.

**Kill criterion:** does not fire. No `CAP_SYS_ADMIN`, and Docker's own
seccomp profile.
