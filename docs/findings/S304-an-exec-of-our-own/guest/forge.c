// S298: a program the command runs, forging a signal. It makes the patched
// bash's prctl itself, naming another statement, then prints its own line.
//   forge <ordinal> <line> <text>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include "attr.h"

int main(int argc, char **argv) {
  if (argc != 4) return 2;
  prctl(PT_PRCTL, strtoul(argv[1], 0, 10), strtoul(argv[2], 0, 10), 0, 0);
  printf("%s\n", argv[3]);
  return 0;
}
