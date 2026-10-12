// S172: `timeit <program> [arg]...` runs it and prints its wall time in ms
// to stderr, then exits with its status. Disposable.
#include <stdio.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc < 2) return 2;
  struct timespec a, b;
  clock_gettime(CLOCK_MONOTONIC, &a);
  pid_t p = fork();
  if (p == 0) { execvp(argv[1], argv + 1); _exit(127); }
  int st;
  waitpid(p, &st, 0);
  clock_gettime(CLOCK_MONOTONIC, &b);
  fprintf(stderr, "%.1f\n", ((b.tv_sec - a.tv_sec) * 1e9 + (b.tv_nsec - a.tv_nsec)) / 1e6);
  return WIFEXITED(st) ? WEXITSTATUS(st) : 128;
}
