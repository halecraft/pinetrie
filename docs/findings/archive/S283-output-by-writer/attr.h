// S283's event: bytes that entered the watched pipe, by whom, in the pipe's order.
#ifndef S283_ATTR_H
#define S283_ATTR_H

enum route {
  ROUTE_WRITE = 1,   // anon_pipe_write's copy (write, writev, io_uring write)
  ROUTE_LOCKED = 2,  // buffers a pipe_lock holder added (splice, sendfile, vmsplice, tee)
  ROUTE_ORPHAN = 3,  // buffers found unattributed where none should be: a probe bug
  ROUTE_LOST = 4,    // the accounted head ran past the real one: bytes counted that never landed
};

struct ev {
  unsigned int step;  // 0: an untagged writer
  unsigned int tid;
  unsigned int len;
  unsigned int route;
};

struct cfg {
  unsigned long long ino;   // the watched pipe's inode, set by the driver
  unsigned long long pipe;  // its pipe_inode_info, learned at its first write
  unsigned int seen_head;   // buffers below it are attributed; changed only under the pipe's lock
  unsigned int pad;
};

#endif
