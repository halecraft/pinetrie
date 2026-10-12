// S172: `mmapw <file>` writes 8 KiB through a shared mapping, closes the
// descriptor first, then writes again before unmapping. Disposable.
#include <fcntl.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
int main(int argc, char **argv) {
  (void)argc;
  int fd = open(argv[1], O_RDWR | O_CREAT | O_TRUNC, 0644);
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
