// What observe.bpf.c sends through its ring, read by observe.c: one layout
// for both, so neither can drift from the other.
#ifndef OBSERVER_OBSERVE_H
#define OBSERVER_OBSERVE_H

#ifndef OBSERVER_KERNEL_H
#include <stdint.h>
typedef uint32_t u32;
typedef uint64_t u64;
typedef int64_t s64;
#endif

// A path's components, at most MAXC of at most NAMEMAX bytes each.
#define MAXC 64
#define PATHMAX 4096
#define NAMEMAX 256

enum event_kind { EV_OPEN = 1, EV_RELEASE, EV_UNLINK, EV_MKDIR, EV_RENAME, EV_SYMLINK, EV_LINK, EV_EXIT, EV_END };

// What was at a path before the call: core's PathKind.
enum path_kind { PK_MISSING = 0, PK_FILE, PK_DIR, PK_LINK, PK_OTHER };

// A run: its number, and its lane, the PID namespace it began in.
struct run_key {
  u64 lane;
  u64 run;
};

struct pathbuf {
  u32 n;    // components, leaf first, each ending in a NUL
  u32 cut;  // 1 if the path was cut short
  u32 len;  // bytes of buf used
  u32 abs;  // 1 if the one component is an absolute path, as an open named it
  char buf[PATHMAX + NAMEMAX];
};

struct event {
  u32 kind;
  u32 pid;  // the process's, in the machine's pid namespace
  struct run_key run;
  u64 fid;  // the struct file, joining an open to its release
  u64 ino;
  s64 size;  // -1 for no inode
  s64 ctime_sec;
  u32 ctime_nsec;
  u32 flags;  // open and release: f_flags; rename: its flags
  u32 before;
  u32 before2;
  u32 status;  // exit: the shell's status
  u32 pad;
  u64 ts;  // bpf_ktime_get_ns: CLOCK_MONOTONIC
  struct pathbuf a;
  struct pathbuf b;  // a rename's and a link's target
};

#endif
