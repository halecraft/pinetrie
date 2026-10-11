// S158's supervisor for one tool call. Disposable.
//   call <done-file> <command>
// Becomes a child subreaper, runs `sh -c <command>`, writes the shell's exit
// status to <done-file> when the shell exits (the tool call is over), then stays
// to reap every descendant left behind, however it detached, and exits when none
// remain. Any process the call started is therefore its descendant.
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/wait.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  prctl(PR_SET_CHILD_SUBREAPER, 1);
  pid_t sh = fork();
  if (sh == 0) {
    execl("/bin/sh", "sh", "-c", argv[2], (char *)0);
    _exit(127);
  }
  int status;
  for (;;) {
    pid_t p = wait(&status);
    if (p == sh) {
      FILE *f = fopen(argv[1], "w");
      fprintf(f, "%d\n", WIFEXITED(status) ? WEXITSTATUS(status) : 128);
      fclose(f);
    } else if (p < 0 && errno == ECHILD) {
      return 0;
    }
  }
}
