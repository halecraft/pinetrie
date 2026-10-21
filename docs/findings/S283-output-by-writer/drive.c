// S283's driver: the shell and the wrapper in one. It loads attr.bpf.c,
// makes the watched pipe, feeds four steps (tagging itself with each, as the
// wrapper would tag the shell), and checks each byte the reader got against
// the attribution events. A byte's value is the step that wrote it ('0' for
// an untagged writer), so the check needs no other record.
#define _GNU_SOURCE
#include <bpf/libbpf.h>
#include <errno.h>
#include <fcntl.h>
#include <liburing.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/sendfile.h>
#include <sys/stat.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <unistd.h>
#include "attr.h"
#include "attr.skel.h"

static struct attr_bpf *skel;
static int out;  // the watched pipe's write end

#define MAX_EVENTS (1 << 22)
static struct ev *evs;
static volatile size_t nev;
static volatile int stop_ring;

static int on_event(void *ctx, void *data, size_t size) {
  if (nev < MAX_EVENTS) evs[nev++] = *(struct ev *)data;
  return 0;
}

static void *ring_loop(void *arg) {
  struct ring_buffer *rb = arg;
  while (!stop_ring) ring_buffer__poll(rb, 50);
  ring_buffer__consume(rb);
  return NULL;
}

static void tag_self(unsigned step) {
  unsigned tid = gettid();
  if (bpf_map__update_elem(skel->maps.steps, &tid, sizeof tid, &step, sizeof step, 0))
    fprintf(stderr, "tag: %s\n", strerror(errno));
}

static void write_all(int fd, const char *b, size_t n) {
  while (n > 0) {
    ssize_t w = write(fd, b, n);
    if (w < 0) {
      if (errno == EINTR) continue;
      perror("write");
      _exit(1);
    }
    b += w;
    n -= (size_t)w;
  }
}

static char *filled(char c, size_t n) {
  char *b = aligned_alloc(4096, (n + 4095) & ~(size_t)4095);
  memset(b, c, n);
  return b;
}

static void wait_go(int fd) {
  char x;
  while (read(fd, &x, 1) < 0 && errno == EINTR) {}
}

// Writes `total` bytes of `c` in `chunk`-sized writes.
static void writer(char c, size_t total, size_t chunk) {
  char *b = filled(c, chunk);
  for (size_t done = 0; done < total; done += chunk) write_all(out, b, chunk);
}

static void *thread_writer(void *arg) {
  writer('2', 256 << 10, 256 << 10);
  return arg;
}

// The go pipes' write ends the driver still holds: a child must not keep one
// open, or its reader never sees the close that starts it.
static int go_writes[3] = {-1, -1, -1};
static void close_go(int i) {
  close(go_writes[i]);
  go_writes[i] = -1;
}

static pid_t spawn(void (*fn)(void)) {
  pid_t p = fork();
  if (p == 0) {
    for (int i = 0; i < 3; i++)
      if (go_writes[i] >= 0) close(go_writes[i]);
    fn();
    _exit(0);
  }
  return p;
}

// ---- step 1's background job: double-forked, writes in two later phases.
static int go2[2], go3[2];
static void bg_job(void) {
  if (fork() != 0) _exit(0);  // reparented: no longer the shell's child
  wait_go(go2[0]);
  writer('1', 1 << 20, 8192);
  wait_go(go3[0]);
  writer('1', 1 << 20, 6000);
}

// ---- step 2: one process and its thread, each one large write.
static void big_writes(void) {
  pthread_t t;
  pthread_create(&t, NULL, thread_writer, NULL);
  writer('2', 256 << 10, 256 << 10);
  pthread_join(t, NULL);
}

