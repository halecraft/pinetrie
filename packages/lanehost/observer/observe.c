// observe: loads observe.bpf.c, and turns its ring into lines on stdout,
// answering commands on stdin. Static, so it runs on any machine of its
// architecture. It decides nothing: lanehost's machine role reads its lines
// (packages/lanehost/observer.ts) and routes them.
//
//   observe [ring KiB] [output ring KiB]
//
// stdin, one command a line, fields tab-separated, paths escaped as core's
// codec escapes them (`\\`, `\t`, `\n`):
//   open <token> <pid>                 process <pid> as a candidate
//   find <token> <level> <pid>         every process that is <pid> at PID
//                                      namespace level <level> (the loader's
//                                      own is 0) as a candidate
//   install <token> <pid> [<remote dir>]...
//                                      candidate <pid> of <token> registered:
//                                      a run may begin in its namespace; the
//                                      token's other candidates let go
//   drop <token>                       every candidate of <token> let go
//   unregister <namespace>
//   flush <token>
//   stats <token>
// stdout, one a line:
//   hook <name> attached|missing       each attribution hook, before ready
//   ready                              every file program is attached
//   ev <lane> <run> <inodes> <event>   <event> is core's line (`encodeRunEvent`)
//   out <lane> <run> <event>           <event> is core's output line
//                                      (`encodeOutputEvent`): consecutive
//                                      bytes of one pipe and statement as one
//   candidate <token> <pid> <nspid> <namespaces>
//                                      <nspid>: its NSpid, comma-separated;
//                                      <namespaces>: its PID namespace's inode,
//                                      then each parent's by NS_GET_PARENT up
//                                      to the loader's own
//   looked <token> complete|cut        after the token's candidates; cut when
//                                      no more could be held
//   registered <token> <namespace>  |  refused <token> <why>
//   unregistered <namespace>
//   flushed <token>                    after every event before the flush,
//                                      of every ring
//   refusals <lane> <run> <n>          signals refused since the last stats
//   stats-done <token>                 after them
// A candidate's namespace is held open from its lookup until it is installed
// or dropped, and a lane's until it is unregistered, so its inode cannot be
// another namespace's: what was checked is what is registered. Which
// candidate is a lane's, and whether it may be, is the machine role's to say.
// <inodes> is `-`, or `<kernel>/<lstat>` on a release under a remote
// directory, whose call carries the lstat's stamp and, after it, the
// kernel's: the reader compares them. A remote directory's files are
// lstat'ed through the lane's first process's root as their event is read:
// over virtiofs only a fresh stat reads the Mac's stamp, where the guest's
// inode holds its own clock's.
//
// A failure to load prints `observe: <step>: <reason>` on stderr and exits 1.
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/ioctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <bpf/bpf.h>
#include <bpf/libbpf.h>
#include "observe.h"
#include "observe.skel.h"

#define O_ACCMODE_ 3
#define MAX_LANES 1024
#define MAX_REMOTE 32
#define MAX_CANDIDATES 4096
// PID namespaces nest at most 32 deep, below the initial one.
#define MAX_LEVELS 33
#define NS_GET_PARENT_ 0xb702

static struct observe_bpf *skel;

struct lane {
  unsigned long long namespace;
  int namespace_fd;
  int pid;
  int nremote;
  char *remote[MAX_REMOTE];
  size_t remote_len[MAX_REMOTE];
};
static struct lane lanes[MAX_LANES];
static int nlanes;

static struct lane *lane_of(unsigned long long namespace) {
  for (int i = 0; i < nlanes; i++)
    if (lanes[i].namespace == namespace) return &lanes[i];
  return NULL;
}

static void lane_free(struct lane *l) {
  if (l->namespace_fd >= 0) close(l->namespace_fd);
  l->namespace_fd = -1;
  for (int i = 0; i < l->nremote; i++) free(l->remote[i]);
  l->nremote = 0;
}

static unsigned long long now_us(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (unsigned long long)t.tv_sec * 1000000ULL + (unsigned long long)t.tv_nsec / 1000ULL;
}

