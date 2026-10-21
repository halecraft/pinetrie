// S298's events: bytes that entered the watched pipe and the statement their
// writer was tagged with; each signal, taken or refused; and, from a uprobe
// on a stock bash, each command node it ran.
#ifndef S298_ATTR_H
#define S298_ATTR_H

// The prctl option the patched bash signals with: no kernel implements it.
#define PT_PRCTL 0x50540001

enum route {
  ROUTE_WRITE = 1,
  ROUTE_LOCKED = 2,
  ROUTE_ORPHAN = 3,
  ROUTE_LOST = 4,
  ROUTE_SIGNAL = 5,   // a signal taken: tag is what it set
  ROUTE_REFUSED = 6,  // a signal from a task not allowed to signal
  ROUTE_NODE = 7,     // a uprobe hit: tag is the node's type and line, len its flags
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
  unsigned int pad;
};

struct cfg {
  unsigned long long ino;   // the watched pipe's inode
  unsigned long long pipe;  // its pipe_inode_info, learned at its first write
  unsigned int seen_head;
  unsigned int pad;
};

#endif
