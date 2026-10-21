// The observer's kernel side: every file call of a run's tasks, sent through
// one ring buffer, and every byte entering a `bash` call's output pipes, with
// the statement whose task wrote it, through another; stopping none. It
// decides nothing but which task is in which run and statement; the loader
// (`observe.c`) names releases and reads remote stamps, and lanehost's
// machine role routes (packages/lanehost/TECHNICAL.md).
//
// - A run begins where an untagged task in a registered PID namespace execs
//   with `PINETRIE_RUN=<n>` in its environment. Its tag is the run and that
//   namespace, its lane: every task it starts inherits it, whatever namespace
//   its children enter, and a tagged task never takes another.
// - An event the ring has no room for, or a task or written file the maps
//   cannot hold, is counted against its run (`lost_by_run`): never dropped
//   silently.
// - A run's `end` is sent when its last task has exited and its last
//   written file has been let go of (`live` counts both), so its releases,
//   which an exit makes after its tracepoint, come before it. One the ring
//   has no room for is kept in `ended`, and the loader sends it at its next
//   flush.
// - A task takes its parent's statement at birth and keeps it across exec.
//   Only a task allowed to signal changes its own (`attr_signal`).
// - The VM's kernel has no FUNCTION_TRACER: no fentry, no BPF LSM. Kprobes
//   and raw tracepoints only.
#include "kernel.h"
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include "observe.h"

char LICENSE[] SEC("license") = "GPL";

#define FMODE_WRITE_ 0x2
#define FMODE_CREATED_ 0x100000
#define S_IFMT_ 0170000
#define S_IFREG_ 0100000
#define S_IFDIR_ 0040000
#define S_IFLNK_ 0120000
#define AT_FDCWD_ -100
#define ENOENT_ 2
#define ENOTDIR_ 20
#define MAX_ERRNO_ 4095
// How many strings of an exec's environment are looked at for PINETRIE_RUN.
#define ENV_STEPS (1 << 14)
#define ENV_CHUNK 4096

struct {
  __uint(type, BPF_MAP_TYPE_RINGBUF);
  __uint(max_entries, 64 << 20);
} events SEC(".maps");

// PID namespaces a host registered: only there can a run begin.
struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 14);
  __type(key, u64);
  __type(value, u8);
} registered SEC(".maps");

struct tag {
  struct run_key run;
  // The task that began the run: its exit is the command's.
  u32 first;
  // It may signal statements: the run's first task from its exec, and what
  // it starts, until each execs again.
  u32 may_signal;
  // The statement the task was started in, 0 before the run's shell
  // signalled one, and that statement's line.
  u32 statement;
  u32 line;
};

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 18);
  __type(key, u32);  // tid
  __type(value, struct tag);
} tags SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 16);
  __type(key, struct run_key);
  __type(value, s64);  // its live tasks and unreleased written files
} live SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 16);
  __type(key, struct run_key);
  __type(value, u64);  // events lost
} lost_by_run SEC(".maps");

// Runs whose `end` the ring had no room for, with when they ended.
struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 16);
  __type(key, struct run_key);
  __type(value, u64);
} ended SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
  __uint(max_entries, 1);
  __type(key, u32);
  __type(value, struct event);
} scratch SEC(".maps");

// Output's own ring, sized on its own: a flood of output cannot crowd out a
// file event.
struct {
  __uint(type, BPF_MAP_TYPE_RINGBUF);
  __uint(max_entries, 16 << 20);
} output_events SEC(".maps");

// A run's output pipe: which of the run's descriptors it was, and the head
// below which its buffers are attributed.
struct opipe {
  struct run_key run;
  u32 fd;
  u32 seen_head;
};

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 14);
  __type(key, u64);  // struct pipe_inode_info *
  __type(value, struct opipe);
} pipes SEC(".maps");

// Each run's pipes, learned at its first signal, so its end can let them go.
struct run_pipes {
  u64 out;
  u64 err;
};

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 14);
  __type(key, struct run_key);
  __type(value, struct run_pipes);
} pipes_by_run SEC(".maps");

// Output a run could not have attributed: the split of its call cannot be trusted.
struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 16);
  __type(key, struct run_key);
  __type(value, u64);
} output_lost SEC(".maps");

// Signals from a task of the run not allowed to signal, for the suite.
struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 12);
  __type(key, struct run_key);
  __type(value, u64);
} refusals SEC(".maps");

// A write into a run's pipe in progress, by its task: the copies of its
// iterator are the bytes it adds.
struct inflight {
  u64 iter;  // struct iov_iter *
  u64 pipe;
  s64 remaining;
};

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 16);
  __type(key, u32);  // tid
  __type(value, struct inflight);
} writing SEC(".maps");