static void put_escaped(const char *s) {
  for (; *s; s++) {
    if (*s == '\\') fputs("\\\\", stdout);
    else if (*s == '\t') fputs("\\t", stdout);
    else if (*s == '\n') fputs("\\n", stdout);
    else putchar(*s);
  }
}

static size_t unescape(char *s) {
  size_t o = 0;
  for (size_t i = 0; s[i]; i++) {
    if (s[i] == '\\' && s[i + 1]) {
      i++;
      s[o++] = s[i] == 't' ? '\t' : s[i] == 'n' ? '\n' : s[i];
    } else s[o++] = s[i];
  }
  s[o] = 0;
  return o;
}

// A path as its components say: leaf first, each ending in a NUL.
static void path_string(const struct pathbuf *p, char *out, size_t cap) {
  out[0] = 0;
  if (p->n == 0) return;
  if (p->abs) {
    snprintf(out, cap, "%.*s", (int)p->len, p->buf);
    return;
  }
  const char *at[MAXC + 1];
  unsigned n = 0, off = 0;
  while (n < p->n && n <= MAXC && off < p->len && off < sizeof p->buf) {
    at[n++] = &p->buf[off];
    off += (unsigned)strnlen(&p->buf[off], sizeof p->buf - off) + 1;
  }
  size_t used = 0;
  for (int i = (int)n - 1; i >= 0 && used < cap; i--)
    used += (size_t)snprintf(out + used, cap - used, "/%s", at[i]);
}

static const char KIND_LETTERS[] = {'-', 'f', 'd', 'l', 'o'};
static char letter(unsigned kind) { return kind < sizeof KIND_LETTERS ? KIND_LETTERS[kind] : 'o'; }

static int under(const char *path, const char *dir, size_t len) {
  return strncmp(path, dir, len) == 0 && (path[len] == '/' || path[len] == 0);
}

static int is_remote(const struct lane *l, const char *path) {
  if (!l) return 0;
  for (int i = 0; i < l->nremote; i++)
    if (under(path, l->remote[i], l->remote_len[i])) return 1;
  return 0;
}

// The file at `path` in the lane, through its first process's root. 0 when it is a regular file.
static int lane_lstat(const struct lane *l, const char *path, struct stat *st) {
  char full[PATHMAX + 64];
  snprintf(full, sizeof full, "/proc/%d/root%s", l->pid, path);
  return lstat(full, st) == 0 && S_ISREG(st->st_mode) ? 0 : -1;
}

// Each written file's path, by its struct file, from its open to its release.
#define SLOTS (1 << 18)
static struct {
  unsigned long long fid;
  char *path;
} table[SLOTS];
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
    // The rest of the cluster is placed again, so lookups past this slot still find theirs.
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

static void head(const struct run_key *r, const char *inodes) {
  printf("ev\t%llu\t%llu\t%s\t", (unsigned long long)r->lane, (unsigned long long)r->run, inodes);
}

static void lost_line(const struct run_key *r, unsigned long long count) {
  head(r, "-");
  printf("lost\t%llu\t%llu\n", now_us(), count);
}

// The run's losses so far, sent and reset.
static void send_lost(const struct run_key *r) {
  unsigned long long n = 0;
  if (bpf_map__lookup_and_delete_elem(skel->maps.lost_by_run, r, sizeof *r, &n, sizeof n, 0) == 0 && n > 0)
    lost_line(r, n);
}

// Output bytes not written yet: the next of the same pipe and statement adds to them.
static struct {
  int held;
  struct run_key run;
  unsigned fd, statement;
  unsigned long long n;
} pending;

static void write_pending(void) {
  if (!pending.held) return;
  printf("out\t%llu\t%llu\toutput\t%u\t%u\t%llu\n", (unsigned long long)pending.run.lane,
         (unsigned long long)pending.run.run, pending.fd, pending.statement, pending.n);
  pending.held = 0;
}

