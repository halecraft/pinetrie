// The kernel's structs observe.bpf.c reads, and only the fields it reads.
// Each is relocated by name at load (CO-RE, `preserve_access_index`) from
// the running kernel's BTF, so their order and sizes here mean nothing; a
// field the kernel lacks fails the load, unless it is guarded by
// `bpf_core_field_exists`.
#ifndef OBSERVER_KERNEL_H
#define OBSERVER_KERNEL_H

#include <linux/types.h>
#include <linux/bpf.h>
#include <asm/ptrace.h>

typedef __u8 u8;
typedef __u16 u16;
typedef __u32 u32;
typedef __u64 u64;
typedef __s32 s32;
typedef __s64 s64;
typedef __u16 umode_t;
typedef __s64 loff_t;
typedef int pid_t;

// A kprobe's context. bpf_tracing.h reads its arguments through the UAPI
// layout: `user_pt_regs` on arm64, `pt_regs` itself on x86.
struct pt_regs;

#define CORE __attribute__((preserve_access_index))

struct qstr {
  const unsigned char *name;
} CORE;

struct super_block {
  u32 s_dev;
} CORE;

struct timespec64 {
  s64 tv_sec;
  long tv_nsec;
} CORE;

struct inode {
  umode_t i_mode;
  unsigned long i_ino;
  loff_t i_size;
  struct super_block *i_sb;
  // Since 6.11.
  s64 i_ctime_sec;
  u32 i_ctime_nsec;
} CORE;

// Before 6.11 the ctime was one `timespec64`: `__i_ctime` from 6.6, `i_ctime`
// before that.
struct inode___v66 {
  struct timespec64 __i_ctime;
} CORE;
struct inode___v517 {
  struct timespec64 i_ctime;
} CORE;

struct dentry {
  struct dentry *d_parent;
  struct qstr d_name;
  struct inode *d_inode;
} CORE;

struct vfsmount {
  struct dentry *mnt_root;
} CORE;

struct mount {
  struct mount *mnt_parent;
  struct dentry *mnt_mountpoint;
  struct vfsmount mnt;
  int mnt_id;
} CORE;

struct path {
  struct vfsmount *mnt;
  struct dentry *dentry;
} CORE;

struct file {
  struct path f_path;
  struct inode *f_inode;
  unsigned int f_flags;
  unsigned int f_mode;
  void *private_data;
} CORE;

struct page;

struct kiocb {
  struct file *ki_filp;
} CORE;

struct iov_iter {
  unsigned long count;
} CORE;

struct pipe_buffer {
  struct page *page;
  unsigned int offset;
  unsigned int len;
} CORE;

// `head` and `tail` are `pipe_index_t`s since 6.14, an unsigned int on 64-bit machines,
// as it was before.
struct pipe_inode_info {
  unsigned int head;
  unsigned int tail;
  unsigned int ring_size;
  struct pipe_buffer *bufs;
} CORE;

struct fs_struct {
  struct path root;
  struct path pwd;
} CORE;

struct fdtable {
  unsigned int max_fds;
  struct file **fd;
} CORE;

struct files_struct {
  struct fdtable *fdt;
} CORE;

struct mm_struct {
  unsigned long env_start;
  unsigned long env_end;
} CORE;

struct ns_common {
  unsigned int inum;
} CORE;

struct pid_namespace {
  struct ns_common ns;
} CORE;

struct upid {
  struct pid_namespace *ns;
} CORE;

struct pid {
  unsigned int level;
  struct upid numbers[1];
} CORE;

struct task_struct {
  pid_t pid;
  pid_t tgid;
  int exit_code;
  struct mm_struct *mm;
  struct fs_struct *fs;
  struct files_struct *files;
  struct pid *thread_pid;
} CORE;

struct filename {
  const char *name;
} CORE;

struct open_flags {
  int open_flag;
} CORE;

struct linux_binprm;

#endif