struct wfile {
  struct run_key run;
  u32 pid;  // the opener's: its release pairs with its open by it
  u32 pad;
};

// Each file opened for writing by a run, by its `struct file`, until its last release.
struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 18);
  __type(key, u64);
  __type(value, struct wfile);
} wfiles SEC(".maps");

struct opening {
  u64 name;  // struct filename *
  int dfd;
  int flags;
};

// An open in progress by a tagged task, from do_file_open's entry to its return.
struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 16);
  __type(key, u32);  // tid
  __type(value, struct opening);
} openings SEC(".maps");

struct envscan {
  u64 at;
  u64 end;
  u64 run;
  u32 inside;  // the chunk read last ended mid-string
  u32 pad;
};

struct envbuf {
  char b[ENV_CHUNK];
};

struct {
  __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
  __uint(max_entries, 1);
  __type(key, u32);
  __type(value, struct envbuf);
} envbufs SEC(".maps");

static __always_inline void count_in(void *map, struct run_key *run) {
  u64 *n = bpf_map_lookup_elem(map, run);
  if (n) {
    __sync_fetch_and_add(n, 1);
  } else {
    u64 one = 1;
    if (bpf_map_update_elem(map, run, &one, BPF_NOEXIST))
      if ((n = bpf_map_lookup_elem(map, run))) __sync_fetch_and_add(n, 1);
  }
}

static __always_inline void count_lost(struct run_key *run) { count_in(&lost_by_run, run); }

static __always_inline void live_add(struct run_key *run, s64 d) {
  s64 *n = bpf_map_lookup_elem(&live, run);
  if (n) {
    __sync_fetch_and_add(n, d);
  } else if (d > 0) {
    if (bpf_map_update_elem(&live, run, &d, BPF_NOEXIST)) count_lost(run);
  }
}

static __always_inline u32 current_tid(void) { return (u32)bpf_get_current_pid_tgid(); }

static __always_inline u64 pid_namespace_of(struct task_struct *task) {
  struct pid *pid = BPF_CORE_READ(task, thread_pid);
  u32 level = BPF_CORE_READ(pid, level);
  if (level > 32) return 0;
  // The kernel's stride, not this header's: its upid holds more than ns.
  struct upid *upid = (struct upid *)((char *)pid + bpf_core_field_offset(struct pid, numbers) +
                                      (u64)level * bpf_core_type_size(struct upid));
  struct pid_namespace *ns = BPF_CORE_READ(upid, ns);
  return (u64)BPF_CORE_READ(ns, ns.inum);
}

static __always_inline struct tag *current_tag(void) {
  u32 tid = current_tid();
  return bpf_map_lookup_elem(&tags, &tid);
}

// An event, built in this CPU's scratch, then copied to the ring by send().
static __always_inline struct event *begin(u32 kind, struct run_key *run) {
  u32 z = 0;
  struct event *e = bpf_map_lookup_elem(&scratch, &z);
  if (!e) return 0;
  e->kind = kind;
  e->pid = (u32)(bpf_get_current_pid_tgid() >> 32);
  e->run = *run;
  e->fid = 0;
  e->ino = 0;
  e->size = -1;
  e->ctime_sec = 0;
  e->ctime_nsec = 0;
  e->flags = 0;
  e->before = PK_MISSING;
  e->before2 = PK_MISSING;
  e->status = 0;
  e->ts = bpf_ktime_get_ns();
  e->a.n = 0;
  e->a.cut = 0;
  e->a.len = 0;
  e->a.abs = 0;
  e->b.n = 0;
  e->b.cut = 0;
  e->b.len = 0;
  e->b.abs = 0;
  return e;
}

// Copies `e` to the ring, trimmed after its first path when it has no second.
static __always_inline void send(struct event *e) {
  long err;
  if (e->b.n) {
    err = bpf_ringbuf_output(&events, e, sizeof(struct event), 0);
  } else {
    u64 size = offsetof(struct event, a) + offsetof(struct pathbuf, buf) + (u64)e->a.len;
    if (size > offsetof(struct event, b)) size = offsetof(struct event, b);
    err = bpf_ringbuf_output(&events, e, size, 0);
  }
  if (!err) return;
  // An end is never lost: the loader sends it at its next flush.
  if (e->kind == EV_END) {
    u64 at = e->ts;
    if (!bpf_map_update_elem(&ended, &e->run, &at, BPF_ANY)) return;
  }
  count_lost(&e->run);
}

