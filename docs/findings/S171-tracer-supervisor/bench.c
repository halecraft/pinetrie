// S171: the cost of a watched call. Disposable.
//   bench <file> <calls>   opens and closes <file> <calls> times; prints ns per open+close.
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>
int main(int argc, char **argv) {
  long n = atol(argv[2]);
  struct timespec a, b;
  clock_gettime(CLOCK_MONOTONIC, &a);
  for (long i = 0; i < n; i++) {
    int fd = open(argv[1], O_RDONLY);
    if (fd >= 0) close(fd);
  }
  clock_gettime(CLOCK_MONOTONIC, &b);
  printf("%.0f ns per open and close\n", ((b.tv_sec - a.tv_sec) * 1e9 + (b.tv_nsec - a.tv_nsec)) / n);
  return 0;
}