static int on_output(void *ctx, void *data, size_t len) {
  (void)ctx;
  struct output_event e;
  if (len < sizeof e) return 0;
  memcpy(&e, data, sizeof e);
  if (e.kind == OE_OUTPUT) {
    if (e.fd != 1 && e.fd != 2) return 0;
    if (pending.held && pending.run.lane == e.run.lane && pending.run.run == e.run.run && pending.fd == e.fd &&
        pending.statement == e.statement) {
      pending.n += e.n;
      return 0;
    }
    write_pending();
    pending.held = 1;
    pending.run = e.run;
    pending.fd = e.fd;
    pending.statement = e.statement;
    pending.n = e.n;
    return 0;
  }
  if (e.kind != OE_STATEMENT) return 0;
  write_pending();
  printf("out\t%llu\t%llu\tstatement\t%llu\t%u\t%u\n", (unsigned long long)e.run.lane,
         (unsigned long long)e.run.run, (unsigned long long)(e.ts / 1000ULL), e.statement, e.line);
  return 0;
}

// The run's output lost so far, sent and reset.
static void send_output_lost(const struct run_key *r) {
  unsigned long long n = 0;
  if (bpf_map__lookup_and_delete_elem(skel->maps.output_lost, r, sizeof *r, &n, sizeof n, 0) == 0 && n > 0)
    printf("out\t%llu\t%llu\toutput-lost\t%llu\n", (unsigned long long)r->lane, (unsigned long long)r->run, n);
}

// Every ring, read to its end: what a flush answers after. Each ring is
// added to `rb` from `RINGS`, so one added there is drained here too.
static void drain(struct ring_buffer *rb) {
  ring_buffer__consume(rb);
  write_pending();
}

static void stamp_of(char *out, size_t cap, long long size, long long sec, unsigned nsec) {
  snprintf(out, cap, "%lld:%lld", size, sec * 1000000000LL + (long long)nsec);
}

static const char *OPS[] = {"?", "open", "release", "unlink", "mkdir", "rename", "symlink", "link"};

static int on_event(void *ctx, void *data, size_t len) {
  (void)ctx;
  static struct event ev;
  static char pa[PATHMAX + NAMEMAX + 8], pb[PATHMAX + NAMEMAX + 8];
  if (len < offsetof(struct event, a) + offsetof(struct pathbuf, buf)) return 0;
  memset(&ev, 0, sizeof ev);
  memcpy(&ev, data, len < sizeof ev ? len : sizeof ev);
  const struct event *e = &ev;
  unsigned long long at = e->ts / 1000ULL;
  if (e->kind == EV_EXIT) {
    head(&e->run, "-");
    printf("exit\t%llu\t%u\n", at, e->status);
    return 0;
  }
  if (e->kind == EV_END) {
    send_lost(&e->run);
    head(&e->run, "-");
    printf("end\t%llu\n", at);
    return 0;
  }
  if (e->kind < EV_OPEN || e->kind > EV_LINK) return 0;
  // A path cut short would name another file: the run is incomplete instead.
  if (e->a.cut || e->b.cut) {
    lost_line(&e->run, 1);
    return 0;
  }
  path_string(&e->a, pa, sizeof pa);
  path_string(&e->b, pb, sizeof pb);
  const struct lane *l = lane_of(e->run.lane);
  char stamp[64] = "", kernel[64] = "", inodes[64] = "-";
  if (e->size >= 0 && e->before == PK_FILE) stamp_of(stamp, sizeof stamp, e->size, e->ctime_sec, e->ctime_nsec);
  if (e->kind == EV_OPEN && e->fid && (e->flags & O_ACCMODE_) != 0) remember(e->fid, strdup(pa));
  if (e->kind == EV_RELEASE) {
    char *path = forget(e->fid);
    // A release the loader cannot name could be a shared file's version: the run is incomplete.
    if (!path) {
      lost_line(&e->run, 1);
      return 0;
    }
    snprintf(pa, sizeof pa, "%s", path);
    free(path);
  }
  if ((e->kind == EV_OPEN || e->kind == EV_RELEASE) && is_remote(l, pa)) {
    struct stat st;
    int ok = lane_lstat(l, pa, &st) == 0;
    if (e->kind == EV_RELEASE) {
      snprintf(kernel, sizeof kernel, "%s", stamp);
      if (ok && kernel[0]) snprintf(inodes, sizeof inodes, "%llu/%llu", (unsigned long long)e->ino, (unsigned long long)st.st_ino);
      else kernel[0] = 0;
    }
    // An open that made the file found none: it has no stamp, as on any disk.
    if (ok && stamp[0])
      stamp_of(stamp, sizeof stamp, (long long)st.st_size, (long long)st.st_ctim.tv_sec, (unsigned)st.st_ctim.tv_nsec);
    else stamp[0] = 0;
  }
  head(&e->run, inodes);
  printf("%s\t%llu\t%u\t%x\t%c\t", OPS[e->kind], at, e->pid, e->flags, letter(e->before));
  put_escaped(pa);
  printf("\t%c\t", e->b.n ? letter(e->before2) : '-');
  put_escaped(pb);
  printf("\t%s", stamp);
  if (kernel[0]) printf("\t%s", kernel);
  putchar('\n');
  return 0;
}