static __always_inline void forget_pipe(u64 key, struct run_key *run) {
  if (!key) return;
  struct opipe *o = bpf_map_lookup_elem(&pipes, &key);
  // The address may be another run's pipe by now: the old one was freed.
  if (o && o->run.lane == run->lane && o->run.run == run->run) bpf_map_delete_elem(&pipes, &key);
}

// A run's pipes let go of at its end: nothing of it is attributed after.
static __always_inline void forget_pipes(struct run_key *run) {
  struct run_pipes *rp = bpf_map_lookup_elem(&pipes_by_run, run);
  if (!rp) return;
  struct run_pipes p = *rp;
  bpf_map_delete_elem(&pipes_by_run, run);
  forget_pipe(p.out, run);
  forget_pipe(p.err, run);
}

// A run's task exited or its written file was let go of: at the last, the
// run has ended, and nothing of it is still to come.
static __always_inline void live_done(struct run_key *run) {
  s64 *n = bpf_map_lookup_elem(&live, run);
  if (!n || __sync_fetch_and_add(n, -1) != 1) return;
  struct run_key r = *run;
  bpf_map_delete_elem(&live, &r);
  forget_pipes(&r);
  struct event *e = begin(EV_END, &r);
  if (e) send(e);
}

static __always_inline u32 kind_of(struct inode *i) {
  if (!i) return PK_MISSING;
  u32 mode = BPF_CORE_READ(i, i_mode) & S_IFMT_;
  if (mode == S_IFREG_) return PK_FILE;
  if (mode == S_IFDIR_) return PK_DIR;
  if (mode == S_IFLNK_) return PK_LINK;
  return PK_OTHER;
}

// The inode's identity and version: its number, size and ctime.
static __always_inline void stamp(struct event *e, struct inode *i) {
  if (!i) return;
  e->ino = BPF_CORE_READ(i, i_ino);
  e->size = BPF_CORE_READ(i, i_size);
  if (bpf_core_field_exists(i->i_ctime_sec)) {
    e->ctime_sec = BPF_CORE_READ(i, i_ctime_sec);
    e->ctime_nsec = BPF_CORE_READ(i, i_ctime_nsec);
  } else if (bpf_core_field_exists(((struct inode___v66 *)i)->__i_ctime)) {
    e->ctime_sec = BPF_CORE_READ((struct inode___v66 *)i, __i_ctime.tv_sec);
    e->ctime_nsec = (u32)BPF_CORE_READ((struct inode___v66 *)i, __i_ctime.tv_nsec);
  } else {
    e->ctime_sec = BPF_CORE_READ((struct inode___v517 *)i, i_ctime.tv_sec);
    e->ctime_nsec = (u32)BPF_CORE_READ((struct inode___v517 *)i, i_ctime.tv_nsec);
  }
}

struct walkctx {
  u64 d, m, mnt, root_d, root_m;
  u32 which, pad;
};

// One step up a path: a component, or a mount crossed. A bpf_loop callback:
// as an inline loop, its branches multiplied past the verifier's limit.
static long step(u64 i, struct walkctx *c) {
  if (c->d == c->root_d && c->m == c->root_m) return 1;
  struct dentry *d = (struct dentry *)c->d;
  struct vfsmount *m = (struct vfsmount *)c->m;
  struct mount *mnt = (struct mount *)c->mnt;
  u64 mroot = (u64)BPF_CORE_READ(m, mnt_root);
  u64 parent = (u64)BPF_CORE_READ(d, d_parent);
  if (c->d == mroot || c->d == parent) {
    u64 up = (u64)BPF_CORE_READ(mnt, mnt_parent);
    if (up == c->mnt) return 1;
    c->d = (u64)BPF_CORE_READ(mnt, mnt_mountpoint);
    c->mnt = up;
    c->m = up + bpf_core_field_offset(struct mount, mnt);
    return 0;
  }
  u32 z = 0;
  struct event *e = bpf_map_lookup_elem(&scratch, &z);
  if (!e) return 1;
  struct pathbuf *p = c->which ? &e->b : &e->a;
  u32 off = p->len;
  if (off >= PATHMAX || p->n >= MAXC) {
    p->cut = 1;
    return 1;
  }
  const unsigned char *name = BPF_CORE_READ(d, d_name.name);
  long got = bpf_probe_read_kernel_str(&p->buf[off & (PATHMAX - 1)], NAMEMAX, name);
  if (got <= 0) {
    p->cut = 1;
    return 1;
  }
  p->len = off + (u32)got;
  p->n++;
  c->d = parent;
  return 0;
}

