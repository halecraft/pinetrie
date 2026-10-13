// Mutations for the observer's kernel side and its loader. Run: pnpm mutate
// scripts/mutations/observer.ts. Each runs `e2e:observer`'s one scenario: a
// QEMU guest on the lane VM's kernel, about a minute with the build.
import type { Mutation } from "../mutate.ts"

const bpf = "packages/lanehost/observer/observe.bpf.c"
const loader = "packages/lanehost/observer/observe.c"
const kernel = { suite: "observer", scenario: "kernel" } as const
const policy = "packages/lanehost/observer.ts"
const relay = [
  "pnpm",
  "exec",
  "vitest",
  "run",
  "apps/pinetrie/host/work/relay.test.ts",
]
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
    name: "a run begins in any PID namespace",
    file: bpf,
    from: "  if (!pid_namespace || !bpf_map_lookup_elem(&registered, &pid_namespace)) return 0;\n",
    to: "  if (!pid_namespace) return 0;\n",
    expect: "an exec in a PID namespace no host registered begins no run",
  },
  {
    ...kernel,
    name: "a PID namespace is read at the header's stride, not the kernel's",
    file: bpf,
    from: "(u64)level * bpf_core_type_size(struct upid));\n",
    to: "(u64)level * sizeof(struct upid));\n",
    expect:
      "each lane is its first process's PID namespace, apart from a sibling's in the same cgroup",
  },
  {
    ...kernel,
    name: "an event's lane is the PID namespace its task is in now",
    file: bpf,
    from: "  e->run = *run;\n",
    to: "  e->run = *run;\n  e->run.lane = pid_namespace_of((struct task_struct *)bpf_get_current_task());\n",
    expect:
      "a run's events go to the lane it began in after its process enters a PID namespace of its own",
  },
  {
    ...kernel,
    name: "a run begins only in a namespace one level below the machine's",
    file: bpf,
    from: "  if (level > 32) return 0;\n",
    to: "  if (level > 1) return 0;\n",
    expect:
      "a lane registered below another begins its own runs, apart from its parent's",
  },
  {
    ...kernel,
    name: "a registered lane's namespace is let go once installed",
    file: loader,
    from: "  l->namespace_fd = fd;\n",
    to: "  l->namespace_fd = -1;\n  close(fd);\n",
    expect:
      "a namespace held registered keeps its number after its processes exit, and gives it up once let go",
  },
  {
    ...kernel,
    name: "a candidate's parents are not asked of the kernel",
    file: loader,
    from: "    int parent = ioctl(at, NS_GET_PARENT_);\n",
    to: "    int parent = -1;\n",
    expect:
      "a lookup at a lane's level finds a process below it by its pid there, with its NSpid and each parent by NS_GET_PARENT",
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
    from: "  bpf_map__delete_elem(skel->maps.registered, &ns, sizeof ns, 0);\n",
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
    from: "  return to != null && subscribed.has(to)\n",
    to: "  return to != null\n",
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
    from: "  registrations.set(got.lane, { ...plan.registration, owner })\n  release(got.lane)\n",
    to: "  registrations.set(got.lane, { ...plan.registration, owner })\n",
    command: unit,
    expect: "a host's lane's notices reach it, and a flush answers after them",
  },
  {
    name: "a closed connection keeps owning its lanes",
    file: "packages/lanehost/observer-server.ts",
    from: "    if (r.owner === id) registrations.set(lane, { ...r, owner: null })\n",
    to: "",
    command: unit,
    expect:
      "a forwarded host registers only below its lane, and no host takes another live one's lane",
  },
  {
    name: "translation takes the pid at any namespace of the level",
    file: policy,
    from: "      namespaceAtLevel(c, forwarding.level) === forwarding.namespace &&\n",
    to: "",
    command: unit,
    expect:
      "translation takes the one process with the pid in the forwarding lane's namespace",
  },
  {
    name: "translation takes the first of several",
    file: policy,
    from: "  return matches.length === 1 ? (matches[0] ?? null) : null\n}\n\n/** What a registration does",
    to: "  return matches[0] ?? null\n}\n\n/** What a registration does",
    command: unit,
    expect:
      "translation takes the one process with the pid in the forwarding lane's namespace",
  },
  {
    name: "a namespace descends from itself",
    file: policy,
    from: "): boolean => namespaces.indexOf(ancestor) >= 1\n",
    to: "): boolean => namespaces.indexOf(ancestor) >= 0\n",
    command: unit,
    expect: "ancestry is strict and reaches the forwarding namespace",
  },
  {
    name: "a forwarded registration may be the forwarding lane itself",
    file: policy,
    from: "    if (!isStrictDescendant(found.namespaces, origin.forwarding))\n",
    to: "    if (false)\n",
    command: unit,
    expect:
      "a forwarded registration is strictly below its forwarding lane, never it, a sibling or another",
  },
  {
    name: "a forwarding lane outside the relaying one is looked up",
    file: policy,
    from: "    origin.forwarding !== origin.within &&\n    !isStrictDescendant(forwarding.namespaces, origin.within)\n",
    to: "    false\n",
    command: unit,
    expect:
      "a forwarded lookup needs its lanes registered, the forwarding one within the relaying one",
  },
  {
    name: "a live host's lane is taken by another",
    file: policy,
    from: "  if (existing.owner !== connection)\n    return refuse(",
    to: "  if (false)\n    return refuse(",
    command: unit,
    expect:
      "a live owner refreshes, a closed one's is reclaimed, another live one's is refused",
  },
  {
    name: "a closed host's lane is never reclaimed",
    file: policy,
    from: '  if (existing.owner === null) return "reclaim"\n',
    to: '  if (existing.owner === null) return refuse("held")\n',
    command: unit,
    expect:
      "a live owner refreshes, a closed one's is reclaimed, another live one's is refused",
  },
  {
    name: "a refresh may change its origin",
    file: policy,
    from: "  return sameOrigin(existing.origin, origin)\n",
    to: "  return true\n",
    command: unit,
    expect:
      "a live owner refreshes, a closed one's is reclaimed, another live one's is refused",
  },
  {
    name: "a direct registration may share the observer's namespace",
    file: policy,
    from: "    if (found.namespaces.length < 2)\n",
    to: "    if (found.namespaces.length < 1)\n",
    command: unit,
    expect:
      "a direct registration is its own process, in a namespace below the observer's",
  },
  {
    name: "any host unregisters a lane",
    file: policy,
    from: '    : existing.owner === connection\n      ? "unregister"\n',
    to: '    : true\n      ? "unregister"\n',
    command: unit,
    expect: "only a lane's owner unregisters it",
  },
  {
    name: "a relayed registration keeps the relaying lane it claimed",
    file: policy,
    from: "          forwarding,\n          within: lane,\n",
    to: "          forwarding,\n          within: String(origin.within ?? lane),\n",
    command: unit,
    expect:
      "a relayed registration is forwarded within the relaying lane, whatever it claimed",
  },
  {
    suite: "lanes",
    scenario: "images",
    name: "each project's host makes an observer of its own",
    file: "packages/docker/runtime.ts",
    from: "    const v = await version\n",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "    const v = `${await version}-${key}`\n",
    expect:
      "two projects' lanes are observed by at most one observer, the machine's, each run attributed",
  },
  {
    name: "a lane's notices before its registration's answer are dropped",
    file: "packages/lanehost/observer-client.ts",
    from: "    lane.notices.unshift(...(unclaimed.get(namespace) ?? []))\n",
    to: "",
    command: relay,
    expect:
      "a host inside a lane registers its lane below the lane, and receives only its own runs",
  },
  {
    name: "a relayed call goes to the role as the lane sent it",
    file: "packages/lanehost/observer-client.ts",
    from: "              c.call(relayedCall(body, held.namespace), signal, onUpdate),\n",
    to: "              c.call(body as ObserverCall, signal, onUpdate),\n",
    command: relay,
    expect:
      "a host inside a lane registers its lane below the lane, and receives only its own runs",
  },
  {
    name: "a connection gives up on a socket not there yet",
    file: "packages/lanehost/observer-connect.ts",
    from: "    if (!connected && missing && Date.now() - since < WAIT_MS) {\n",
    to: "    if (false) {\n",
    command: unit,
    expect: "a connection waits for a socket made after it starts",
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
