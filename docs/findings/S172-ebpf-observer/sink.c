// S172: `sink <socket>` accepts on a unix socket and discards what it is
// sent: the listener for supervise.c's records, for the cost comparison.
// Disposable.
#include <pthread.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <string.h>
#include <unistd.h>
static void *drain(void *a) {
  int c = (int)(long)a;
  char b[65536];
  while (read(c, b, sizeof b) > 0) {}
  close(c);
  return NULL;
}
int main(int argc, char **argv) {
  (void)argc;
  int s = socket(AF_UNIX, SOCK_STREAM, 0);
  struct sockaddr_un a = {.sun_family = AF_UNIX};
  strncpy(a.sun_path, argv[1], sizeof a.sun_path - 1);
  unlink(argv[1]);
  if (bind(s, (struct sockaddr *)&a, sizeof a) != 0 || listen(s, 64) != 0) return 1;
  for (;;) {
    int c = accept(s, NULL, NULL);
    if (c < 0) continue;
    pthread_t t;
    pthread_create(&t, NULL, drain, (void *)(long)c);
    pthread_detach(t);
  }
}