// A process found by a lookup: its PID namespace held open until it is
// installed or dropped.
struct candidate {
  char token[32];
  int pid;
  int namespace_fd;
  unsigned long long namespace;
};
static struct candidate candidates[MAX_CANDIDATES];
static int ncandidates;

static void drop_token(const char *token) {
  for (int i = 0; i < ncandidates;) {
    if (strcmp(candidates[i].token, token) != 0) {
      i++;
      continue;
    }
    if (candidates[i].namespace_fd >= 0) close(candidates[i].namespace_fd);
    candidates[i] = candidates[--ncandidates];
  }
}

// NSpid, read through the process's /proc directory: its levels, or -1.
static int nspid_of(int dir, long *out, int cap) {
  int fd = openat(dir, "status", O_RDONLY | O_CLOEXEC);
  if (fd < 0) return -1;
  static char buf[16384];
  ssize_t r = read(fd, buf, sizeof buf - 1);
  close(fd);
  if (r <= 0) return -1;
  buf[r] = 0;
  char *at = strstr(buf, "\nNSpid:");
  if (!at) return -1;
  at += 7;
  int n = 0;
  while (n < cap) {
    char *end;
    long v = strtol(at, &end, 10);
    if (end == at) break;
    out[n++] = v;
    at = end;
  }
  return n;
}

// The namespace `fd` holds, then each parent NS_GET_PARENT gives: it refuses
// the loader's own namespace's parent, so the last is the loader's.
static int namespaces_of(int fd, unsigned long long *out, int cap) {
  int n = 0, at = fd;
  while (n < cap) {
    struct stat st;
    if (fstat(at, &st) != 0) break;
    out[n++] = (unsigned long long)st.st_ino;
    int parent = ioctl(at, NS_GET_PARENT_);
    if (at != fd) close(at);
    at = parent;
    if (at < 0) break;
  }
  if (at >= 0 && at != fd) close(at);
  return n;
}

// Process <pid> as a candidate of <token>, when <level> < 0 or its pid at
// <level> is <want>. Its status and namespace are read through one /proc
// directory, so both are the one process's even if its pid is reused.
static void consider(const char *token, int pid, int level, long want, int *cut) {
  char path[64];
  snprintf(path, sizeof path, "/proc/%d", pid);
  int dir = open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (dir < 0) return;
  long nspid[MAX_LEVELS];
  int n = nspid_of(dir, nspid, MAX_LEVELS);
  if (n <= 0 || (level >= 0 && (level >= n || nspid[level] != want))) {
    close(dir);
    return;
  }
  int fd = openat(dir, "ns/pid", O_RDONLY | O_CLOEXEC);
  close(dir);
  if (fd < 0) return;
  if (ncandidates == MAX_CANDIDATES) {
    close(fd);
    *cut = 1;
    return;
  }
  unsigned long long ns[MAX_LEVELS];
  int m = namespaces_of(fd, ns, MAX_LEVELS);
  if (m <= 0) {
    close(fd);
    return;
  }
  struct candidate *c = &candidates[ncandidates++];
  snprintf(c->token, sizeof c->token, "%s", token);
  c->pid = pid;
  c->namespace_fd = fd;
  c->namespace = ns[0];
  printf("candidate\t%s\t%d\t", token, pid);
  for (int i = 0; i < n; i++) printf(i ? ",%ld" : "%ld", nspid[i]);
  putchar('\t');
  for (int i = 0; i < m; i++) printf(i ? ",%llu" : "%llu", ns[i]);
  putchar('\n');
}

