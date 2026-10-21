// S304's driver: runs `<bash> -c "$(cat <cmd>)"` as pi does (stdin
// /dev/null, stdout and stderr each a pipe of its own), registering only the
// shell, so the kernel must learn both pipes from its descriptors. Prints
// each pipe's stream and the events, for guest.py to check.
//   drive <bash> <cmd>
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

// A reader of one pipe, into a file, until every writer has let it go.
static pid_t reader(int rd, int close1, int close2, const char *path) {
  pid_t r = fork();
  if (r != 0) return r;
  close(close1);
  close(close2);
  size_t cap = 1 << 24, n = 0;
  char *s = malloc(cap);
  for (ssize_t k; (k = read(rd, s + n, cap - n)) != 0;) {
    if (k < 0) { if (errno == EINTR) continue; _exit(1); }
    n += (size_t)k;
  }
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  write(fd, s, n);
  _exit(0);
}

static void hex(const char *label, const char *s, size_t n) {
  printf("%s ", label);
  for (size_t i = 0; i < n; i++) printf("%02x", (unsigned char)s[i]);
  printf("\n");
}

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  const char *bash = argv[1];
  struct rlimit inf = {RLIM_INFINITY, RLIM_INFINITY};
  setrlimit(RLIMIT_MEMLOCK, &inf);
  evs = calloc(MAX_EVENTS, sizeof *evs);
  struct attr_bpf *skel = attr_bpf__open_and_load();
  if (!skel) { perror("load"); return 1; }
  if (attr_bpf__attach(skel)) { perror("attach"); return 1; }

  int o[2], e[2], go[2];
  pipe(o);
  pipe(e);
  pid_t ro = reader(o[0], o[1], e[1], "/tmp/stdout");
  pid_t re = reader(e[0], o[1], e[1], "/tmp/stderr");
  close(o[0]);
  close(e[0]);
  // Made after the readers: one holding it would keep the shell from starting.
  pipe(go);
  struct ring_buffer *rb = ring_buffer__new(bpf_map__fd(skel->maps.events), on_event, NULL, NULL);
  pthread_t ring;
  pthread_create(&ring, NULL, ring_loop, rb);

  size_t clen;
  char *cmd = slurp(argv[2], &clen);
  pid_t sh = fork();
  if (sh == 0) {
    // Wait until the driver has registered this tid, then become the shell.
    char x;
    close(go[1]);
    read(go[0], &x, 1);
    int null = open("/dev/null", O_RDONLY);
    dup2(null, 0);
    dup2(o[1], 1);
    dup2(e[1], 2);
    close(o[1]);
    close(e[1]);
    execl(bash, "bash", "-c", cmd, (char *)NULL);
    _exit(127);
  }
  close(go[0]);
  unsigned tid = (unsigned)sh;
  unsigned char one = 1;
  bpf_map__update_elem(skel->maps.pending, &tid, sizeof tid, &one, sizeof one, 0);
  close(go[1]);
  close(o[1]);
  close(e[1]);
  int status;
  waitpid(sh, &status, 0);
  waitpid(ro, NULL, 0);
  waitpid(re, NULL, 0);
  usleep(200000);
  stop_ring = 1;
  pthread_join(ring, NULL);

  size_t n1, n2;
  char *s1 = slurp("/tmp/stdout", &n1);
  char *s2 = slurp("/tmp/stderr", &n2);
  printf("exit %d\n", WEXITSTATUS(status));
  hex("stdout", s1, n1);
  hex("stderr", s2, n2);
  for (size_t i = 0; i < nev; i++)
    printf("ev %u %u %u %u %u %u\n", evs[i].tag.stmt, evs[i].tag.line, evs[i].writer, evs[i].len, evs[i].route, evs[i].fd);
  return 0;
}