// ---- step 3: every other route into a pipe, all at once.
#define ROUTE_BYTES (192 << 10)
static int file3(void) {
  char path[] = "/tmp/f3XXXXXX";
  int fd = mkstemp(path);
  char *b = filled('3', ROUTE_BYTES);
  write_all(fd, b, ROUTE_BYTES);
  lseek(fd, 0, SEEK_SET);
  return fd;
}
static void by_splice_file(void) {
  int fd = file3();
  for (size_t left = ROUTE_BYTES; left > 0;) {
    ssize_t n = splice(fd, NULL, out, NULL, left, 0);
    if (n <= 0) { perror("splice file"); _exit(1); }
    left -= (size_t)n;
  }
}
static void by_sendfile(void) {
  int fd = file3();
  for (size_t left = ROUTE_BYTES; left > 0;) {
    ssize_t n = sendfile(out, fd, NULL, left);
    if (n <= 0) { perror("sendfile"); _exit(1); }
    left -= (size_t)n;
  }
}
static void by_vmsplice(void) {
  char *b = filled('3', ROUTE_BYTES);
  struct iovec v = {b, ROUTE_BYTES};
  while (v.iov_len > 0) {
    ssize_t n = vmsplice(out, &v, 1, 0);
    if (n <= 0) { perror("vmsplice"); _exit(1); }
    v.iov_base = (char *)v.iov_base + n;
    v.iov_len -= (size_t)n;
  }
  pause();  // vmsplice'd pages are read later: keep them as written
}
// A source pipe another process fills with '3'.
static int source_pipe(void) {
  int q[2];
  pipe(q);
  fcntl(q[0], F_SETPIPE_SZ, 1 << 20);
  if (fork() == 0) {
    close(q[0]);
    char *b = filled('3', ROUTE_BYTES);
    // The filler writes '3' into its own pipe, not the watched one.
    write_all(q[1], b, ROUTE_BYTES);
    _exit(0);
  }
  close(q[1]);
  return q[0];
}
static void by_tee(void) {
  int q = source_pipe();
  static char sink[1 << 16];
  for (size_t left = ROUTE_BYTES; left > 0;) {
    ssize_t n = tee(q, out, left < sizeof sink ? left : sizeof sink, 0);
    if (n <= 0) { perror("tee"); _exit(1); }
    // tee leaves the source as it was: drain what it duplicated.
    for (ssize_t r = 0; r < n;) {
      ssize_t k = read(q, sink, (size_t)(n - r));
      if (k <= 0) { perror("tee drain"); _exit(1); }
      r += k;
    }
    left -= (size_t)n;
  }
}
static void by_splice_pipe(void) {
  int q = source_pipe();
  for (size_t left = ROUTE_BYTES; left > 0;) {
    ssize_t n = splice(q, NULL, out, NULL, left, 0);
    if (n <= 0) { perror("splice pipe"); _exit(1); }
    left -= (size_t)n;
  }
}
static void by_uring(void) {
  struct io_uring r;
  if (io_uring_queue_init(8, &r, 0)) { perror("uring"); _exit(1); }
  char *b = filled('3', 32 << 10);
  for (int i = 0; i < ROUTE_BYTES / (32 << 10); i++) {
    struct io_uring_sqe *s = io_uring_get_sqe(&r);
    io_uring_prep_write(s, out, b, 32 << 10, 0);
    if (i % 2) io_uring_sqe_set_flags(s, IOSQE_ASYNC);  // half in io-wq workers
    io_uring_submit(&r);
    struct io_uring_cqe *c;
    io_uring_wait_cqe(&r, &c);
    if (c->res != (32 << 10)) { fprintf(stderr, "uring write %d\n", c->res); _exit(1); }
    io_uring_cqe_seen(&r, c);
  }
}

// ---- step 0: untagged writers, after a pid wrap, reusing tagged tids.
static int go0[2];
static void untagged_spawner(void) {
  wait_go(go0[0]);
  for (int i = 0; i < 1500; i++) {
    pid_t p = fork();
    if (p == 0) {
      write_all(out, "0", 1);
      _exit(0);
    }
    waitpid(p, NULL, 0);
  }
}