static void do_open(char **f, int n) {
  int cut = 0;
  const char *token = n > 1 ? f[1] : "";
  int pid = n > 2 ? atoi(f[2]) : 0;
  if (pid > 0) consider(token, pid, -1, 0, &cut);
  printf("looked\t%s\t%s\n", token, cut ? "cut" : "complete");
}

static void do_find(char **f, int n) {
  int cut = 0;
  const char *token = n > 1 ? f[1] : "";
  int level = n > 2 ? atoi(f[2]) : -1;
  long want = n > 3 ? atol(f[3]) : 0;
  DIR *proc = level >= 0 && want > 0 ? opendir("/proc") : NULL;
  for (struct dirent *d; proc && (d = readdir(proc));) {
    char *end;
    long pid = strtol(d->d_name, &end, 10);
    if (*end == 0 && pid > 0) consider(token, (int)pid, level, want, &cut);
  }
  if (proc) closedir(proc);
  printf("looked\t%s\t%s\n", token, cut ? "cut" : "complete");
}

static void refused(const char *token, const char *why) {
  printf("refused\t%s\t", token);
  put_escaped(why);
  putchar('\n');
}

// A candidate made a lane, or the lane its namespace is already refreshed:
// its first pid and remote directories replaced, its descriptor the new one.
static void do_install(char **f, int n) {
  const char *token = n > 1 ? f[1] : "";
  int pid = n > 2 ? atoi(f[2]) : 0;
  struct candidate *c = NULL;
  for (int i = 0; i < ncandidates && !c; i++)
    if (strcmp(candidates[i].token, token) == 0 && candidates[i].pid == pid) c = &candidates[i];
  if (!c) {
    refused(token, "no such candidate");
    return;
  }
  unsigned long long ns = c->namespace;
  int fd = c->namespace_fd;
  c->namespace_fd = -1;
  drop_token(token);
  struct lane *l = lane_of(ns);
  if (!l) {
    if (nlanes == MAX_LANES) {
      close(fd);
      refused(token, "the observer holds as many lanes as it can");
      return;
    }
    unsigned char one = 1;
    if (bpf_map__update_elem(skel->maps.registered, &ns, sizeof ns, &one, sizeof one, 0) != 0) {
      close(fd);
      refused(token, "the observer's map of lanes is full");
      return;
    }
    l = &lanes[nlanes++];
    memset(l, 0, sizeof *l);
    l->namespace_fd = -1;
  }
  lane_free(l);
  l->namespace = ns;
  l->namespace_fd = fd;
  l->pid = pid;
  for (int i = 3; i < n && l->nremote < MAX_REMOTE; i++) {
    size_t len = unescape(f[i]);
    while (len > 1 && f[i][len - 1] == '/') f[i][--len] = 0;
    l->remote[l->nremote] = strdup(f[i]);
    l->remote_len[l->nremote] = len;
    l->nremote++;
  }
  printf("registered\t%s\t%llu\n", token, ns);
}

static void do_drop(char **f, int n) { drop_token(n > 1 ? f[1] : ""); }

static void do_unregister(char **f, int n) {
  unsigned long long ns = n > 1 ? strtoull(f[1], NULL, 10) : 0;
  bpf_map__delete_elem(skel->maps.registered, &ns, sizeof ns, 0);
  struct lane *l = lane_of(ns);
  if (l) {
    lane_free(l);
    *l = lanes[--nlanes];
  }
  printf("unregistered\t%llu\n", ns);
}

// Every key of a map of run_keys, gathered before any is deleted.
static int run_keys(struct bpf_map *m, struct run_key *out, int cap) {
  int n = 0;
  struct run_key key, *prev = NULL;
  while (n < cap && bpf_map__get_next_key(m, prev, &key, sizeof key) == 0) {
    out[n++] = key;
    prev = &out[n - 1];
  }
  return n;
}

