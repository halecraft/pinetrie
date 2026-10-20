// S281's driver: runs `bash -c "$(cat /cmd.sh)"` the way pi does (stdin
// /dev/null, stdout and stderr into one watched pipe), with BASH_ENV set to a
// trap's prelude, and prints the stream, the attribution events and the
// marker file as hex for guest.py to check. It checks nothing itself.
//   drive <prelude>
#define _GNU_SOURCE
#include <bpf/libbpf.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include "attr.h"
#include "attr.skel.h"

#define MAX_EVENTS (1 << 20)
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

static char *slurp(const char *path, size_t *n) {
  int fd = open(path, O_RDONLY);
  struct stat st;
  fstat(fd, &st);
  char *b = malloc((size_t)st.st_size + 1);
  size_t got = 0;
  while (got < (size_t)st.st_size) {
    ssize_t r = read(fd, b + got, (size_t)st.st_size - got);
    if (r <= 0) break;
    got += (size_t)r;
  }
  b[got] = 0;
  close(fd);
  *n = got;
  return b;
}

static void hex(const char *label, const char *b, size_t n) {
  printf("%s ", label);
  for (size_t i = 0; i < n; i++) printf("%02x", (unsigned char)b[i]);
  printf("\n");
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  struct rlimit inf = {RLIM_INFINITY, RLIM_INFINITY};
  setrlimit(RLIMIT_MEMLOCK, &inf);
  evs = calloc(MAX_EVENTS, sizeof *evs);
  struct attr_bpf *skel = attr_bpf__open_and_load();
  if (!skel) { perror("load"); return 1; }
  if (attr_bpf__attach(skel)) { perror("attach"); return 1; }

  int p[2];
  pipe(p);
  int mk = open("/tmp/marks", O_WRONLY | O_CREAT | O_TRUNC, 0644);
  close(mk);
  struct stat st, ms;
  fstat(p[1], &st);
  stat("/tmp/marks", &ms);
  unsigned k = 0;
  struct cfg c = {.ino = st.st_ino, .mark_ino = ms.st_ino};
  bpf_map__update_elem(skel->maps.cfgs, &k, sizeof k, &c, sizeof c, 0);

  pid_t reader = fork();
  if (reader == 0) {
    close(p[1]);
    size_t cap = 1 << 24, n = 0;
    char *s = malloc(cap);
    for (ssize_t r; (r = read(p[0], s + n, cap - n)) != 0;) {
      if (r < 0) { if (errno == EINTR) continue; _exit(1); }
      n += (size_t)r;
    }
    int fd = open("/tmp/stream", O_WRONLY | O_CREAT | O_TRUNC, 0644);
    write(fd, s, n);
    _exit(0);
  }
  close(p[0]);
  struct ring_buffer *rb = ring_buffer__new(bpf_map__fd(skel->maps.events), on_event, NULL, NULL);
  pthread_t ring;
  pthread_create(&ring, NULL, ring_loop, rb);

  // Untagged: teaches the probe the pipe, and is skipped by the check.
  write(p[1], "#\n", 2);

  size_t clen;
  char *cmd = slurp("/cmd.sh", &clen);
  pid_t sh = fork();
  if (sh == 0) {
    int null = open("/dev/null", O_RDONLY);
    dup2(null, 0);
    dup2(p[1], 1);
    dup2(p[1], 2);
    close(p[1]);
    setenv("BASH_ENV", argv[1], 1);
    execl("/bin/bash", "bash", "-c", cmd, (char *)NULL);
    _exit(127);
  }
  close(p[1]);
  int status;
  waitpid(sh, &status, 0);
  waitpid(reader, NULL, 0);  // after every background job let the pipe go
  usleep(200000);
  stop_ring = 1;
  pthread_join(ring, NULL);

  size_t n, m;
  char *s = slurp("/tmp/stream", &n);
  char *marks = slurp("/tmp/marks", &m);
  printf("exit %d\n", WEXITSTATUS(status));
  for (unsigned i = 0; i < 3; i++) {
    unsigned long long v = 0;
    bpf_map__lookup_elem(skel->maps.dbg, &i, sizeof i, &v, sizeof v, 0);
    printf("dbg %u %llu\n", i, v);
  }
  printf("mark_ino %llu pipe_ino %llu\n", c.mark_ino, c.ino);
  hex("stream", s, n);
  hex("marks", marks, m);
  for (size_t i = 0; i < nev; i++)
    printf("ev %u %u %u %u %u\n", evs[i].tag.tid, evs[i].tag.k, evs[i].writer, evs[i].len, evs[i].route);
  return 0;
}