int main(void) {
  struct rlimit inf = {RLIM_INFINITY, RLIM_INFINITY};
  setrlimit(RLIMIT_MEMLOCK, &inf);
  evs = calloc(MAX_EVENTS, sizeof *evs);
  skel = attr_bpf__open_and_load();
  if (!skel) { perror("load"); return 1; }
  if (attr_bpf__attach(skel)) { perror("attach"); return 1; }

  int p[2];
  pipe(p);
  out = p[1];
  struct stat st;
  fstat(p[1], &st);
  unsigned k = 0;
  struct cfg c = {.ino = st.st_ino};
  bpf_map__update_elem(skel->maps.cfgs, &k, sizeof k, &c, sizeof c, 0);

  // The reader and the untagged spawner start before any step: untagged.
  pid_t reader = fork();
  if (reader == 0) {
    close(p[1]);
    size_t cap = 64 << 20, n = 0;
    char *s = malloc(cap);
    for (ssize_t r; (r = read(p[0], s + n, cap - n)) != 0;) {
      if (r < 0) { if (errno == EINTR) continue; perror("read"); _exit(1); }
      n += (size_t)r;
    }
    int fd = open("/tmp/stream", O_WRONLY | O_CREAT | O_TRUNC, 0644);
    write_all(fd, s, n);
    _exit(0);
  }
  close(p[0]);
  pipe(go0);
  go_writes[0] = go0[1];
  pid_t spawner = spawn(untagged_spawner);
  close(go0[0]);

  struct ring_buffer *rb = ring_buffer__new(bpf_map__fd(skel->maps.events), on_event, NULL, NULL);
  pthread_t ring;
  pthread_create(&ring, NULL, ring_loop, rb);

  write_all(out, "0", 1);  // untagged: teaches the probe the pipe

  pipe(go2);
  pipe(go3);
  go_writes[1] = go2[1];
  go_writes[2] = go3[1];
  fprintf(stderr, "step 1\n");
  tag_self(1);
  write_all(out, filled('1', 100), 100);
  pid_t bg = spawn(bg_job);
  close(go2[0]);
  close(go3[0]);
  waitpid(bg, NULL, 0);

  fprintf(stderr, "step 2\n");
  tag_self(2);
  close_go(1);  // the background job's first phase, against step 2's writes
  write_all(out, filled('2', 50), 50);
  waitpid(spawn(big_writes), NULL, 0);

  fprintf(stderr, "step 3\n");
  tag_self(3);
  close_go(2);  // its second phase, against step 3's routes
  pid_t vm = spawn(by_vmsplice);
  void (*routes[])(void) = {by_splice_file, by_sendfile, by_tee, by_splice_pipe, by_uring};
  pid_t rp[5];
  for (int i = 0; i < 5; i++) rp[i] = spawn(routes[i]);
  for (int i = 0; i < 5; i++) waitpid(rp[i], NULL, 0);
  fprintf(stderr, "routes done\n");

  fprintf(stderr, "step 4\n");
  tag_self(4);
  close_go(0);  // the untagged writers, against step 4's own small writes
  for (int i = 0; i < 200; i++) write_all(out, "4444444444", 10);
  waitpid(spawner, NULL, 0);
  fprintf(stderr, "untagged done\n");

  close(out);
  // vmsplice's process holds its pages until the reader has them.
  kill(vm, SIGTERM);
  waitpid(vm, NULL, 0);
  waitpid(reader, NULL, 0);
  fprintf(stderr, "reader done\n");
  sleep(1);
  stop_ring = 1;
  pthread_join(ring, NULL);

  int fd = open("/tmp/stream", O_RDONLY);
  fstat(fd, &st);
  size_t n = (size_t)st.st_size;
  char *s = malloc(n + 1);
  for (size_t got = 0; got < n;) got += (size_t)read(fd, s + got, n - got);

  size_t pos = 0, wrong = 0, first_wrong = (size_t)-1;
  size_t by_route[5] = {0}, wrong_by_route[5] = {0}, in_stream[5] = {0}, attributed[5] = {0};
  for (size_t i = 0; i < n; i++) if (s[i] >= '0' && s[i] <= '4') in_stream[s[i] - '0']++;
  for (size_t e = 0; e < nev; e++) {
    struct ev v = evs[e];
    if (v.route >= 5) continue;
    by_route[v.route] += v.len;
    if (v.route == ROUTE_LOST) continue;
    for (unsigned j = 0; j < v.len; j++, pos++) {
      if (pos >= n) break;
      if (v.step < 5) attributed[v.step]++;
      if (s[pos] != (char)('0' + v.step)) {
        wrong++;
        wrong_by_route[v.route]++;
        if (first_wrong == (size_t)-1) first_wrong = pos;
      }
    }
  }
  unsigned zero = 0;
  unsigned long long dropped = 0;
  bpf_map__lookup_elem(skel->maps.dropped, &zero, sizeof zero, &dropped, sizeof dropped, 0);
  printf("bytes_read %zu\nbytes_attributed %zu\nevents %zu\nring_dropped %llu\n", n, pos, (size_t)nev, dropped);
  printf("wrong %zu first_wrong %zd\n", wrong, (ssize_t)first_wrong);
  const char *names[5] = {"-", "write", "locked", "orphan", "lost"};
  for (int r = 1; r < 5; r++) printf("route %s bytes %zu wrong %zu\n", names[r], by_route[r], wrong_by_route[r]);
  for (int t = 0; t < 5; t++) printf("step %d in_stream %zu attributed %zu\n", t, in_stream[t], attributed[t]);
  // How often the stream changes step, between two tagged steps: where
  // writers of different steps interleaved.
  size_t runs = 0, tagged_switches = 0;
  for (size_t i = 1; i < n; i++)
    if (s[i] != s[i - 1]) {
      runs++;
      if (s[i] != '0' && s[i - 1] != '0') tagged_switches++;
    }
  printf("stream_runs %zu tagged_switches %zu\n", runs + 1, tagged_switches);
  // Untagged writes whose tid had written for a step before: pid reuse.
  static unsigned char tagged_tid[1 << 16];
  size_t reused = 0;
  for (size_t e = 0; e < nev; e++)
    if (evs[e].step) tagged_tid[evs[e].tid & 0xffff] = 1;
  for (size_t i = 0, pos2 = 0; i < nev; pos2 += evs[i].len, i++)
    if (pos2 < n && s[pos2] == '0' && tagged_tid[evs[i].tid & 0xffff]) reused++;
  printf("untagged_writes_on_reused_tids %zu\n", reused);
  return 0;
}