static struct rb_keys {
  struct run_key k[1 << 16];
} keys;

static void do_flush(struct ring_buffer *rb, char **f, int n) {
  drain(rb);
  int m = run_keys(skel->maps.output_lost, keys.k, 1 << 16);
  for (int i = 0; i < m; i++) send_output_lost(&keys.k[i]);
  m = run_keys(skel->maps.lost_by_run, keys.k, 1 << 16);
  for (int i = 0; i < m; i++) send_lost(&keys.k[i]);
  // Ends the ring had no room for, after their runs' losses.
  m = run_keys(skel->maps.ended, keys.k, 1 << 16);
  for (int i = 0; i < m; i++) {
    unsigned long long ts = 0;
    if (bpf_map__lookup_and_delete_elem(skel->maps.ended, &keys.k[i], sizeof keys.k[i], &ts, sizeof ts, 0) != 0)
      continue;
    send_lost(&keys.k[i]);
    head(&keys.k[i], "-");
    printf("end\t%llu\n", ts / 1000ULL);
  }
  printf("flushed\t%s\n", n > 1 ? f[1] : "");
}

static void do_stats(char **f, int n) {
  int m = run_keys(skel->maps.refusals, keys.k, 1 << 16);
  for (int i = 0; i < m; i++) {
    unsigned long long count = 0;
    if (bpf_map__lookup_and_delete_elem(skel->maps.refusals, &keys.k[i], sizeof keys.k[i], &count, sizeof count, 0) == 0)
      printf("refusals\t%llu\t%llu\t%llu\n", (unsigned long long)keys.k[i].lane, (unsigned long long)keys.k[i].run,
             count);
  }
  printf("stats-done\t%s\n", n > 1 ? f[1] : "");
}

static void command(struct ring_buffer *rb, char *line) {
  char *f[MAX_REMOTE + 3];
  int n = 0;
  for (char *s = line; n < MAX_REMOTE + 3;) {
    f[n++] = s;
    char *tab = strchr(s, '\t');
    if (!tab) break;
    *tab = 0;
    s = tab + 1;
  }
  if (strcmp(f[0], "open") == 0) do_open(f, n);
  else if (strcmp(f[0], "find") == 0) do_find(f, n);
  else if (strcmp(f[0], "install") == 0) do_install(f, n);
  else if (strcmp(f[0], "drop") == 0) do_drop(f, n);
  else if (strcmp(f[0], "unregister") == 0) do_unregister(f, n);
  else if (strcmp(f[0], "flush") == 0) do_flush(rb, f, n);
  else if (strcmp(f[0], "stats") == 0) do_stats(f, n);
  else if (f[0][0]) fprintf(stderr, "observe: unknown command %s\n", f[0]);
}

static int fail(const char *step, int err) {
  fprintf(stderr, "observe: %s: %s\n", step, strerror(err < 0 ? -err : err));
  return 1;
}

static int is_attribution(const struct bpf_program *p) { return strncmp(bpf_program__name(p), "attr_", 5) == 0; }

// The skeleton opened and loaded. Attribution's programs are attached by
// `attach_attribution`, never by the skeleton; ones the kernel cannot load
// are left out, so file tracking loads whatever attribution's fate.
static int load(unsigned ring_kib, unsigned output_kib, int with_attribution) {
  skel = observe_bpf__open();
  if (!skel) return -errno;
  bpf_map__set_max_entries(skel->maps.events, ring_kib << 10);
  bpf_map__set_max_entries(skel->maps.output_events, output_kib << 10);
  struct bpf_program *p;
  bpf_object__for_each_program(p, skel->obj) {
    if (!is_attribution(p)) continue;
    bpf_program__set_autoattach(p, false);
    if (!with_attribution) bpf_program__set_autoload(p, false);
  }
  int err = observe_bpf__load(skel);
  if (err) {
    observe_bpf__destroy(skel);
    skel = NULL;
  }
  return err;
}

