# S172 — An eBPF observer loaded from outside the lane attributes every write without stopping any call, loses nothing silently, and costs a run 1.7× where the supervisor costs 7×; over virtiofs only a userspace lstat reads the Mac's stamp

- **Status:** Answered
- **Led to:** ADR-0135

**Question.** The supervisor stops each watched call until it has
answered, and every problem it has comes from that: a signal can cut the
wait short with EINTR (S170), a listener cannot nest, a tracer takes
`strace` and `gdb` away (S171), and each call costs about 60 µs. It never
needs to deny or change a call; it stops them only because seccomp was the
one way to see paths by process without privilege (S158). An eBPF program
sees the same calls in the kernel without stopping them, and needs a
privilege the lane need not have: the lane VM's own root, or on Linux a
privileged container, which Docker's access already amounts to. That
rests on:
1. **The VM's kernel can run it.** Alpine's `linux-virt` has BTF,
   kprobes and raw tracepoints, but no `FUNCTION_TRACER`, so no fentry and
   no BPF LSM. Does a kprobe observer load and pass the verifier there?
2. **Attribution.** A run is tagged where its first process execs a
   marker program, and every task it creates inherits the tag in the
   kernel, as a seccomp filter is inherited. Is every write its run's, and
   no other's, through forks, threads, `setsid` daemons that outlive the
   command, `env -i`, static binaries, two runs at once, a run inside a
   run, a user and pid namespace, and io_uring?
3. **Nothing lost silently.** A ring buffer can fill. Is every event
   either delivered or counted lost against its run?
4. **Release stamps.** Is the stamp read at a written file's last
   release (`__fput`) the one the lane's `stat` shows after, through a
   mapping written after close, and over virtiofs, where the guest's
   inode may hold a cached ctime?
5. **What it leaves working:** no EINTR, `strace` and `gdb` inside a
   run.
6. **Cost.** Per open and close, and on a copy of a tree of files,
   against no observer and against `supervise.c`, for a run's own
   processes and for every other process on the machine.

**Kill criterion.**
- If any write is attributed to the wrong run or to none, with no loss
  counted, the observer is not correct.
- If the ring loses events under a flood a lane could make, with a ring
  of a size the VM can spare, a run would often be marked unknown.
- If a release's stamp is not the lane's, on the lane's disk or over
  virtiofs, a shared file's lineage cannot rest on it.
- If it costs a run more than `supervise.c` does.

**Throw away.** Probes and output in `.plans/disk-model-probes/S172/`,
and into `docs/findings/S172-ebpf-observer/`, with the Mac's results.

## Method

- `observe.bpf.c` and its loader `observe.c` (libbpf, static): kprobes on
  `security_file_open`, `security_path_{unlink,rmdir,mkdir,rename,symlink,link,truncate}`
  and `__fput`; raw tracepoints `task_newtask`, `sched_process_exec` and
  `sched_process_exit` for the tags. Paths are walked from the dentry up
  through each mount to the task's root, as the lane sees them. A run's
  end is sent when its last task exits.
- `workload.sh` runs each case as a numbered run, and `check.py` checks
  the events against what it did.
- `qemu-test.sh` runs it all in a QEMU guest (software emulation, no KVM
  in a lane) with Alpine's `linux-virt` 6.18.56; the VM pins 6.18.55,
  which Alpine no longer serves, and a patch release keeps its config.
- `run-mac.sh` runs it on the Mac in the lane VM: the observer in a
  privileged container, each workload in an ordinary one under Docker's
  default profile, as a lane's. It writes one file over virtiofs, in its
  own `results/`, found in the VM by a marker file.
- The build also takes `bench.c` (S171's folder), `eintr.c` (S170's),
  `packages/lanes/image/supervise.c`, and a `vmlinux.h` made with
  `bpftool btf dump file /sys/kernel/btf/vmlinux format c`.