// The path of `d` under `m`, as the current task sees it: up through each
// mount to the task's root, leaf first, after what the path holds already.
static __always_inline void walk(u32 which, struct dentry *d, struct vfsmount *m) {
  struct task_struct *t = (struct task_struct *)bpf_get_current_task();
  struct walkctx c = {
      .d = (u64)d,
      .m = (u64)m,
      .mnt = (u64)m - bpf_core_field_offset(struct mount, mnt),
      .root_d = (u64)BPF_CORE_READ(t, fs, root.dentry),
      .root_m = (u64)BPF_CORE_READ(t, fs, root.mnt),
      .which = which,
  };
  bpf_loop(MAXC + 16, step, &c, 0);
}

// A directory entry's path: its name, then its directory's.
static __always_inline void walk_in(struct pathbuf *p, u32 which, const struct path *dir, struct dentry *leaf) {
  const unsigned char *name = BPF_CORE_READ(leaf, d_name.name);
  long got = bpf_probe_read_kernel_str(p->buf, NAMEMAX, name);
  if (got <= 0) {
    p->cut = 1;
    return;
  }
  p->len = (u32)got;
  p->n = 1;
  walk(which, BPF_CORE_READ(dir, dentry), BPF_CORE_READ(dir, mnt));
}

// Every new task, io_uring's workers included, which are made without the
// fork tracepoint. The creator is the current task.
SEC("raw_tp/task_newtask")
int BPF_PROG(on_newtask, struct task_struct *child, u64 clone_flags) {
  struct tag *parent = current_tag();
  if (!parent) return 0;
  struct tag t = *parent;
  t.first = 0;
  u32 ctid = BPF_CORE_READ(child, pid);
  // A task the map cannot hold escapes its run: the run is incomplete.
  if (bpf_map_update_elem(&tags, &ctid, &t, BPF_ANY)) {
    count_lost(&t.run);
    return 0;
  }
  live_add(&t.run, 1);
  return 0;
}

// A wait status as a shell gives it: the exit code, or 128 and the signal.
static __always_inline u32 shell_status(int code) {
  return (code & 0x7f) ? 128 + (code & 0x7f) : ((code >> 8) & 0xff);
}

SEC("raw_tp/sched_process_exit")
int BPF_PROG(on_exit, struct task_struct *p) {
  u32 tid = BPF_CORE_READ(p, pid);
  struct tag *t = bpf_map_lookup_elem(&tags, &tid);
  if (!t) return 0;
  struct run_key run = t->run;
  u32 first = t->first;
  bpf_map_delete_elem(&tags, &tid);
  bpf_map_delete_elem(&openings, &tid);
  bpf_map_delete_elem(&writing, &tid);
  if (first) {
    struct event *e = begin(EV_EXIT, &run);
    if (e) {
      e->status = shell_status(BPF_CORE_READ(p, exit_code));
      send(e);
    }
  }
  live_done(&run);
  return 0;
}

static __always_inline int is_digit(char c) { return c >= '0' && c <= '9'; }

// One chunk of an exec's environment: a string starting `PINETRIE_RUN=`
// gives the run. A string longer than a chunk is read on in the next.
static long env_step(u64 i, struct envscan *s) {
  if (s->at >= s->end || s->run) return 1;
  u32 z = 0;
  struct envbuf *buf = bpf_map_lookup_elem(&envbufs, &z);
  if (!buf) return 1;
  long got = bpf_probe_read_user_str(buf->b, ENV_CHUNK, (void *)s->at);
  if (got <= 0) return 1;
  u32 was_inside = s->inside;
  s->inside = got == ENV_CHUNK;
  s->at += s->inside ? ENV_CHUNK - 1 : (u64)got;
  if (was_inside || got < 15) return 0;
  const char want[] = "PINETRIE_RUN=";
  for (int k = 0; k < 13; k++)
    if (buf->b[k] != want[k]) return 0;
  u64 r = 0;
  for (int k = 13; k < 33; k++) {
    char c = buf->b[k];
    if (!is_digit(c)) {
      if (c != 0) r = 0;
      break;
    }
    r = r * 10 + (u64)(c - '0');
  }
  s->run = r;
  return r ? 1 : 0;
}

