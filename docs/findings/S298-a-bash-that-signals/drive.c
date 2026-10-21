// S298's driver: runs `<bash> -c "$(cat <cmd>)"` as pi does (stdin /dev/null,
// stdout and stderr into one watched pipe) and prints the stream and the
// events as hex and lines, for guest.py to check. It checks nothing itself.
//   drive signal <bash> <cmd>   registers the shell, so its signals are taken
//   drive uprobe <bash> <cmd>   registers nothing; a uprobe reads <bash>'s nodes
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

int main(int argc, char **argv) {
  if (argc != 4) return 2;
  int signal_mode = strcmp(argv[1], "signal") == 0;
  const char *bash = argv[2];
  struct rlimit inf = {RLIM_INFINITY, RLIM_INFINITY};
  setrlimit(RLIMIT_MEMLOCK, &inf);
  evs = calloc(MAX_EVENTS, sizeof *evs);
  struct attr_bpf *skel = attr_bpf__open();
  if (!skel) { perror("open"); return 1; }
  bpf_program__set_autoattach(skel->progs.on_node, false);
  if (attr_bpf__load(skel)) { perror("load"); return 1; }
  if (attr_bpf__attach(skel)) { perror("attach"); return 1; }
  if (!signal_mode) {
    LIBBPF_OPTS(bpf_uprobe_opts, uo, .func_name = "execute_command_internal");
    struct bpf_link *l = bpf_program__attach_uprobe_opts(skel->progs.on_node, -1, bash, 0, &uo);
    if (!l) { fprintf(stderr, "uprobe: %s\n", strerror(errno)); return 1; }
  }

  int p[2], go[2];
  pipe(p);
  pipe(go);
  struct stat st;
  fstat(p[1], &st);
  unsigned k = 0;
  struct cfg c = {.ino = st.st_ino};
  bpf_map__update_elem(skel->maps.cfgs, &k, sizeof k, &c, sizeof c, 0);

  pid_t reader = fork();
  if (reader == 0) {
    // Holding the start pipe would keep the shell from ever starting.
    close(go[0]);
    close(go[1]);
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
  char *cmd = slurp(argv[3], &clen);
  pid_t sh = fork();
  if (sh == 0) {
    // Wait until the driver has registered this tid, then become the shell.
    char x;
    close(go[1]);
    read(go[0], &x, 1);
    int null = open("/dev/null", O_RDONLY);
    dup2(null, 0);
    dup2(p[1], 1);
    dup2(p[1], 2);
    close(p[1]);
    execl(bash, "bash", "-c", cmd, (char *)NULL);
    _exit(127);
  }
  close(go[0]);
  if (signal_mode) {
    unsigned tid = (unsigned)sh;
    unsigned char one = 1;
    bpf_map__update_elem(skel->maps.pending, &tid, sizeof tid, &one, sizeof one, 0);
  }
  close(go[1]);
  close(p[1]);
  int status;
  waitpid(sh, &status, 0);
  waitpid(reader, NULL, 0);  // after every background job let the pipe go
  usleep(200000);
  stop_ring = 1;
  pthread_join(ring, NULL);

  size_t n;
  char *s = slurp("/tmp/stream", &n);
  printf("exit %d\n", WEXITSTATUS(status));
  printf("stream ");
  for (size_t i = 0; i < n; i++) printf("%02x", (unsigned char)s[i]);
  printf("\n");
  for (size_t i = 0; i < nev; i++)
    printf("ev %u %u %u %u %u\n", evs[i].tag.stmt, evs[i].tag.line, evs[i].writer, evs[i].len, evs[i].route);
  return 0;
}
