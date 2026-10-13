# S176 — Can a PID namespace identify a lane in the kernel and authorize nested registration?

- **Status:** Answered

**Question.** Can pine·trie replace a lane's cgroup identity with the PID namespace of its first process, so nested lanes remain distinct under rootless Docker while a host can register only lanes below its own namespace?

The observer would read the active PID namespace's inode number at exec and use it as the lane key. The loader would open `/proc/<pid>/ns/pid` when it registers a lane and keep that file descriptor until unregister. A forwarded registration would translate the PID reported inside the outer lane to the corresponding process visible to the observer, then require the registered namespace to be a strict descendant of that outer lane's namespace.

**Kill criterion.** Kill this design if any of these holds on pine·trie's supported kernels and nested Docker arrangement:

1. The BPF program cannot read the active PID namespace's stable identifier at exec with CO-RE.
2. An open namespace file descriptor does not prevent reuse of that identifier after the namespace's processes exit.
3. From the observer container, `NS_GET_PARENT` cannot prove that an inner container's PID namespace is strictly below its outer lane's namespace.
4. An inner PID cannot be translated through `/proc/*/status` `NSpid` values to exactly one process visible to the observer.

**Throw away.** Disposable BPF, namespace and `/proc` probes. Keep only the measured commands, source and output needed to reproduce the answers.

## Answers

Measured on 2026-10-13 in a pine·trie lane, on Linux 6.18.55 and its rootless Docker 29.8.2, and in the observer suite's QEMU guest on the lane VM's Linux 6.18.56 kernel. All four kill criteria pass.

1. **BPF can read the active PID namespace number at exec.** A disposable change to the product observer read `task_struct.thread_pid`, `pid.level`, `pid.numbers[level].ns`, and `ns_common.inum` with CO-RE. The loader registered the lane's `/proc/<pid>/ns/pid` inode. The complete observer suite then attributed runs to that number. It passed 15 of its 17 existing checks. The two failures were expected consequences of the disposable half-conversion: both guest lanes share one PID namespace, so the loader's remaining cgroup-keyed lane table could not distinguish their remote-directory policy, and unregister still deleted a cgroup key. Every kernel attribution check passed, including inheritance into a new PID namespace and attribution after a cgroup move.

   The verifier rejected reading `pid.numbers[level]` by copying the flexible-array element with `bpf_probe_read_kernel`; pointer arithmetic from the CO-RE offset of `numbers`, followed by CO-RE reads of `upid.ns` and `ns.inum`, loaded and ran. The production program can use that form.

2. **An open namespace file descriptor pins the namespace and its number.** An observer-like container joined the outer lane's PID namespace and opened an inner container's `/proc/<pid>/ns/pid`. The inner container then exited. `fstat` on the held descriptor returned inode `4026532589` both before and after exit, and `NS_GET_PARENT` still returned the outer lane's namespace, inode `4026532475`. Closing the descriptor releases the pin. The loader therefore can prevent number reuse by retaining the descriptor until unregister or deliberate stale-lane removal.

3. **The observer can prove strict ancestry with `NS_GET_PARENT`.** With the same grants and PID namespace as the observer role, the probe opened an inner rootless-Docker container's namespace. Its chain was `4026532589 4026532475`: the inner container's namespace, then the outer lane's. The outer host can accept forwarding only when walking parents from the proposed lane reaches the forwarding lane's pinned namespace after at least one step.

4. **`NSpid` translates an inner PID uniquely.** The rootless Docker daemon reported its inner container's first process as PID 1. In the outer lane's `/proc`, exactly one status file had `NSpid: 1293 1`, and Docker reported outer PID 1293 for that container. Scanning for the complete suffix supplied by the inner host identifies one outer-visible process. Matching only the final PID is insufficient when descendant namespaces exist; the translation must match the caller's known namespace chain or reject ambiguity.

The kill criterion does not fire. A PID namespace can identify a lane in the kernel and authorize nested registration. The implementation must pin every registered namespace, validate strict ancestry for forwarded registration, reject ambiguous `NSpid` translations, and define when the machine role drops registrations left by a host that never returns.

## Evidence kept

- `probe.c` prints a namespace's parent chain with `NS_GET_PARENT` and contains the namespace-lifetime probe.
- `pin.c` is the process-exit form used against a rootless-Docker container while an observer-like container held its namespace descriptor.
- `run.sh` records the parent-chain and `NSpid` translation commands.
- `bpf-read.patch` records the disposable CO-RE field chain. The measured code used pointer arithmetic from `bpf_core_field_offset(struct pid, numbers)` for the flexible array, not the initial `bpf_probe_read_kernel` sketch in that note.