SEC("raw_tp/sched_process_exec")
int BPF_PROG(on_exec, struct task_struct *p, pid_t old_pid, struct linux_binprm *bprm) {
  u32 tid = BPF_CORE_READ(p, pid);
  // A thread that execs takes its group leader's id: its tag moves with it.
  if ((u32)old_pid != tid) {
    u32 o = (u32)old_pid;
    struct tag *prev = bpf_map_lookup_elem(&tags, &o);
    if (prev) {
      struct tag t = *prev;
      bpf_map_delete_elem(&tags, &o);
      bpf_map_update_elem(&tags, &tid, &t, BPF_ANY);
    }
  }
  // Any exec but the one that begins a run ends the right to signal: only
  // pine·trie's bash, exec'd as the run, and its forks may.
  struct tag *had = bpf_map_lookup_elem(&tags, &tid);
  if (had) {
    had->may_signal = 0;
    return 0;
  }
  u64 pid_namespace = pid_namespace_of(p);
  if (!pid_namespace || !bpf_map_lookup_elem(&registered, &pid_namespace)) return 0;
  struct mm_struct *mm = BPF_CORE_READ(p, mm);
  struct envscan s = {
      .at = BPF_CORE_READ(mm, env_start),
      .end = BPF_CORE_READ(mm, env_end),
  };
  bpf_loop(ENV_STEPS, env_step, &s, 0);
  if (!s.run) return 0;
  struct tag t = {.run = {.lane = pid_namespace, .run = s.run}, .first = 1, .may_signal = 1};
  if (bpf_map_update_elem(&tags, &tid, &t, BPF_NOEXIST)) {
    count_lost(&t.run);
    return 0;
  }
  live_add(&t.run, 1);
  return 0;
}

static __always_inline u32 kind_after_open(struct file *file) {
  if (BPF_CORE_READ(file, f_mode) & FMODE_CREATED_) return PK_MISSING;
  return kind_of(BPF_CORE_READ(file, f_inode));
}

SEC("kprobe/security_file_open")
int BPF_KPROBE(on_open, struct file *file) {
  struct tag *t = current_tag();
  if (!t) return 0;
  struct run_key run = t->run;
  u32 tid = current_tid();
  // The open succeeded as far as its lookup: do_file_open's return need not report it.
  bpf_map_delete_elem(&openings, &tid);
  struct event *e = begin(EV_OPEN, &run);
  if (!e) return 0;
  e->fid = (u64)file;
  e->flags = BPF_CORE_READ(file, f_flags);
  e->before = kind_after_open(file);
  if (e->before != PK_MISSING) stamp(e, BPF_CORE_READ(file, f_inode));
  walk(0, BPF_CORE_READ(file, f_path.dentry), BPF_CORE_READ(file, f_path.mnt));
  if (BPF_CORE_READ(file, f_mode) & FMODE_WRITE_) {
    struct wfile w = {.run = run, .pid = e->pid};
    u64 k = (u64)file;
    if (bpf_map_update_elem(&wfiles, &k, &w, BPF_ANY))
      count_lost(&run);
    else
      live_add(&run, 1);
  }
  send(e);
  return 0;
}

// Every open's lookup, kept until its return: one that finds nothing never
// reaches security_file_open, and is reported there. Before 7.0 the kernel
// names it `do_filp_open`, with the same arguments: the loader attaches this
// and its return to whichever exists.
SEC("kprobe/do_file_open")
int BPF_KPROBE(on_lookup, int dfd, struct filename *name, const struct open_flags *op) {
  if (!current_tag()) return 0;
  u32 tid = current_tid();
  struct opening o = {.name = (u64)name, .dfd = dfd, .flags = BPF_CORE_READ(op, open_flag)};
  if (bpf_map_update_elem(&openings, &tid, &o, BPF_ANY)) {
    struct tag *t = current_tag();
    if (t) count_lost(&t->run);
  }
  return 0;
}

// The file at descriptor `fd` of the current task, or null.
static __always_inline struct file *fd_file(int fd) {
  struct task_struct *t = (struct task_struct *)bpf_get_current_task();
  struct fdtable *fdt = BPF_CORE_READ(t, files, fdt);
  if (!fdt || fd < 0 || (unsigned)fd >= BPF_CORE_READ(fdt, max_fds)) return 0;
  struct file **fds = BPF_CORE_READ(fdt, fd);
  struct file *f = 0;
  bpf_probe_read_kernel(&f, sizeof f, &fds[fd]);
  return f;
}

