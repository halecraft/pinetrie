// S172: `uring <file>` creates <file> with an io_uring openat and writes it
// with an io_uring write. Prints "uring: <error>" if io_uring is refused.
// Disposable.
#include <fcntl.h>
#include <liburing.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  (void)argc;
  struct io_uring r;
  int e = io_uring_queue_init(4, &r, 0);
  if (e < 0) { printf("uring: %s\n", strerror(-e)); return 3; }
  struct io_uring_sqe *s = io_uring_get_sqe(&r);
  io_uring_prep_openat(s, AT_FDCWD, argv[1], O_WRONLY | O_CREAT | O_TRUNC, 0644);
  io_uring_submit(&r);
  struct io_uring_cqe *c;
  io_uring_wait_cqe(&r, &c);
  int fd = c->res;
  io_uring_cqe_seen(&r, c);
  if (fd < 0) { printf("uring: openat %s\n", strerror(-fd)); return 4; }
  s = io_uring_get_sqe(&r);
  io_uring_prep_write(s, fd, "u\n", 2, 0);
  io_uring_submit(&r);
  io_uring_wait_cqe(&r, &c);
  io_uring_cqe_seen(&r, c);
  close(fd);
  printf("uring: ok\n");
  return 0;
}
