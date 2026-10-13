// work: the observer suite's workloads that a shell cannot make, static.
//   work threads <dir> <n>   writes <dir>/t<i> from each of <n> threads
//   work mmap <file>         writes 8 KiB through a shared mapping, half of it after the close
//   work uring <file>        creates and writes <file> by io_uring alone
//   work opens <file> <n>    opens and closes <file> <n> times, read-only
//   work stamp <file>...     prints each file's `<path>\t<size>:<ctime ns>\t<inode>`
#include <fcntl.h>
#include <liburing.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *dir;

static void *one(void *arg) {
  char p[4096];
  snprintf(p, sizeof p, "%s/t%ld", dir, (long)arg);
  int fd = open(p, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd >= 0) {
    if (write(fd, "t\n", 2) < 0) {}
    close(fd);
  }
  return NULL;
}

static int threads(int n) {
  pthread_t t[64];
  for (long i = 0; i < n && i < 64; i++) pthread_create(&t[i], NULL, one, (void *)i);
  for (int i = 0; i < n && i < 64; i++) pthread_join(t[i], NULL);
  return 0;
}

static int mapped(const char *file) {
  int fd = open(file, O_RDWR | O_CREAT | O_TRUNC, 0644);
  if (fd < 0 || ftruncate(fd, 8192) != 0) return 1;
  char *m = mmap(NULL, 8192, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  if (m == MAP_FAILED) return 1;
  close(fd);
  memset(m, 'a', 4096);
  usleep(20000);
  memset(m + 4096, 'b', 4096);
  munmap(m, 8192);
  return 0;
}

static int uring(const char *file) {
  struct io_uring r;
  int e = io_uring_queue_init(4, &r, 0);
  if (e < 0) {
    printf("uring: %s\n", strerror(-e));
    return 3;
  }
  struct io_uring_sqe *s = io_uring_get_sqe(&r);
  // Forced async, so a worker thread, not this one, opens and writes.
  io_uring_prep_openat(s, AT_FDCWD, file, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  io_uring_sqe_set_flags(s, IOSQE_ASYNC);
  io_uring_submit(&r);
  struct io_uring_cqe *c;
  io_uring_wait_cqe(&r, &c);
  int fd = c->res;
  io_uring_cqe_seen(&r, c);
  if (fd < 0) {
    printf("uring: openat %s\n", strerror(-fd));
    return 4;
  }
  s = io_uring_get_sqe(&r);
  io_uring_prep_write(s, fd, "u\n", 2, 0);
  io_uring_sqe_set_flags(s, IOSQE_ASYNC);
  io_uring_submit(&r);
  io_uring_wait_cqe(&r, &c);
  io_uring_cqe_seen(&r, c);
  close(fd);
  return 0;
}

static int opens(const char *file, long n) {
  for (long i = 0; i < n; i++) {
    int fd = open(file, O_RDONLY);
    if (fd >= 0) close(fd);
  }
  return 0;
}

static int stamps(int argc, char **argv) {
  for (int i = 0; i < argc; i++) {
    struct stat st;
    if (lstat(argv[i], &st) != 0) {
      printf("%s\t-\t-\n", argv[i]);
      continue;
    }
    printf("%s\t%lld:%lld\t%llu\n", argv[i], (long long)st.st_size,
           (long long)st.st_ctim.tv_sec * 1000000000LL + st.st_ctim.tv_nsec, (unsigned long long)st.st_ino);
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 3) return 2;
  const char *what = argv[1];
  if (strcmp(what, "threads") == 0 && argc == 4) {
    dir = argv[2];
    return threads(atoi(argv[3]));
  }
  if (strcmp(what, "mmap") == 0) return mapped(argv[2]);
  if (strcmp(what, "uring") == 0) return uring(argv[2]);
  if (strcmp(what, "opens") == 0 && argc == 4) return opens(argv[2], atol(argv[3]));
  if (strcmp(what, "stamp") == 0) return stamps(argc - 2, argv + 2);
  return 2;
}