// A lookup that found nothing: an open of a missing path, named as the call
// named it, joined to its directory's path.
SEC("kretprobe/do_file_open")
int BPF_KRETPROBE(on_lookup_ret, long ret) {
  u32 tid = current_tid();
  struct opening *o = bpf_map_lookup_elem(&openings, &tid);
  if (!o) return 0;
  struct opening op = *o;
  bpf_map_delete_elem(&openings, &tid);
  if (ret != -ENOENT_ && ret != -ENOTDIR_) return 0;
  struct tag *t = current_tag();
  if (!t) return 0;
  struct run_key run = t->run;
  struct event *e = begin(EV_OPEN, &run);
  if (!e) return 0;
  e->flags = (u32)op.flags;
  // Through a local: a field of `opening` inside BPF_CORE_READ would be relocated against the kernel's types.
  struct filename *fn = (struct filename *)op.name;
  const char *name = BPF_CORE_READ(fn, name);
  long got = bpf_probe_read_kernel_str(e->a.buf, NAMEMAX, name);
  if (got <= 1) return 0;
  e->a.len = (u32)got;
  e->a.n = 1;
  if (e->a.buf[0] == '/') {
    e->a.abs = 1;
  } else if (op.dfd == AT_FDCWD_) {
    struct task_struct *task = (struct task_struct *)bpf_get_current_task();
    walk(0, BPF_CORE_READ(task, fs, pwd.dentry), BPF_CORE_READ(task, fs, pwd.mnt));
  } else {
    struct file *dir = fd_file(op.dfd);
    if (!dir) return 0;
    walk(0, BPF_CORE_READ(dir, f_path.dentry), BPF_CORE_READ(dir, f_path.mnt));
  }
  send(e);
  return 0;
}

// The last reference to a written file goes: its stamp now is the version
// the write left. The run and the process are the opener's, whoever lets it go.
SEC("kprobe/__fput")
int BPF_KPROBE(on_fput, struct file *file) {
  u64 k = (u64)file;
  struct wfile *w = bpf_map_lookup_elem(&wfiles, &k);
  if (!w) return 0;
  struct wfile wf = *w;
  bpf_map_delete_elem(&wfiles, &k);
  struct event *e = begin(EV_RELEASE, &wf.run);
  if (!e) return 0;
  e->pid = wf.pid;
  e->fid = k;
  e->flags = BPF_CORE_READ(file, f_flags);
  struct inode *i = BPF_CORE_READ(file, f_inode);
  e->before = kind_of(i);
  stamp(e, i);
  send(e);
  live_done(&wf.run);
  return 0;
}

static __always_inline int path_op(u32 kind, const struct path *dir, struct dentry *d) {
  struct tag *t = current_tag();
  if (!t) return 0;
  struct run_key run = t->run;
  struct event *e = begin(kind, &run);
  if (!e) return 0;
  e->before = kind_of(BPF_CORE_READ(d, d_inode));
  walk_in(&e->a, 0, dir, d);
  send(e);
  return 0;
}

SEC("kprobe/security_path_unlink")
int BPF_KPROBE(on_unlink, const struct path *dir, struct dentry *d) { return path_op(EV_UNLINK, dir, d); }

// A directory's removal is an unlink of it, as unlinkat's AT_REMOVEDIR is.
SEC("kprobe/security_path_rmdir")
int BPF_KPROBE(on_rmdir, const struct path *dir, struct dentry *d) { return path_op(EV_UNLINK, dir, d); }

SEC("kprobe/security_path_mkdir")
int BPF_KPROBE(on_mkdir, const struct path *dir, struct dentry *d) { return path_op(EV_MKDIR, dir, d); }

SEC("kprobe/security_path_symlink")
int BPF_KPROBE(on_symlink, const struct path *dir, struct dentry *d) { return path_op(EV_SYMLINK, dir, d); }

SEC("kprobe/security_path_link")
int BPF_KPROBE(on_link, struct dentry *old, const struct path *new_dir, struct dentry *new_d) {
  struct tag *t = current_tag();
  if (!t) return 0;
  struct run_key run = t->run;
  struct event *e = begin(EV_LINK, &run);
  if (!e) return 0;
  e->before = kind_of(BPF_CORE_READ(old, d_inode));
  e->before2 = kind_of(BPF_CORE_READ(new_d, d_inode));
  walk(0, old, BPF_CORE_READ(new_dir, mnt));
  walk_in(&e->b, 1, new_dir, new_d);
  send(e);
  return 0;
}

SEC("kprobe/security_path_rename")
int BPF_KPROBE(on_rename, const struct path *old_dir, struct dentry *old_d, const struct path *new_dir,
               struct dentry *new_d, unsigned int flags) {
  struct tag *t = current_tag();
  if (!t) return 0;
  struct run_key run = t->run;
  struct event *e = begin(EV_RENAME, &run);
  if (!e) return 0;
  e->flags = flags;
  e->before = kind_of(BPF_CORE_READ(old_d, d_inode));
  e->before2 = kind_of(BPF_CORE_READ(new_d, d_inode));
  walk_in(&e->a, 0, old_dir, old_d);
  walk_in(&e->b, 1, new_dir, new_d);
  send(e);
  return 0;
}

