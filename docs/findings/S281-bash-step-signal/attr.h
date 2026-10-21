// S281's event: bytes that entered the watched pipe, and the signal that
// tagged their writer. A signal is named by the task that wrote it and its
// count among that task's signals, so the host finds it as that task's k-th
// line in the marker file, however tasks' lines interleave there.
#ifndef S281_ATTR_H
#define S281_ATTR_H

enum route {
  ROUTE_WRITE = 1,
  ROUTE_LOCKED = 2,
  ROUTE_ORPHAN = 3,
  ROUTE_LOST = 4,
};

struct sigtag {
  unsigned int tid;  // 0: no signal yet in this task's line
  unsigned int k;    // 1 for the task's first signal
};

struct ev {
  struct sigtag tag;
  unsigned int writer;
  unsigned int len;
  unsigned int route;
  unsigned int pad;
};

struct cfg {
  unsigned long long ino;       // the watched pipe's inode
  unsigned long long pipe;      // its pipe_inode_info, learned at its first write
  unsigned long long mark_ino;  // the marker file's inode
  unsigned int seen_head;
  unsigned int pad;
};

#endif
