// S283's kernel side. Every event is sent while the watched pipe's mutex is
// held, so the ring's order is the order bytes entered the pipe.
//
// - A task's step is its parent's at birth (task_newtask), and the driver sets
//   its own as it feeds each step. An untagged parent clears a reused tid.
// - anon_pipe_write (write, writev, io_uring): each copy_page_from_iter of
//   that write's iov_iter, counted at entry, inside the mutex.
// - Built with NAIVE, a write is counted whole at anon_pipe_write's entry,
//   before the mutex; with NOCLEAN, a tid's step outlives its task. Each is
//   a control the driver's check must catch.
// - Every other route (splice, sendfile, vmsplice, tee, splice from a pipe)
//   adds buffers under pipe_lock and drops it through pipe_unlock or
//   pipe_wait_writable: the buffers between the accounted head and the real
//   one are the holder's.
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
  __type(value, u32);
} steps SEC(".maps");

struct {
  __uint(type, BPF_MAP_TYPE_ARRAY);
  __uint(max_entries, 1);
  __type(key, u32);
  __type(value, struct cfg);
} cfgs SEC(".maps");

struct inflight {
  u64 iter;
  s64 remaining;
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

static __always_inline struct cfg *watched(void) {
  u32 k = 0;
  return bpf_map_lookup_elem(&cfgs, &k);
}

static __always_inline u32 tid_now(void) { return (u32)bpf_get_current_pid_tgid(); }

static __always_inline u32 step_now(void) {
  u32 tid = tid_now();
  u32 *s = bpf_map_lookup_elem(&steps, &tid);
  return s ? *s : 0;
}

static __always_inline void emit(u32 len, u32 route) {
  if (len == 0) return;
  struct ev *e = bpf_ringbuf_reserve(&events, sizeof *e, 0);
  if (!e) {
    u32 k = 0;
    u64 *d = bpf_map_lookup_elem(&dropped, &k);
    if (d) __sync_fetch_and_add(d, 1);
    return;
  }
  e->step = step_now();
  e->tid = tid_now();
  e->len = len;
  e->route = route;
  bpf_ringbuf_submit(e, 0);
}

SEC("raw_tp/task_newtask")
int BPF_PROG(on_newtask, struct task_struct *child, u64 clone_flags) {
  u32 ctid = BPF_CORE_READ(child, pid);
  u32 ptid = tid_now();
  u32 *s = bpf_map_lookup_elem(&steps, &ptid);
  if (s) {
    u32 v = *s;
    bpf_map_update_elem(&steps, &ctid, &v, BPF_ANY);
  } else {
#ifndef NOCLEAN
    bpf_map_delete_elem(&steps, &ctid);
#endif
  }
  return 0;
}

SEC("raw_tp/sched_process_exit")
int BPF_PROG(on_exit, struct task_struct *p) {
  u32 tid = BPF_CORE_READ(p, pid);
#ifndef NOCLEAN
  bpf_map_delete_elem(&steps, &tid);
#endif
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
static __always_inline void flush(struct pipe_inode_info *pipe, struct cfg *c, u32 route) {
  u32 head = BPF_CORE_READ(pipe, head);
  s32 n = (s32)(head - c->seen_head);
  if (n < 0) {
    emit((u32)-n, ROUTE_LOST);
    c->seen_head = head;
    return;
  }
  if (n == 0) return;
  struct flush_ctx fc = {
      .bufs = BPF_CORE_READ(pipe, bufs),
      .mask = BPF_CORE_READ(pipe, ring_size) - 1,
      .from = c->seen_head,
  };
  bpf_loop(n, add_len, &fc, 0);
  c->seen_head = head;
  emit((u32)fc.sum, route);
}

SEC("kprobe/anon_pipe_write")
int BPF_KPROBE(on_pipe_write, struct kiocb *iocb, struct iov_iter *from) {
  struct cfg *c = watched();
  if (!c || !c->ino) return 0;
  struct file *f = BPF_CORE_READ(iocb, ki_filp);
  if (BPF_CORE_READ(f, f_inode, i_ino) != c->ino) return 0;
  struct pipe_inode_info *pipe = BPF_CORE_READ(f, private_data);
  if (!c->pipe) {
    // Learned before the mutex is taken: only the first write ever sets it.
    c->pipe = (u64)pipe;
    c->seen_head = BPF_CORE_READ(pipe, head);
  }
#ifdef NAIVE
  // The control: the whole write, counted before the mutex is taken.
  emit((u32)BPF_CORE_READ(from, count), ROUTE_WRITE);
  return 0;
#endif
  u32 tid = tid_now();
  struct inflight w = {.iter = (u64)from, .remaining = (s64)BPF_CORE_READ(from, count)};
  bpf_map_update_elem(&writing, &tid, &w, BPF_ANY);
  return 0;
}

SEC("kprobe/copy_page_from_iter")
int BPF_KPROBE(on_copy, struct page *page, size_t offset, size_t bytes, struct iov_iter *i) {
  u32 tid = tid_now();
  struct inflight *w = bpf_map_lookup_elem(&writing, &tid);
  if (!w || w->iter != (u64)i) return 0;
  struct cfg *c = watched();
  if (!c || !c->pipe) return 0;
  struct pipe_inode_info *pipe = (struct pipe_inode_info *)c->pipe;
  // Anything unaccounted here would be a route this probe misses.
  flush(pipe, c, ROUTE_ORPHAN);
  u64 count = BPF_CORE_READ(i, count);
  u64 n = bytes < count ? bytes : count;
  emit((u32)n, ROUTE_WRITE);
  // The merge path copies into the last buffer at a nonzero offset; the
  // loop's copy fills a new page that becomes the head right after.
  if (offset == 0) c->seen_head = BPF_CORE_READ(pipe, head) + 1;
  w->remaining -= (s64)n;
  if (w->remaining <= 0) bpf_map_delete_elem(&writing, &tid);
  return 0;
}

static __always_inline int on_unlocking(struct pipe_inode_info *pipe) {
  struct cfg *c = watched();
  if (!c || c->pipe != (u64)pipe) return 0;
  flush(pipe, c, ROUTE_LOCKED);
  return 0;
}

SEC("kprobe/pipe_unlock")
int BPF_KPROBE(on_pipe_unlock, struct pipe_inode_info *pipe) { return on_unlocking(pipe); }

SEC("kprobe/pipe_wait_writable")
int BPF_KPROBE(on_wait_writable, struct pipe_inode_info *pipe) { return on_unlocking(pipe); }