// --- Output by statement. Only pine·trie's bash signals; its first signal
// comes before any statement runs, so the run's pipes are learned from its
// descriptors then, and a run that never signals costs nothing below. Every
// output event is sent while its pipe's mutex is held, so the ring's order
// is the order bytes entered the pipe. The loader attaches these programs
// (`attr_*`) itself, and says which attached: attribution is on only when
// all did.

#define S_IFIFO_ 0010000

// A run's output to its ring; one the ring has no room for is lost output.
static __always_inline void send_output(struct output_event *e) {
  e->ts = bpf_ktime_get_ns();
  if (bpf_ringbuf_output(&output_events, e, sizeof *e, 0)) count_in(&output_lost, &e->run);
}

// The run's descriptors 1 and 2 of the current task, each kept if it is a
// pipe (a FIFO inode). One pipe on both is kept once, as stdout.
static __always_inline void learn_pipes(struct run_key *run) {
  if (bpf_map_lookup_elem(&pipes_by_run, run)) return;
  struct run_pipes rp = {0, 0};
  for (int fd = 1; fd <= 2; fd++) {
    struct file *f = fd_file(fd);
    if (!f || (BPF_CORE_READ(f, f_inode, i_mode) & S_IFMT_) != S_IFIFO_) continue;
    u64 key = (u64)BPF_CORE_READ(f, private_data);
    if (!key || bpf_map_lookup_elem(&pipes, &key)) continue;
    struct pipe_inode_info *pipe = (struct pipe_inode_info *)key;
    struct opipe o = {.run = *run, .fd = (u32)fd, .seen_head = BPF_CORE_READ(pipe, head)};
    if (bpf_map_update_elem(&pipes, &key, &o, BPF_NOEXIST)) {
      count_in(&output_lost, run);
      continue;
    }
    if (fd == 1)
      rp.out = key;
    else
      rp.err = key;
  }
  if (bpf_map_update_elem(&pipes_by_run, run, &rp, BPF_NOEXIST)) count_in(&output_lost, run);
}

// prctl's first act is this LSM hook, for every option, known or not.
SEC("kprobe/security_task_prctl")
int BPF_KPROBE(attr_signal, int option, unsigned long arg2, unsigned long arg3) {
  if (option != STATEMENT_SIGNAL) return 0;
  struct tag *t = current_tag();
  if (!t) return 0;
  struct run_key run = t->run;
  if (!t->may_signal || arg2 == 0 || arg2 > 0xffffffffUL) {
    count_in(&refusals, &run);
    return 0;
  }
  t->statement = (u32)arg2;
  t->line = (u32)arg3;
  learn_pipes(&run);
  struct output_event e = {.kind = OE_STATEMENT, .run = run, .statement = (u32)arg2, .line = (u32)arg3};
  send_output(&e);
  return 0;
}

// `n` bytes of pipe `o`, written by the current task: its statement, if it
// is of the pipe's run.
static __always_inline void send_bytes(struct opipe *o, u64 n) {
  if (!n) return;
  struct output_event e = {.kind = OE_OUTPUT, .fd = o->fd, .run = o->run, .n = n};
  struct tag *t = current_tag();
  if (t && t->run.lane == o->run.lane && t->run.run == o->run.run) e.statement = t->statement;
  send_output(&e);
}

// Slot `i` of a pipe's ring: by the running kernel's stride, never
// `kernel.h`'s, which declares only the fields read.
static __always_inline struct pipe_buffer *pipe_slot(struct pipe_buffer *bufs, u32 i) {
  return (struct pipe_buffer *)((char *)bufs + (u64)i * bpf_core_type_size(struct pipe_buffer));
}

struct sum_ctx {
  struct pipe_buffer *bufs;
  u32 mask;
  u32 from;
  u64 sum;
};

static long add_len(u64 i, struct sum_ctx *c) {
  struct pipe_buffer *slot = pipe_slot(c->bufs, (c->from + (u32)i) & c->mask);
  c->sum += BPF_CORE_READ(slot, len);
  return 0;
}

// The buffers between the accounted head and the real one: the current
// task's, or, where a write is about to copy (`orphan`), buffers no hook
// saw added, lost. A head behind the accounted one is lost too (a copy
// that faulted and was dropped). Called only with the pipe's mutex held.
static __always_inline void account(struct pipe_inode_info *pipe, struct opipe *o, int orphan) {
  u32 head = BPF_CORE_READ(pipe, head);
  s32 n = (s32)(head - o->seen_head);
  if (n < 0) {
    o->seen_head = head;
    count_in(&output_lost, &o->run);
    return;
  }
  if (n == 0) return;
  struct sum_ctx c = {
      .bufs = BPF_CORE_READ(pipe, bufs),
      .mask = BPF_CORE_READ(pipe, ring_size) - 1,
      .from = o->seen_head,
  };
  bpf_loop((u32)n, add_len, &c, 0);
  o->seen_head = head;
  if (!c.sum) return;
  if (orphan)
    count_in(&output_lost, &o->run);
  else
    send_bytes(o, c.sum);
}

