// S304's kernel side: S298's, with a run's output pipes learned from the
// shell's descriptors 1 and 2 at its exec, each attributed in its own order.
// S298's kernel side: S283's attribution, tagged by the patched bash's
// signals. A signal is a prctl with an option no kernel implements; it is
// taken only from a task allowed to signal: the registered shell from its
// exec of bash, and what it forks, until any of them execs again. Every task
// inherits its parent's tag at birth, and keeps it across exec.
#include "vmlinux.h"
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include "attr.h"

char LICENSE[] SEC("license") = "GPL";

struct {
  __uint(type, BPF_MAP_TYPE_RINGBUF);
  __uint(max_entries, 32 << 20);
} events SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 16);
  __type(key, u32);
  __type(value, struct sigtag);
} tags SEC(".maps");

// Tasks allowed to signal, and the one tid whose next exec makes it the shell.
struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 16);
  __type(key, u32);
  __type(value, u8);
} may_signal SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 16);
  __type(key, u32);
  __type(value, u8);
} pending SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 12);
  __type(key, u64);  // struct pipe_inode_info *
  __type(value, struct output);
} outputs SEC(".maps");

struct inflight {
  u64 iter;
  s64 remaining;
  u64 pipe;
};

struct {
  __uint(type, BPF_MAP_TYPE_HASH);
  __uint(max_entries, 1 << 16);
  __type(key, u32);
  __type(value, struct inflight);
} writing SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_ARRAY);
  __uint(max_entries, 1);
  __type(key, u32);
  __type(value, u64);
} dropped SEC(".maps");


static __always_inline u32 tid_now(void) { return (u32)bpf_get_current_pid_tgid(); }

static __always_inline struct sigtag tag_now(void) {
  u32 tid = tid_now();
  struct sigtag *t = bpf_map_lookup_elem(&tags, &tid);
  struct sigtag none = {0, 0};
  return t ? *t : none;
}

static __always_inline void emit(u32 len, u32 route, u32 fd) {
  if (len == 0) return;
  struct ev *e = bpf_ringbuf_reserve(&events, sizeof *e, 0);
  if (!e) {
    u32 k = 0;
    u64 *d = bpf_map_lookup_elem(&dropped, &k);
    if (d) __sync_fetch_and_add(d, 1);
    return;
  }
  e->tag = tag_now();
  e->writer = tid_now();
  e->len = len;
  e->route = route;
  e->fd = fd;
  bpf_ringbuf_submit(e, 0);
}

SEC("raw_tp/task_newtask")
int BPF_PROG(on_newtask, struct task_struct *child, u64 clone_flags) {
  u32 ctid = BPF_CORE_READ(child, pid);
  u32 ptid = tid_now();
  struct sigtag *t = bpf_map_lookup_elem(&tags, &ptid);
  if (t) {
    struct sigtag v = *t;
    bpf_map_update_elem(&tags, &ctid, &v, BPF_ANY);
  } else {
    bpf_map_delete_elem(&tags, &ctid);
  }
  u8 one = 1;
  if (bpf_map_lookup_elem(&may_signal, &ptid))
    bpf_map_update_elem(&may_signal, &ctid, &one, BPF_ANY);
  else
    bpf_map_delete_elem(&may_signal, &ctid);
  return 0;
}

SEC("raw_tp/sched_process_exit")
int BPF_PROG(on_exit, struct task_struct *p) {
  u32 tid = BPF_CORE_READ(p, pid);
  bpf_map_delete_elem(&tags, &tid);
  bpf_map_delete_elem(&may_signal, &tid);
  bpf_map_delete_elem(&writing, &tid);
  return 0;
}

struct flush_ctx {
  struct pipe_buffer *bufs;
  u32 mask;
  u32 from;
  u64 sum;
};

static long add_len(u64 i, struct flush_ctx *c) {
  u32 len = 0;
  bpf_probe_read_kernel(&len, sizeof len, &c->bufs[(c->from + (u32)i) & c->mask].len);
  c->sum += len;
  return 0;
}

// Attributes the buffers between the accounted head and the real one to the
// current task. Called only with the pipe's mutex held.
static __always_inline void flush(struct pipe_inode_info *pipe, struct output *o, u32 route) {
  u32 head = BPF_CORE_READ(pipe, head);
  s32 n = (s32)(head - o->seen_head);
  if (n < 0) {
    emit((u32)-n, ROUTE_LOST, o->fd);
    o->seen_head = head;
    return;
  }
  if (n == 0) return;
  struct flush_ctx fc = {
      .bufs = BPF_CORE_READ(pipe, bufs),
      .mask = BPF_CORE_READ(pipe, ring_size) - 1,
      .from = o->seen_head,
  };
  bpf_loop(n, add_len, &fc, 0);
  o->seen_head = head;
  emit((u32)fc.sum, route, o->fd);
}

