# S302 — a lane assumes a Linux kernel in five places that are built in; its programs, paths, image and target are data

Numbered S289 until 2026-10-21, when two files held that number.
Numbered S270 until 2026-10-21, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0205

**Question.** A lane is a Linux container (ADR-0130). Which of pine·trie's
assumptions about a lane's machine are data, which a setting, a constant
or a runtime's target could change, and which are built in, so that a lane
on another machine (a macOS VM for Xcode work, a remote machine) means new
code, not new values? The goal is to state them in the lanes notes, not
to remove any.

**Kill criterion.** None: an inventory. It is wrong if a built-in one
turns out to be a value, or a value turns out to be assumed elsewhere.

**Throw away.** Nothing ran; read from source at the merge of 2026-10-19.

## Answers

**Built in.** Each needs new code on a machine without it:

1. **The machine's observer is a Linux kernel's BPF program**
   (`packages/lanehost/observer/observe.bpf.c`): Linux 5.17 or later, BTF,
   kprobes, built for arm64 or x86. A lane is a PID namespace to it. A host
   that cannot observe refuses lanes (`planObserver`, from
   `host/work/runtime.ts`), since a turn classes what it wrote from the
   observed runs (ADR-0135, the disk model). **This is the deepest one:**
   a lane that is not Linux needs another way to attribute a run's file
   calls, or a disk model that does without them.
2. **The lane runtime is Linux ELF for the machine's architecture**
   (`packages/lanes/runtime.ts`): Node, the libraries `ldd` lists, glibc's
   loader as `ld.so`, and musl static builds of `RUNTIME_PROGRAMS`,
   downloaded for `aarch64` or `x86_64` (`packages/lanes/image/Containerfile`).
   The helper and every tool call run on it.
3. **Disks are btrfs subvolumes** (S301): `packages/lanehost/disks.ts`,
   `diff.ts`, `folder.ts`, and the lanes directory's check
   (`planDockerHost`, `packages/docker/plan.ts`); the VM formats its data
   disk btrfs (`packages/vm/image/init`).
4. **A lane is an OCI container under Linux's isolation**
   (`packages/docker/plan.ts`, `renderRun`): Docker's seccomp profile,
   `no-new-privileges`, `--init`; a nested lane's narrow profile,
   `/dev/net/tun` and rootless Docker inside (S125). `sync` before every
   snapshot (`planSnapshot`).
5. **A project's grant of host ports is iptables** in the VM
   (`packages/lanehost/grants.ts`, `DOCKER-USER`).

**Built in, and not about Linux: the runtime's machine sees the host's
files.** Every lane binds host paths: your working copy, read-only at
`HOST_WORKING_COPY`; pine·trie's install at `PINETRIE_MOUNT`; the lane
runtime at `RUNTIME_MOUNT`; shared directories and granted paths; the
host's ssh socket (`planMounts`, `packages/lanes/plan.ts`). `DockerTarget`
(`packages/docker/target.ts`) maps each path to where Docker's machine
sees it (`pathOf`: itself on Linux, a virtiofs slot on the Mac), and the
observer reads a shared directory's files over virtiofs
(`remoteHostPaths`). A remote machine with no view of the host's files
breaks all of these, not only the disks: it needs the files carried, not
mapped.

**Data.** Each is a value a setting, a constant or a target holds:

- **Which programs every lane carries:** `RUNTIME_PROGRAMS`
  (`packages/core/lane-env.ts`), each a static build in the default image.
- **Where a lane sees things:** `WORKSPACE_ROOT`, `HOST_WORKING_COPY`,
  `HOST_MOUNT`, `RUNTIME_MOUNT`, `STATES_MOUNT`, `LANE_HOME` (core and
  lanes constants).
- **The image:** a project's own Containerfile replaces the default
  (`projectContainerfile`); `checkImage` asks only a POSIX `sh` and git
  2.41 of it.
- **Which architectures:** the default image's `case` on `uname -m`, and
  the observer's build; the VM accepts Apple silicon alone
  (`vmHostRefusal`, `not-apple-silicon`).
- **Where Docker is, and how host paths reach it:** `DockerTarget`
  (`socket`, `pathOf`, `labels`, `hostSocket`, `hostAddress`,
  `remoteHostPaths`) and the lanes directory, both chosen by
  `planRuntime` (`host/work/runtime.ts`).
- **The machine's facts:** `rootless`, which picks a diff by walk and the
  observer by its lane's helper (S288).

So **a lane that is not Linux is not a swap behind today's ports**: items
1, 2 and 4 are what a lane is, and the disk model rests on 1. A remote
Linux machine keeps 1 to 5 and breaks the host-file locality. A Linux
machine with another container runtime or another directory store keeps
everything above but the runtime's own code (S301, S288).
