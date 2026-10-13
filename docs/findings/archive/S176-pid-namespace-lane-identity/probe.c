#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/nsfs.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

static unsigned long long inode_of(int fd) {
  struct stat st;
  if (fstat(fd, &st) != 0) { perror("fstat"); exit(1); }
  return (unsigned long long)st.st_ino;
}

static int open_ns(pid_t pid) {
  char path[64];
  snprintf(path, sizeof path, "/proc/%d/ns/pid", pid);
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) { perror(path); exit(1); }
  return fd;
}

static void chain(int fd) {
  printf("chain %llu", inode_of(fd));
  for (;;) {
    int parent = ioctl(fd, NS_GET_PARENT);
    if (parent < 0) {
      if (errno != EPERM) printf(" error=%s", strerror(errno));
      break;
    }
    printf(" %llu", inode_of(parent));
    close(fd);
    fd = parent;
  }
  printf("\n");
  close(fd);
}

static void pin(void) {
  int ready[2], done[2];
  if (pipe(ready) || pipe(done)) { perror("pipe"); exit(1); }
  pid_t child = fork();
  if (child < 0) { perror("fork"); exit(1); }
  if (child == 0) {
    close(ready[0]); close(done[1]);
    if (unshare(CLONE_NEWPID) != 0) { perror("unshare"); _exit(1); }
    pid_t init = fork();
    if (init < 0) { perror("fork init"); _exit(1); }
    if (init == 0) { char c = 'x'; write(ready[1], &c, 1); read(done[0], &c, 1); _exit(0); }
    close(ready[1]); close(done[0]);
    waitpid(init, NULL, 0);
    _exit(0);
  }
  close(ready[1]); close(done[0]);
  char c;
  if (read(ready[0], &c, 1) != 1) { fprintf(stderr, "child did not enter namespace\n"); exit(1); }
  char children[64];
  snprintf(children, sizeof children, "/proc/%d/task/%d/children", child, child);
  FILE *f = fopen(children, "re");
  int init = 0;
  if (!f || fscanf(f, "%d", &init) != 1) { perror(children); exit(1); }
  fclose(f);
  int fd = open_ns(init);
  unsigned long long ino = inode_of(fd);
  printf("pin before=%llu pid=%d\n", ino, init);
  close(done[1]);
  waitpid(child, NULL, 0);
  printf("pin after=%llu processes=gone fd=open\n", inode_of(fd));
  chain(dup(fd));
  close(fd);
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "pin") == 0) { pin(); return 0; }
  if (argc == 3 && strcmp(argv[1], "chain") == 0) { chain(open_ns(atoi(argv[2]))); return 0; }
  fprintf(stderr, "usage: %s pin | chain PID\n", argv[0]);
  return 2;
}
