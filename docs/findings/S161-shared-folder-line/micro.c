// S158's microbenchmark: N stat calls on a missing file, then N open+close of an
// existing one. Prints ns per call for each. Disposable.
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e9 + t.tv_nsec; }
int main(int argc, char **argv) {
  int n = atoi(argv[1]);
  struct stat st;
  double t = now();
  for (int i = 0; i < n; i++) stat("/tmp/does-not-exist", &st);
  double a = (now() - t) / n;
  t = now();
  for (int i = 0; i < n; i++) close(open(argc > 2 ? argv[2] : "/etc/hostname", O_RDONLY));
  double b = (now() - t) / n;
  printf("stat %.0f ns, open+close %.0f ns\n", a, b);
  return 0;
}
