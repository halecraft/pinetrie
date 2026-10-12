// S172: an eBPF observer of a lane's file calls, which stops nothing.
// Disposable.
//
// A run begins when a process execs a file named `s172-run`, whose argv[1]
// is the run's number: that process is tagged with it, and every task it
// forks or clones inherits the tag, as a seccomp filter is inherited. Each
// tagged task's opens, path changes and file releases are sent through one
// ring buffer; an event the ring has no room for is counted, per run and in
// total, never dropped silently. A run's live tasks are counted, and its
// "end" is sent when the last one exits, daemons included.
//
// The VM's kernel has no FUNCTION_TRACER, so no fentry and no BPF LSM:
// kprobes and raw tracepoints only.
#include "vmlinux.h"
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

char LICENSE[] SEC("license") = "GPL";

#define MAXC 64
#define PATHMAX 4096
#define NAMEMAX 256
#define FMODE_WRITE_ 0x2

enum kind { K_START = 1, K_OPEN, K_RELEASE, K_UNLINK, K_RMDIR, K_MKDIR, K_RENAME, K_SYMLINK, K_LINK, K_TRUNCATE, K_END };

struct pathbuf {
  u32 n;      // components, leaf first, each ending in a NUL
  u32 cut;    // 1 if the path was cut short
  u32 len;    // bytes of buf used
  u32 pad;
  char buf[PATHMAX + NAMEMAX];
};

struct event {
  u32 kind;
  u32 pid;
  u64 run;
  u64 cgroup;
  u64 fid;     // the struct file, joining an open to its release
  u64 dev;
  u64 ino;
  s64 size;
  s64 ctime_sec;
  u32 ctime_nsec;
  u32 flags;   // open: f_flags; rename: flags
  u32 fmode;
  u32 mnt_id;
  u32 pad2;
  u64 ts;      // bpf_ktime_get_ns, CLOCK_MONOTONIC's
  struct pathbuf a;
  struct pathbuf b;   // rename's and link's target; a symlink's target text
};

struct {
  __uint(type, BPF_MAP_TYPE_RINGBUF);
  __uint(max_entries, 64 << 20);
} events SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 16);
  __type(key, u32);    // tid
  __type(value, u64);  // run
} tags SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 4096);
  __type(key, u64);    // run
  __type(value, s64);  // live tasks
} live SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 4096);
  __type(key, u64);    // run
  __type(value, u64);  // events lost
} lost_by_run SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_ARRAY);
  __uint(max_entries, 1);
  __type(key, u32);
  __type(value, u64);
} lost SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
  __uint(max_entries, 1);
  __type(key, u32);
  __type(value, struct event);
} scratch SEC(".maps");

struct wfile {
  u64 run;
};

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 16);
  __type(key, u64);    // struct file *
  __type(value, struct wfile);
} wfiles SEC(".maps");

static __always_inline void count_lost(u64 run) {
  u32 z = 0;
  u64 *t = bpf_map_lookup_elem(&lost, &z);
  if (t) __sync_fetch_and_add(t, 1);
  u64 *r = bpf_map_lookup_elem(&lost_by_run, &run);
  if (r) {
    __sync_fetch_and_add(r, 1);
  } else {
    u64 one = 1;
    bpf_map_update_elem(&lost_by_run, &run, &one, BPF_NOEXIST);
  }
}

static __always_inline void live_add(u64 run, s64 d) {
  s64 *n = bpf_map_lookup_elem(&live, &run);
  if (n) {
    __sync_fetch_and_add(n, d);
  } else if (d > 0) {
    bpf_map_update_elem(&live, &run, &d, BPF_NOEXIST);
  }
}

static __always_inline u64 *current_run(void) {
  u32 tid = (u32)bpf_get_current_pid_tgid();
  return bpf_map_lookup_elem(&tags, &tid);
}

// An event is built in this CPU's scratch, then copied to the ring by
// send(), trimmed to its paths' depth.
static __always_inline struct event *begin(u32 kind, u64 run) {
  u32 z = 0;
  struct event *e = bpf_map_lookup_elem(&scratch, &z);
  if (!e) return 0;
  e->kind = kind;
  e->pid = (u32)bpf_get_current_pid_tgid();
  e->run = run;
  e->cgroup = bpf_get_current_cgroup_id();
  e->fid = 0;
  e->dev = 0;
  e->ino = 0;
  e->size = -1;
  e->ctime_sec = 0;
  e->ctime_nsec = 0;
  e->flags = 0;
  e->fmode = 0;
  e->mnt_id = 0;
  e->ts = bpf_ktime_get_ns();
  e->a.n = 0;
  e->a.cut = 0;
  e->a.len = 0;
  e->b.n = 0;
  e->b.cut = 0;
  e->b.len = 0;
  return e;
}

