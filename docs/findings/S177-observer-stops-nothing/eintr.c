// S170, question 1: which supervised calls a signal can cut short with EINTR.
// Disposable.
//   eintr <dir> <rounds>
// A SIGALRM every 50 µs, through a handler installed without SA_RESTART, as
// dash's SIGCHLD is. Each round makes every call the supervisor watches, on
// files under <dir>, and counts each one that failed with EINTR. Unsupervised,
// none of these calls returns EINTR on a regular file.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static void tick(int s) { (void)s; }

enum { OPEN_W, OPEN_R, DUP3, CLOSE, RENAME, UNLINK, MKDIR, RMDIR, N };
static const char *names[N] = {"openat(write)", "openat(read)", "dup3", "close", "renameat", "unlinkat", "mkdirat", "unlinkat(dir)"};
static long eintr[N], calls[N];

#define CALL(k, expr) ({ long r_; calls[k]++; do { r_ = (long)(expr); if (r_ < 0 && errno == EINTR) eintr[k]++; } while (r_ < 0 && errno == EINTR); r_; })

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  const char *dir = argv[1];
  long rounds = atol(argv[2]);
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = tick;
  sa.sa_flags = 0;
  sigaction(SIGALRM, &sa, NULL);
  timer_t t;
  struct sigevent ev = {.sigev_notify = SIGEV_SIGNAL, .sigev_signo = SIGALRM};
  timer_create(CLOCK_MONOTONIC, &ev, &t);
  struct itimerspec its = {.it_interval = {0, 50000}, .it_value = {0, 50000}};
  timer_settime(t, 0, &its, NULL);
  char f[4096], g[4096], d[4096];
  snprintf(f, sizeof f, "%s/f", dir);
  snprintf(g, sizeof g, "%s/g", dir);
  snprintf(d, sizeof d, "%s/d", dir);
  for (long i = 0; i < rounds; i++) {
    int fd = (int)CALL(OPEN_W, open(f, O_WRONLY | O_CREAT | O_TRUNC, 0644));
    if (fd >= 0) {
      if (write(fd, "x", 1) < 0) {}
      int fd2 = (int)CALL(DUP3, dup3(fd, 50, 0));
      if (fd2 >= 0) CALL(CLOSE, close(fd2));
      CALL(CLOSE, close(fd));
    }
    int r = (int)CALL(OPEN_R, open(f, O_RDONLY));
    if (r >= 0) CALL(CLOSE, close(r));
    CALL(RENAME, rename(f, g));
    CALL(UNLINK, unlink(g));
    CALL(MKDIR, mkdir(d, 0755));
    CALL(RMDIR, rmdir(d));
  }
  for (int k = 0; k < N; k++) printf("%-15s %9ld calls %7ld EINTR\n", names[k], calls[k], eintr[k]);
  return 0;
}
