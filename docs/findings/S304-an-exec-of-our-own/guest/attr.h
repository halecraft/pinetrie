// S304's events: bytes that entered a run's stdout or stderr pipe, and the
// statement their writer was tagged with; and each signal, taken or refused.
// The pipes are learned from the shell's descriptors 1 and 2 at its exec.
#ifndef S304_ATTR_H
#define S304_ATTR_H

// The prctl option the patched bash signals with: no kernel implements it.
#define PT_PRCTL 0x50540001

enum route {
  ROUTE_WRITE = 1,
  ROUTE_LOCKED = 2,
  ROUTE_ORPHAN = 3,
  ROUTE_LOST = 4,
  ROUTE_SIGNAL = 5,   // a signal taken: tag is what it set
  ROUTE_REFUSED = 6,  // a signal from a task not allowed to signal
};

struct sigtag {
  unsigned int stmt;  // ordinal among the -c string's top-level statements; 0: none yet
  unsigned int line;
};

struct ev {
  struct sigtag tag;
  unsigned int writer;
  unsigned int len;
  unsigned int route;
  unsigned int fd;    // the descriptor the pipe was the shell's: 1, 2, or 3 for both
};

// A run's output pipe, by its pipe_inode_info: which descriptor it was the
// shell's, and the head below which its buffers are attributed.
struct output {
  unsigned int fd;
  unsigned int seen_head;
};

#endif