static __always_inline void send(struct event *e) {
  long err;
  if (e->b.n) {
    err = bpf_ringbuf_output(&events, e, sizeof(struct event), 0);
  } else {
    u64 size = offsetof(struct event, a) + offsetof(struct pathbuf, buf) + (u64)e->a.len;
    if (size > offsetof(struct event, b)) size = offsetof(struct event, b);
    err = bpf_ringbuf_output(&events, e, size, 0);
  }
  if (err) count_lost(e->run);
}

static __always_inline void stamp(struct event *e, struct inode *i) {
  if (!i) return;
  e->ino = BPF_CORE_READ(i, i_ino);
  e->dev = BPF_CORE_READ(i, i_sb, s_dev);
  e->size = BPF_CORE_READ(i, i_size);
  e->ctime_sec = BPF_CORE_READ(i, i_ctime_sec);
  e->ctime_nsec = BPF_CORE_READ(i, i_ctime_nsec);
}

struct walkctx {
  u64 d, m, mnt, root_d, root_m;
  u32 which, done;
};

// One step up a path: a component, or a mount crossed. bpf_loop checks this
// once, where an inline loop's branches multiplied past the verifier's limit.
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
// mount to the task's root, leaf first, after what p holds already.
static __always_inline void walk(u32 which, struct dentry *d, struct vfsmount *m) {
  struct task_struct *t = (struct task_struct *)bpf_get_current_task();
  struct walkctx c = {
      .d = (u64)d,
      .m = (u64)m,
      .mnt = (u64)m - bpf_core_field_offset(struct mount, mnt),
      .root_d = (u64)BPF_CORE_READ(t, fs, root.dentry),
      .root_m = (u64)BPF_CORE_READ(t, fs, root.mnt),
      .which = which,
      .done = 0,
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
  u64 *run = current_run();
  if (!run) return 0;
  u64 r = *run;
  u32 ctid = BPF_CORE_READ(child, pid);
  bpf_map_update_elem(&tags, &ctid, &r, BPF_ANY);
  live_add(r, 1);
  return 0;
}

SEC("raw_tp/sched_process_exit")
int BPF_PROG(on_exit, struct task_struct *p) {
  u32 tid = BPF_CORE_READ(p, pid);
  u64 *run = bpf_map_lookup_elem(&tags, &tid);
  if (!run) return 0;
  u64 r = *run;
  bpf_map_delete_elem(&tags, &tid);
  s64 *n = bpf_map_lookup_elem(&live, &r);
  if (n && __sync_fetch_and_add(n, -1) == 1) {
    bpf_map_delete_elem(&live, &r);
    struct event *e = begin(K_END, r);
    if (e) send(e);
  }
  return 0;
}

SEC("raw_tp/sched_process_exec")
int BPF_PROG(on_exec, struct task_struct *p, pid_t old_pid, struct linux_binprm *bprm) {
  u32 tid = BPF_CORE_READ(p, pid);
  // A thread that execs takes its group leader's id: carry its tag over.
  if ((u32)old_pid != tid) {
    u32 o = (u32)old_pid;
    u64 *prev = bpf_map_lookup_elem(&tags, &o);
    if (prev) {
      u64 r = *prev;
      bpf_map_update_elem(&tags, &tid, &r, BPF_ANY);
      bpf_map_delete_elem(&tags, &o);
    }
  }
  char fn[64] = {};
  const char *f = BPF_CORE_READ(bprm, filename);
  long len = bpf_probe_read_kernel_str(fn, sizeof fn, f);
  if (len < 9 || len > 64) return 0;
  // Ends in "s172-run" (len counts the NUL).
  const char want[] = "s172-run";
  long at = len - 1 - 8;
  if (at < 0 || at > 55) return 0;
  for (int i = 0; i < 8; i++) {
    if (fn[(at + i) & 63] != want[i]) return 0;
  }
  if (at > 0 && fn[(at - 1) & 63] != '/') return 0;
  struct mm_struct *mm = BPF_CORE_READ(p, mm);
  unsigned long a = BPF_CORE_READ(mm, arg_start);
  char arg[32] = {};
  long l0 = bpf_probe_read_user_str(arg, sizeof arg, (void *)a);
  if (l0 <= 0) return 0;
  long l1 = bpf_probe_read_user_str(arg, sizeof arg, (void *)(a + l0));
  if (l1 <= 1) return 0;
  u64 r = 0;
  for (int i = 0; i < 20; i++) {
    char c = arg[i];
    if (c < '0' || c > '9') break;
    r = r * 10 + (u64)(c - '0');
  }
  if (r == 0) return 0;
  u64 *had = bpf_map_lookup_elem(&tags, &tid);
  if (had) {
    if (*had == r) return 0;
    live_add(*had, -1);
  }
  bpf_map_update_elem(&tags, &tid, &r, BPF_ANY);
  live_add(r, 1);
  struct event *e = begin(K_START, r);
  if (e) send(e);
  return 0;
}

SEC("kprobe/security_file_open")
int BPF_KPROBE(on_open, struct file *file) {
  u64 *run = current_run();
  if (!run) return 0;
  u64 r = *run;
  struct event *e = begin(K_OPEN, r);
  if (!e) return 0;
  e->fid = (u64)file;
  e->flags = BPF_CORE_READ(file, f_flags);
  e->fmode = BPF_CORE_READ(file, f_mode);
  struct vfsmount *m = BPF_CORE_READ(file, f_path.mnt);
  e->mnt_id = BPF_CORE_READ((struct mount *)((u64)m - bpf_core_field_offset(struct mount, mnt)), mnt_id);
  stamp(e, BPF_CORE_READ(file, f_inode));
  walk(0, BPF_CORE_READ(file, f_path.dentry), m);
  if (e->fmode & FMODE_WRITE_) {
    struct wfile w = {.run = r};
    u64 k = (u64)file;
    bpf_map_update_elem(&wfiles, &k, &w, BPF_ANY);
  }
  send(e);
  return 0;
}

// The last reference to a written file goes: its stamp now is the version
// the write left. The run is the opener's, whoever lets it go.
SEC("kprobe/__fput")
int BPF_KPROBE(on_fput, struct file *file) {
  u64 k = (u64)file;
  struct wfile *w = bpf_map_lookup_elem(&wfiles, &k);
  if (!w) return 0;
  u64 r = w->run;
  bpf_map_delete_elem(&wfiles, &k);
  struct event *e = begin(K_RELEASE, r);
  if (!e) return 0;
  e->fid = k;
  stamp(e, BPF_CORE_READ(file, f_inode));
  send(e);
  return 0;
}

static __always_inline int path_op(u32 kind, const struct path *dir, struct dentry *d) {
  u64 *run = current_run();
  if (!run) return 0;
  struct event *e = begin(kind, *run);
  if (!e) return 0;
  walk_in(&e->a, 0, dir, d);
  send(e);
  return 0;
}

SEC("kprobe/security_path_unlink")
int BPF_KPROBE(on_unlink, const struct path *dir, struct dentry *d) { return path_op(K_UNLINK, dir, d); }

SEC("kprobe/security_path_rmdir")
int BPF_KPROBE(on_rmdir, const struct path *dir, struct dentry *d) { return path_op(K_RMDIR, dir, d); }

SEC("kprobe/security_path_mkdir")
int BPF_KPROBE(on_mkdir, const struct path *dir, struct dentry *d) { return path_op(K_MKDIR, dir, d); }

SEC("kprobe/security_path_symlink")
int BPF_KPROBE(on_symlink, const struct path *dir, struct dentry *d, const char *target) {
  u64 *run = current_run();
  if (!run) return 0;
  struct event *e = begin(K_SYMLINK, *run);
  if (!e) return 0;
  walk_in(&e->a, 0, dir, d);
  long got = bpf_probe_read_kernel_str(e->b.buf, PATHMAX, target);
  if (got > 0) {
    e->b.n = 1;
    e->b.len = (u32)got;
  }
  send(e);
  return 0;
}

SEC("kprobe/security_path_link")
int BPF_KPROBE(on_link, struct dentry *old, const struct path *new_dir, struct dentry *new_d) {
  u64 *run = current_run();
  if (!run) return 0;
  struct event *e = begin(K_LINK, *run);
  if (!e) return 0;
  walk(0, old, BPF_CORE_READ(new_dir, mnt));
  walk_in(&e->b, 1, new_dir, new_d);
  send(e);
  return 0;
}

SEC("kprobe/security_path_rename")
int BPF_KPROBE(on_rename, const struct path *old_dir, struct dentry *old_d, const struct path *new_dir,
               struct dentry *new_d, unsigned int flags) {
  u64 *run = current_run();
  if (!run) return 0;
  struct event *e = begin(K_RENAME, *run);
  if (!e) return 0;
  e->flags = flags;
  walk_in(&e->a, 0, old_dir, old_d);
  walk_in(&e->b, 1, new_dir, new_d);
  send(e);
  return 0;
}

SEC("kprobe/security_path_truncate")
int BPF_KPROBE(on_truncate, const struct path *p) {
  u64 *run = current_run();
  if (!run) return 0;
  struct event *e = begin(K_TRUNCATE, *run);
  if (!e) return 0;
  walk(0, BPF_CORE_READ(p, dentry), BPF_CORE_READ(p, mnt));
  send(e);
  return 0;
}