// Each attribution program attached to the kernel function its section
// names, and reported by that name: `attr_pipe_write` falls back to the
// name kernels before 6.15 give the function.
static void attach_attribution(int loaded) {
  struct bpf_program *p;
  bpf_object__for_each_program(p, skel->obj) {
    if (!is_attribution(p)) continue;
    const char *fn = strchr(bpf_program__section_name(p), '/');
    fn = fn ? fn + 1 : "";
    struct bpf_link *link = NULL;
    if (loaded) {
      link = bpf_program__attach_kprobe(p, false, fn);
      if (!link && strcmp(fn, "anon_pipe_write") == 0) link = bpf_program__attach_kprobe(p, false, "pipe_write");
    }
    printf("hook\t%s\t%s\n", fn, link ? "attached" : "missing");
  }
}

static const struct {
  const char *name;
  ring_buffer_sample_fn fn;
} RINGS[] = {{"events", on_event}, {"output_events", on_output}};

int main(int argc, char **argv) {
  unsigned ring_kib = argc > 1 ? (unsigned)atoi(argv[1]) : 64 << 10;
  unsigned output_kib = argc > 2 ? (unsigned)atoi(argv[2]) : 16 << 10;
  signal(SIGPIPE, SIG_IGN);
  // Each lane and each candidate holds a descriptor.
  struct rlimit nofile;
  if (getrlimit(RLIMIT_NOFILE, &nofile) == 0) {
    nofile.rlim_cur = nofile.rlim_max;
    setrlimit(RLIMIT_NOFILE, &nofile);
  }
  int with_attribution = 1;
  int err = load(ring_kib, output_kib, 1);
  if (err) {
    with_attribution = 0;
    err = load(ring_kib, output_kib, 0);
  }
  if (err) return fail("load", err);
  err = observe_bpf__attach(skel);
  if (err) return fail("attach", err);
  attach_attribution(with_attribution);
  struct ring_buffer *rb = NULL;
  for (size_t i = 0; i < sizeof RINGS / sizeof RINGS[0]; i++) {
    struct bpf_map *m = bpf_object__find_map_by_name(skel->obj, RINGS[i].name);
    if (!m) return fail("ring", ENOENT);
    if (!rb)
      rb = ring_buffer__new(bpf_map__fd(m), RINGS[i].fn, NULL, NULL);
    else if (ring_buffer__add(rb, bpf_map__fd(m), RINGS[i].fn, NULL))
      return fail("ring", errno);
    if (!rb) return fail("ring", errno);
  }
  int ep = epoll_create1(EPOLL_CLOEXEC);
  struct epoll_event in = {.events = EPOLLIN, .data.fd = 0};
  struct epoll_event ring = {.events = EPOLLIN, .data.fd = -1};
  if (ep < 0 || epoll_ctl(ep, EPOLL_CTL_ADD, 0, &in) != 0 ||
      epoll_ctl(ep, EPOLL_CTL_ADD, ring_buffer__epoll_fd(rb), &ring) != 0)
    return fail("epoll", errno);
  printf("ready\n");
  fflush(stdout);
  static char buf[1 << 20];
  size_t used = 0;
  for (;;) {
    struct epoll_event got[2];
    int n = epoll_wait(ep, got, 2, 100);
    if (n < 0) {
      if (errno == EINTR) continue;
      return fail("epoll", errno);
    }
    // Commands first: a flush must drain the ring itself, not find it drained.
    for (int i = 0; i < n; i++) {
      if (got[i].data.fd != 0) continue;
      ssize_t r = read(0, buf + used, sizeof buf - used - 1);
      // The machine role ends stdin to stop it.
      if (r <= 0) {
        fflush(stdout);
        return 0;
      }
      used += (size_t)r;
      buf[used] = 0;
      char *start = buf, *nl;
      while ((nl = memchr(start, '\n', used - (size_t)(start - buf)))) {
        *nl = 0;
        command(rb, start);
        start = nl + 1;
      }
      used -= (size_t)(start - buf);
      memmove(buf, start, used);
      if (used == sizeof buf - 1) used = 0;
    }
    drain(rb);
    fflush(stdout);
  }
}
