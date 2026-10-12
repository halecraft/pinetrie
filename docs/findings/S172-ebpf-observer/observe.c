// S172: loads observe.bpf.c and prints its events, one TSV line each.
// Disposable.
//   observe [ring MiB]
// Prints "#ready" once every program is attached, and on SIGTERM or SIGINT
// drains the ring, then prints "#lost total <n>" and "#lost run <run> <n>".
// Columns: kind run pid cgroup fid dev ino stamp flags fmode mnt cut path path2 ustamp lag
// where stamp is <size>:<ctime ns>, as the host's stamps are, read in the
// kernel. A release's ustamp is the same file's lstat() here, through the
// releasing process's root, as soon as the event arrives, and lag is the
// µs from the release to that lstat(): a userspace stat fetches a virtiofs
// file's attributes from the Mac, where the kernel's inode holds the guest's.
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
#include <sys/stat.h>
#include <time.h>
#include <string.h>
#include <unistd.h>
#include <bpf/libbpf.h>
#include <bpf/bpf.h>
#include "observe.skel.h"

#define PATHMAX 4096
#define NAMEMAX 256
struct pathbuf {
  unsigned n, cut, len, pad;
  char buf[PATHMAX + NAMEMAX];
};
struct event {
  unsigned kind, pid;
  unsigned long long run, cgroup, fid, dev, ino;
  long long size, ctime_sec;
  unsigned ctime_nsec, flags, fmode, mnt_id, pad2;
  unsigned long long ts;
  struct pathbuf a, b;
};

static const char *KINDS[] = {"?", "start", "open", "release", "unlink", "rmdir", "mkdir",
                              "rename", "symlink", "link", "truncate", "end"};
static volatile sig_atomic_t stop;
static void on_signal(int s) { (void)s; stop = 1; }

// Components are stored leaf first, each ending in a NUL.
static void path_string(const struct pathbuf *p, char *out, size_t cap) {
  if (p->n == 0) {
    snprintf(out, cap, "-");
    return;
  }
  const char *at[64];
  unsigned n = 0, off = 0;
  while (n < p->n && n < 64 && off < p->len && off < sizeof p->buf) {
    at[n++] = &p->buf[off];
    off += (unsigned)strnlen(&p->buf[off], sizeof p->buf - off) + 1;
  }
  size_t used = 0;
  out[0] = 0;
  for (int i = (int)n - 1; i >= 0 && used < cap; i--)
    used += (size_t)snprintf(out + used, cap - used, "/%s", at[i]);
}

// Each written file's path, by its struct file, from its open to its release.
#define SLOTS (1 << 17)
static struct { unsigned long long fid; char *path; } table[SLOTS];
static void remember(unsigned long long fid, char *path) {
  for (unsigned i = (unsigned)(fid >> 6) & (SLOTS - 1), k = 0; k < SLOTS; i = (i + 1) & (SLOTS - 1), k++)
    if (table[i].fid == 0 || table[i].fid == fid) {
      free(table[i].path);
      table[i].fid = fid;
      table[i].path = path;
      return;
    }
  free(path);
}
static char *forget(unsigned long long fid) {
  for (unsigned i = (unsigned)(fid >> 6) & (SLOTS - 1), k = 0; k < SLOTS; i = (i + 1) & (SLOTS - 1), k++) {
    if (table[i].fid == 0) return NULL;
    if (table[i].fid != fid) continue;
    char *p = table[i].path;
    table[i].fid = 0;
    table[i].path = NULL;
    // Place the rest of the cluster again, so lookups past this slot still find theirs.
    for (unsigned j = (i + 1) & (SLOTS - 1); table[j].fid; j = (j + 1) & (SLOTS - 1)) {
      unsigned long long f = table[j].fid;
      char *q = table[j].path;
      table[j].fid = 0;
      table[j].path = NULL;
      remember(f, q);
    }
    return p;
  }
  return NULL;
}

