// pine·trie's mkfifo, built static beside its bash and copied out with it to
// the lane runtime's `shell/` (`packages/lanes/runtime.ts`): each path named
// becomes a FIFO only its owner may open. The lane helper makes a `bash`
// call's stdout and stderr with it, so they are pipes, which the observer
// attributes, on any image, whether or not it has a `mkfifo` of its own.
#include <stdio.h>
#include <sys/stat.h>

int main(int argc, char **argv) {
  if (argc < 2) {
    fputs("usage: mkfifo PATH...\n", stderr);
    return 2;
  }
  for (int i = 1; i < argc; i++)
    if (mkfifo(argv[i], 0600) != 0) {
      perror(argv[i]);
      return 1;
    }
  return 0;
}