- A release's `ustamp` is the observer's own `lstat` of the file, through
  `/proc/<pid>/root`, as soon as the event reaches it, and `lag` the µs
  from the release to that `lstat`.

## Answers

Run on the Mac's lane VM (`6.18.55-0-virt`, 16 CPUs, 12 GiB), 2026-10-12,
at full counts, after the same suite in emulation; `results-mac.txt` and
`cost-mac.tsv` in this spike's folder. 38 of 39 checks passed; the one
that failed is answer 4's second point, as expected once it was known.

1. **It runs on the VM's kernel,** with kprobes and raw tracepoints only.
   The path walk must be a `bpf_loop` callback: as an inline loop its
   branches went past the verifier's million instructions. `bpf_loop`
   needs Linux 5.17.
2. **Attribution is exact in every case:** forks, 16 threads, a `setsid`
   daemon writing after its command returned (and the run's end sent only
   after it exited), `env -i` with a static binary, two runs at once (400
   writes, none crossed), a run inside a run (the inner one's), a user and
   pid namespace, and nothing from a process outside every run. io_uring's
   worker threads are made by `create_io_thread`, which skips the fork
   tracepoint; tagging on `task_newtask` caught them in emulation. In the
   lanes, io_uring is refused: Docker's default profile blocks it, and the
   nested profile is the default with namespace calls added.
3. **Nothing is lost silently.** With a 64 MiB ring, 1,162,747 events
   and none lost, 8 runs of 100,000 opens at once among them. With 1 MiB,
   each of 8 runs lost 17,958 to 21,676 of 50,000, and delivered plus
   counted lost was exactly 50,000 for every run.
4. **Release stamps.**
   - On the lane's own disk, the stamp the kernel holds at the last
     release is the file's `stat` after, writes through a mapping after
     close included.
   - **Over virtiofs it is not:** `4:…310561100` at release, where the
     lane's `stat` and the Mac's both read `4:…310800557`. The guest
     stamps the inode with its own clock at the write; the Mac sets the
     ctime when it applies it, and a fresh `stat` fetches that.
   - **The observer's own `lstat` at release read the Mac's stamp**, 38 µs
     after the release. Over 24,442 releases the lag was median 16.7 µs,
     p99 47.3 µs, max 359.5 µs: the window in which another writer's
     version could be read as this run's. The supervisor's own `lstat` has
     a window of the same kind (other lanes are not stopped), about 26 µs
     (S158). 15,089 releases could not be `lstat`ed at all: S170's probe
     renames or removes each file within microseconds of closing it.
5. **Nothing is cut short and nothing is taken:** no EINTR in S170's
   probe, and `strace -f` and `gdb` ran inside runs.
6. **Cost:**

   | per run | bare | observed, not in a run | observed, in a run | `supervise.c` |
   |---|---|---|---|---|
   | open and close | 0.52 µs | 0.81 µs | 1.36 µs | 58 µs |
   | copy of 1,324 files | 35.5 ms | 38.2 ms | 59.0 ms | 263 ms |

**Against the kill criteria.** None fires. No write went to the wrong run
or none; the ring lost nothing at 64 MiB under a flood of 800,000 events;
a release's stamp is the lane's on its disk from the kernel, and over
virtiofs from a userspace `lstat` within tens of µs; and a run costs 1.7×
where `supervise.c` costs 7.4×.

**Not answered here:**
- **Linux hosts.** A privileged container loads it under rootful Docker;
  under rootless Docker nothing can, and kernels before 5.17 lack
  `bpf_loop`.
- **Nested lanes.** The outer observer sees an inner lane's processes, in
  their own cgroups; their records reaching the inner host is design.
- **A run's identity.** Here any process may exec the marker with any
  number. The host would have to bind a run's number to its lane, as by
  the cgroup the marker runs in.
- **The `lstat` window over virtiofs.** Comparing the kernel's size and
  inode at release with the `lstat`'s would catch some writes that land in
  it; not measured.