static int on_event(void *ctx, void *data, size_t len) {
  (void)ctx;
  // An event with one path is trimmed to that path's depth.
  static struct event ev;
  static char pa[8192], pb[8192];
  if (len < offsetof(struct event, a) + offsetof(struct pathbuf, buf)) return 0;
  memset(&ev, 0, sizeof ev);
  memcpy(&ev, data, len < sizeof ev ? len : sizeof ev);
  const struct event *e = &ev;
  const char *k = e->kind < sizeof KINDS / sizeof *KINDS ? KINDS[e->kind] : "?";
  printf("%s\t%llu\t%u\t%llu\t%llx\t%llu\t%llu\t", k, e->run, e->pid, e->cgroup, e->fid, e->dev, e->ino);
  if (e->size >= 0)
    printf("%lld:%lld", e->size, e->ctime_sec * 1000000000LL + e->ctime_nsec);
  else
    fputs("-", stdout);
  printf("\t%o\t%x\t%u\t%u\t", e->flags, e->fmode, e->mnt_id, e->a.cut | e->b.cut);
  path_string(&e->a, pa, sizeof pa);
  if (e->kind == 8)  // symlink: b holds the target text
    snprintf(pb, sizeof pb, "%s", e->b.n ? e->b.buf : "-");
  else
    path_string(&e->b, pb, sizeof pb);
  if (e->kind == 2 && (e->fmode & 2)) remember(e->fid, strdup(pa));
  char ustamp[64] = "-", lag[32] = "-";
  if (e->kind == 3) {
    char *path = forget(e->fid);
    if (path) {
      char full[8300];
      snprintf(full, sizeof full, "/proc/%u/root%s", e->pid, path);
      struct stat st;
      int ok = lstat(full, &st) == 0;
      struct timespec now;
      clock_gettime(CLOCK_MONOTONIC, &now);
      unsigned long long ns = (unsigned long long)now.tv_sec * 1000000000ULL + (unsigned long long)now.tv_nsec;
      if (ok)
        snprintf(ustamp, sizeof ustamp, "%lld:%lld", (long long)st.st_size,
                 (long long)st.st_ctim.tv_sec * 1000000000LL + st.st_ctim.tv_nsec);
      snprintf(lag, sizeof lag, "%.1f", ns > e->ts ? (double)(ns - e->ts) / 1000.0 : 0.0);
      snprintf(pa, sizeof pa, "%s", path);
      free(path);
    }
  }
  printf("%s\t%s\t%s\t%s\n", pa, pb, ustamp, lag);
  return 0;
}

int main(int argc, char **argv) {
  unsigned ring_mib = argc > 1 ? (unsigned)atoi(argv[1]) : 64;
  struct observe_bpf *skel = observe_bpf__open();
  if (!skel) {
    fprintf(stderr, "observe: open failed\n");
    return 1;
  }
  bpf_map__set_max_entries(skel->maps.events, ring_mib << 20);
  int err = observe_bpf__load(skel);
  if (err) {
    fprintf(stderr, "observe: load failed: %d\n", err);
    return 1;
  }
  err = observe_bpf__attach(skel);
  if (err) {
    fprintf(stderr, "observe: attach failed: %d\n", err);
    return 1;
  }
  struct ring_buffer *rb = ring_buffer__new(bpf_map__fd(skel->maps.events), on_event, NULL, NULL);
  if (!rb) {
    fprintf(stderr, "observe: ring failed\n");
    return 1;
  }
  signal(SIGTERM, on_signal);
  signal(SIGINT, on_signal);
  printf("#ready ring %u MiB\n", ring_mib);
  fflush(stdout);
  fprintf(stderr, "#ready\n");
  while (!stop) {
    int n = ring_buffer__poll(rb, 100);
    if (n < 0 && n != -EINTR) break;
  }
  ring_buffer__consume(rb);
  unsigned z = 0;
  unsigned long long total = 0;
  bpf_map__lookup_elem(skel->maps.lost, &z, sizeof z, &total, sizeof total, 0);
  printf("#lost total %llu\n", total);
  unsigned long long key, next, val;
  void *prev = NULL;
  while (bpf_map__get_next_key(skel->maps.lost_by_run, prev, &next, sizeof next) == 0) {
    if (bpf_map__lookup_elem(skel->maps.lost_by_run, &next, sizeof next, &val, sizeof val, 0) == 0)
      printf("#lost run %llu %llu\n", next, val);
    key = next;
    prev = &key;
  }
  fflush(stdout);
  ring_buffer__free(rb);
  observe_bpf__destroy(skel);
  return 0;
}