// Before 6.15 the kernel names it `pipe_write`: the loader attaches this to
// whichever exists, and reports it by this name.
SEC("kprobe/anon_pipe_write")
int BPF_KPROBE(attr_pipe_write, struct kiocb *iocb, struct iov_iter *from) {
  struct file *f = BPF_CORE_READ(iocb, ki_filp);
  u64 key = (u64)BPF_CORE_READ(f, private_data);
  if (!bpf_map_lookup_elem(&pipes, &key)) return 0;
  s64 count = (s64)BPF_CORE_READ(from, count);
  if (count <= 0) return 0;
  u32 tid = current_tid();
  struct inflight w = {.iter = (u64)from, .pipe = key, .remaining = count};
  if (bpf_map_update_elem(&writing, &tid, &w, BPF_ANY)) {
    struct opipe *o = bpf_map_lookup_elem(&pipes, &key);
    if (o) count_in(&output_lost, &o->run);
  }
  return 0;
}

// Each page a write copies in, inside the pipe's mutex. Entry probes only,
// so no kretprobe instance limit applies to a writer that sleeps.
SEC("kprobe/copy_page_from_iter")
int BPF_KPROBE(attr_copy, struct page *page, unsigned long offset, unsigned long bytes, struct iov_iter *i) {
  u32 tid = current_tid();
  struct inflight *w = bpf_map_lookup_elem(&writing, &tid);
  if (!w || w->iter != (u64)i) return 0;
  u64 key = w->pipe;
  struct opipe *o = bpf_map_lookup_elem(&pipes, &key);
  if (!o) {
    bpf_map_delete_elem(&writing, &tid);
    return 0;
  }
  u64 count = BPF_CORE_READ(i, count);
  // Not where the last copy left it: an earlier copy came up short, or the
  // write it was noted for ended early. What landed is not known.
  if ((s64)count != w->remaining) {
    count_in(&output_lost, &o->run);
    bpf_map_delete_elem(&writing, &tid);
    return 0;
  }
  struct pipe_inode_info *pipe = (struct pipe_inode_info *)key;
  account(pipe, o, 1);
  u64 n = bytes < count ? bytes : count;
  send_bytes(o, n);
  // The copy fills the last buffer (a merge), or a new one, which some
  // kernels make the head before the copy and others after it: whether its
  // page is the last buffer's says which. Only while the pipe holds a
  // buffer: an emptied slot keeps its old page, which a new write may reuse.
  u32 head = BPF_CORE_READ(pipe, head);
  u32 tail = BPF_CORE_READ(pipe, tail);
  struct pipe_buffer *bufs = BPF_CORE_READ(pipe, bufs);
  u32 mask = BPF_CORE_READ(pipe, ring_size) - 1;
  struct page *last = 0;
  if (head != tail) last = BPF_CORE_READ(pipe_slot(bufs, (head - 1) & mask), page);
  o->seen_head = last == page ? head : head + 1;
  w->remaining -= (s64)n;
  if (w->remaining <= 0) bpf_map_delete_elem(&writing, &tid);
  return 0;
}

// Every other route (splice, sendfile, vmsplice, tee) adds whole buffers
// under the pipe's lock and lets go of it here.
static __always_inline int unlocking(struct pipe_inode_info *pipe) {
  u64 key = (u64)pipe;
  struct opipe *o = bpf_map_lookup_elem(&pipes, &key);
  if (o) account(pipe, o, 0);
  return 0;
}

SEC("kprobe/pipe_unlock")
int BPF_KPROBE(attr_pipe_unlock, struct pipe_inode_info *pipe) { return unlocking(pipe); }

SEC("kprobe/pipe_wait_writable")
int BPF_KPROBE(attr_wait_writable, struct pipe_inode_info *pipe) { return unlocking(pipe); }

// A pipe freed: its address can be another pipe's next.
SEC("kprobe/free_pipe_info")
int BPF_KPROBE(attr_free_pipe, struct pipe_inode_info *pipe) {
  u64 key = (u64)pipe;
  bpf_map_delete_elem(&pipes, &key);
  return 0;
}
