// Mutations for the observer's kernel side and its loader. Run: pnpm mutate
// scripts/mutations/observer.ts. Each runs `e2e:observer`'s one scenario: a
// QEMU guest on the lane VM's kernel, about a minute with the build.
import type { Mutation } from "../mutate.ts"

const bpf = "packages/lanehost/observer/observe.bpf.c"
const loader = "packages/lanehost/observer/observe.c"
const kernel = { suite: "observer", scenario: "kernel" } as const
const policy = "packages/lanehost/observer.ts"
const unit = [
  "pnpm",
  "exec",
  "vitest",
  "run",
  "packages/lanehost/observer.test.ts",
]

export const mutations: readonly Mutation[] = [
  {
    ...kernel,
    name: "a kprobe names a function the kernel lacks",
    file: bpf,
    from: 'SEC("kprobe/security_path_rename")\n',
    to: 'SEC("kprobe/security_path_renamed_nowhere")\n',
    expect: "the loader loads, attaches and is ready on the lane VM's kernel",
  },
  {
    ...kernel,
    name: "a rename's source is reported missing before it",
    file: bpf,
    from: "  e->before = kind_of(BPF_CORE_READ(old_d, d_inode));\n",
    to: "  e->before = PK_MISSING;\n",
    expect:
      "each call of a run is reported, with what was at its paths before it",
  },
  {
    ...kernel,
    name: "an open that finds nothing is not reported",
    file: bpf,
    from: "  if (ret != -ENOENT_ && ret != -ENOTDIR_) return 0;\n",
    to: "  return 0;\n",
    expect:
      "an open that finds nothing is reported, its path joined to the caller's directory",
  },
  {
    ...kernel,
    name: "a stamp drops the ctime's nanoseconds",
    file: bpf,
    from: "    e->ctime_nsec = BPF_CORE_READ(i, i_ctime_nsec);\n",
    to: "    e->ctime_nsec = 0;\n",
    expect:
      "a written file's release carries the stamp a stat reads after, through a mapping written after close too",
  },
  {
    ...kernel,
    name: "a run's exit is the raw wait status",
    file: bpf,
    from: "  return (code & 0x7f) ? 128 + (code & 0x7f) : ((code >> 8) & 0xff);\n",
    to: "  return code;\n",
    expect:
      "a run's exit is its command's status, 128 and the signal for one killed",
  },
  {
    ...kernel,
    name: "a run's new tasks are not counted live",
    file: bpf,
    from: "  live_add(&t.run, 1);\n  return 0;\n}\n\n// A wait status",
    to: "  return 0;\n}\n\n// A wait status",
    expect:
      "a daemon's write after its command returned is its run's, and the run ends after it",
  },
  {
    ...kernel,
    name: "every CPU builds its events in one scratch",
    file: bpf,
    from: "  __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);\n  __uint(max_entries, 1);\n  __type(key, u32);\n  __type(value, struct event);\n",
    to: "  __uint(type, BPF_MAP_TYPE_ARRAY);\n  __uint(max_entries, 1);\n  __type(key, u32);\n  __type(value, struct event);\n",
    expect: "two runs at once are each given only their own writes",
  },
  {
    ...kernel,
    name: "a run's threads are not tagged",
    file: bpf,
    from: "  struct tag *parent = current_tag();\n",
    to: "  struct tag *parent = (clone_flags & 0x10000) ? 0 : current_tag();\n",
    expect:
      "every thread's write is its run's, through env -i, a static binary, and a user and pid namespace of its own",
  },
  {
    ...kernel,
    name: "io_uring's workers are not tagged",
    file: bpf,
    from: "  struct tag *parent = current_tag();\n",
    to: "  struct tag *parent = (clone_flags & 0x80000000ULL) ? 0 : current_tag();\n",
    expect: "io_uring's workers' calls are their run's",
  },
  {
    ...kernel,
    name: "an open in no run is reported",
    file: bpf,
    from: "  struct tag *t = current_tag();\n  if (!t) return 0;\n  struct run_key run = t->run;\n  u32 tid = current_tid();\n",
    to: "  struct tag none = {};\n  struct tag *t = current_tag();\n  if (!t) t = &none;\n  struct run_key run = t->run;\n  u32 tid = current_tid();\n",
    expect: "a process in no run is reported nowhere",
  },
  {
    ...kernel,
    name: "a run begins in any cgroup",
    file: bpf,
    from: "  if (!bpf_map_lookup_elem(&registered, &cgroup)) return 0;\n",
    to: "",
    expect: "an exec in a cgroup no host registered begins no run",
  },
  {
    ...kernel,
    name: "a tagged task's exec looks for another run",
    file: bpf,
    from: "  if (bpf_map_lookup_elem(&tags, &tid)) return 0;\n",
    to: "",
    expect: "a tagged task's exec with another run's number stays in its run",
  },
  {
    ...kernel,
    name: "an event's lane is the cgroup its task is in now",
    file: bpf,
    from: "  e->run = *run;\n",
    to: "  e->run = *run;\n  e->run.lane = bpf_get_current_cgroup_id();\n",
    expect:
      "a run's events go to the lane it began in after its process moves to another cgroup",
  },
  {
    ...kernel,
    name: "no directory is remote",
    file: loader,
    from: "is_remote(l, pa)) {\n",
    to: "is_remote(NULL, pa)) {\n",
    expect:
      "a remote directory's release carries the loader's lstat, then the kernel's stamp, and its read the lstat's; another lane's carries neither",
  },
  {
    ...kernel,
    name: "a flush answers without draining the ring",
    file: loader,
    from: "  ring_buffer__consume(rb);\n  int m = run_keys(",
    to: "  int m = run_keys(",
    expect:
      "a flush is answered after every event its lane's runs made before it",
  },
  {
    ...kernel,
    name: "an unregistered lane stays in the kernel's map",
    file: loader,
    from: "  bpf_map__delete_elem(skel->maps.registered, &cg, sizeof cg, 0);\n",
    to: "",
    expect: "an unregistered lane begins no new run",
  },
  {
    ...kernel,
    name: "a run's losses after its first are not counted",
    file: bpf,
    from: "    __sync_fetch_and_add(n, 1);\n  } else {\n",
    to: "  } else {\n",
    expect:
      "a ring with no room counts each event it loses against its run, and every run still ends",
  },
  {
    name: "a release is raced by its size alone",
    file: policy,
    from: "  kernel.ino !== lstat.ino || stampSize(kernel.stamp) !== stampSize(lstat.stamp)\n",
    to: "  stampSize(kernel.stamp) !== stampSize(lstat.stamp)\n",
    command: unit,
    expect: "is raced when the size or the inode differs, never by ctime alone",
  },
  {
    name: "a remote release always keeps the kernel's stamp",
    file: policy,
    from: "  return { lane, run, event: raced ? event : { ...event, raced: null } }\n",
    to: "  return { lane, run, event }\n",
    command: unit,
    expect: "keeps the kernel's stamp only when raced",
  },
  {
    name: "a notice goes to its lane's connection before it subscribes",
    file: policy,
    from: "  return to !== undefined && subscribed.has(to)\n",
    to: "  return to !== undefined\n",
    command: unit,
    expect: "a notice of a lane no subscribed connection holds is held",
  },
  {
    name: "a lane with no host holds without bound",
    file: policy,
    from: '  held < bound || notice.event.kind === "end" ? "keep" : "lose"\n',
    to: '  "keep"\n',
    command: unit,
    expect:
      "a lane holds up to its bound, then counts each loss; an end is always kept",
  },
  {
    name: "a held end comes before the losses",
    file: policy,
    from: '  return [...input.held.filter(n => n.event.kind !== "end"), ...losses, ...ends]\n',
    to: "  return [...input.held, ...losses]\n",
    command: unit,
    expect:
      "a lane's new host gets what was held, then each run's losses, then the ends",
  },
  {
    name: "the role exits while a host is connected",
    file: policy,
    from: "  input.connections === 0 && input.now - input.quietSince >= IDLE_MS\n",
    to: "  input.now - input.quietSince >= IDLE_MS\n",
    command: unit,
    expect: "it exits once no connection has been open for a minute",
  },
  {
    name: "rootless Docker outside a lane is forwarded",
    file: policy,
    from: "    : facts.forwarded\n",
    to: "    : true\n",
    command: unit,
    expect:
      "rootless Docker is forwarded inside a lane and refused outside one",
  },
  {
    name: "the version depends on the sources' order",
    file: policy,
    from: "  for (const s of [...sources].sort((a, b) => a.path.localeCompare(b.path)))\n",
    to: "  for (const s of sources)\n",
    command: unit,
    expect: "its version changes with any source, whatever their order",
  },
  {
    name: "a lane's held notices are never sent once it is registered",
    file: "packages/lanehost/observer-server.ts",
    from: "      conn.lanes.add(got.lane)\n      release(got.lane)\n",
    to: "      conn.lanes.add(got.lane)\n",
    command: unit,
    expect: "a host's lane's notices reach it, and a flush answers after them",
  },
  {
    name: "the machine role's container keeps the network",
    file: "packages/docker/plan.ts",
    from: '  network: "none",\n  // The kernel',
    to: '  network: "bridge",\n  // The kernel',
    command: ["pnpm", "exec", "vitest", "run", "packages/docker/api.test.ts"],
    expect:
      "the machine role's container is made with its grant and nothing more",
  },
]