SEC("kprobe/anon_pipe_write")
int BPF_KPROBE(on_pipe_write, struct kiocb *iocb, struct iov_iter *from) {
  struct file *f = BPF_CORE_READ(iocb, ki_filp);
  u64 pipe = (u64)BPF_CORE_READ(f, private_data);
  if (!bpf_map_lookup_elem(&outputs, &pipe)) return 0;
  u32 tid = tid_now();
  struct inflight w = {.iter = (u64)from, .remaining = (s64)BPF_CORE_READ(from, count), .pipe = pipe};
  bpf_map_update_elem(&writing, &tid, &w, BPF_ANY);
  return 0;
}

SEC("kprobe/copy_page_from_iter")
int BPF_KPROBE(on_copy, struct page *page, size_t offset, size_t bytes, struct iov_iter *i) {
  u32 tid = tid_now();
  struct inflight *w = bpf_map_lookup_elem(&writing, &tid);
  if (!w || w->iter != (u64)i) return 0;
  u64 key = w->pipe;
  struct output *o = bpf_map_lookup_elem(&outputs, &key);
  if (!o) return 0;
  struct pipe_inode_info *pipe = (struct pipe_inode_info *)key;
  // Anything unaccounted here would be a route this probe misses.
  flush(pipe, o, ROUTE_ORPHAN);
  u64 count = BPF_CORE_READ(i, count);
  u64 n = bytes < count ? bytes : count;
  emit((u32)n, ROUTE_WRITE, o->fd);
  // The merge path copies into the last buffer at a nonzero offset; the
  // loop's copy fills a new page that becomes the head right after.
  if (offset == 0) o->seen_head = BPF_CORE_READ(pipe, head) + 1;
  w->remaining -= (s64)n;
  if (w->remaining <= 0) bpf_map_delete_elem(&writing, &tid);
  return 0;
}

static __always_inline int on_unlocking(struct pipe_inode_info *pipe) {
  u64 key = (u64)pipe;
  struct output *o = bpf_map_lookup_elem(&outputs, &key);
  if (!o) return 0;
  flush(pipe, o, ROUTE_LOCKED);
  return 0;
}

SEC("kprobe/pipe_unlock")
int BPF_KPROBE(on_pipe_unlock, struct pipe_inode_info *pipe) { return on_unlocking(pipe); }

SEC("kprobe/pipe_wait_writable")
int BPF_KPROBE(on_wait_writable, struct pipe_inode_info *pipe) { return on_unlocking(pipe); }

// The run's output pipes: the shell's descriptors 1 and 2 at its exec, each
// kept if it is a pipe (a FIFO inode: i_pipe shares a union, so its being
// set says nothing). One pipe on both is kept once, as 3.
#define S_IFMT_ 0170000
#define S_IFIFO_ 0010000
static __always_inline void learn_outputs(struct task_struct *p) {
  struct file **fds = BPF_CORE_READ(p, files, fdt, fd);
  for (u32 fd = 1; fd <= 2; fd++) {
    struct file *f = 0;
    if (bpf_probe_read_kernel(&f, sizeof f, &fds[fd]) || !f) continue;
    if ((BPF_CORE_READ(f, f_inode, i_mode) & S_IFMT_) != S_IFIFO_) continue;
    u64 key = (u64)BPF_CORE_READ(f, private_data);
    struct output *had = bpf_map_lookup_elem(&outputs, &key);
    if (had) {
      had->fd = 3;
      continue;
    }
    struct pipe_inode_info *pipe = (struct pipe_inode_info *)key;
    struct output o = {.fd = fd, .seen_head = BPF_CORE_READ(pipe, head)};
    bpf_map_update_elem(&outputs, &key, &o, BPF_ANY);
  }
}

// An exec ends the right to signal, except the registered shell's own exec
// of bash, which begins it. The tag is kept: a program bash execs without
// forking writes for the statement that ran it.
SEC("raw_tp/sched_process_exec")
int BPF_PROG(on_exec, struct task_struct *p) {
  u32 tid = BPF_CORE_READ(p, pid);
  u8 one = 1;
  if (bpf_map_lookup_elem(&pending, &tid)) {
    bpf_map_delete_elem(&pending, &tid);
    bpf_map_update_elem(&may_signal, &tid, &one, BPF_ANY);
    learn_outputs(p);
  } else {
    bpf_map_delete_elem(&may_signal, &tid);
  }
  return 0;
}

static __always_inline void emit_tag(struct sigtag t, u32 route) {
  struct ev *e = bpf_ringbuf_reserve(&events, sizeof *e, 0);
  if (!e) return;
  e->tag = t;
  e->writer = tid_now();
  e->len = 0;
  e->route = route;
  e->fd = 0;
  bpf_ringbuf_submit(e, 0);
}

// prctl's first act is this LSM hook, for every option, known or not.
SEC("kprobe/security_task_prctl")
int BPF_KPROBE(on_prctl, int option, unsigned long arg2, unsigned long arg3) {
  if (option != PT_PRCTL) return 0;
  u32 tid = tid_now();
  struct sigtag t = {.stmt = (u32)arg2, .line = (u32)arg3};
  if (!bpf_map_lookup_elem(&may_signal, &tid)) {
    emit_tag(t, ROUTE_REFUSED);
    return 0;
  }
  bpf_map_update_elem(&tags, &tid, &t, BPF_ANY);
  emit_tag(t, ROUTE_SIGNAL);
  return 0;
}

