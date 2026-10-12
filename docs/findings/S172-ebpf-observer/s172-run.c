// S172: a run's marker. `s172-run <run> <program> [arg]...` execs <program>:
// the observer tags this process with <run> at this exec, and every process
// it starts after. Disposable.
#include <stdio.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc < 3) return 2;
  execvp(argv[2], argv + 2);
  perror("s172-run");
  return 127;
}
