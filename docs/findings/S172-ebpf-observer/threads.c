// S172: `threads <dir> <n>` writes <dir>/t<i> from each of <n> threads. Disposable.
#include <fcntl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
static const char *dir;
static void *one(void *arg) {
  char p[4096];
  snprintf(p, sizeof p, "%s/t%ld", dir, (long)arg);
  int fd = open(p, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd >= 0) { if (write(fd, "t\n", 2) < 0) {} close(fd); }
  return NULL;
}
int main(int argc, char **argv) {
  (void)argc;
  dir = argv[1];
  int n = atoi(argv[2]);
  pthread_t t[64];
  for (long i = 0; i < n && i < 64; i++) pthread_create(&t[i], NULL, one, (void *)i);
  for (int i = 0; i < n && i < 64; i++) pthread_join(t[i], NULL);
  return 0;
}
