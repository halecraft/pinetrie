// S158's supervisor for one tool call, with a seccomp user-notification listener.
// Disposable.
//   seccall <done-file> <log-file> <command>
// As `call`: a child subreaper that runs `sh -c <command>`, writes the shell's exit
// status to <done-file>, and stays until every descendant is gone. Before the
// shell starts, it installs a seccomp filter that sends each file-naming syscall
// (open, stat, access, rename, unlink, mkdir, link, symlink) to this process. The
// filter is inherited by every descendant and cannot be removed, so it follows
// daemons, static binaries and `env -i`. Each call is logged as
// `<pid> <op> <flags> <exists> <absolute path>` while the caller waits, then
// continued unchanged. Needs no capability.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <pthread.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <unistd.h>

static const int WATCHED[] = {
    __NR_openat, __NR_openat2, __NR_newfstatat, __NR_statx, __NR_faccessat, __NR_faccessat2,
    __NR_renameat, __NR_renameat2, __NR_unlinkat, __NR_mkdirat, __NR_linkat, __NR_symlinkat,
    __NR_readlinkat,
};
#define NW (int)(sizeof WATCHED / sizeof WATCHED[0])

static int install(void) {
  struct sock_filter f[4 + 2 * NW];
  int n = 0;
  f[n++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch));
  f[n++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_AARCH64, 1, 0);
  f[n++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  f[n++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
  // SECCALL_OPENS_ONLY: leave stat, access and readlink unwatched, for their cost.
  int opens_only = getenv("SECCALL_OPENS_ONLY") != 0;
  for (int i = 0; i < NW; i++) {
    int nr = WATCHED[i];
    if (opens_only && (nr == __NR_newfstatat || nr == __NR_statx || nr == __NR_faccessat ||
                       nr == __NR_faccessat2 || nr == __NR_readlinkat))
      continue;
    f[n++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, WATCHED[i], 0, 1);
    f[n++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_USER_NOTIF);
  }
  struct sock_filter all[sizeof f / sizeof f[0] + 1];
  memcpy(all, f, n * sizeof f[0]);
  all[n++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  struct sock_fprog prog = {.len = (unsigned short)n, .filter = all};
  prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
  return syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_NEW_LISTENER, &prog);
}

static void send_fd(int sock, int fd) {
  char c = 0;
  struct iovec io = {.iov_base = &c, .iov_len = 1};
  char buf[CMSG_SPACE(sizeof(int))];
  struct msghdr m = {.msg_iov = &io, .msg_iovlen = 1, .msg_control = buf, .msg_controllen = sizeof buf};
  struct cmsghdr *h = CMSG_FIRSTHDR(&m);
  h->cmsg_level = SOL_SOCKET;
  h->cmsg_type = SCM_RIGHTS;
  h->cmsg_len = CMSG_LEN(sizeof(int));
  memcpy(CMSG_DATA(h), &fd, sizeof fd);
  sendmsg(sock, &m, 0);
}

static int recv_fd(int sock) {
  char c;
  struct iovec io = {.iov_base = &c, .iov_len = 1};
  char buf[CMSG_SPACE(sizeof(int))];
  struct msghdr m = {.msg_iov = &io, .msg_iovlen = 1, .msg_control = buf, .msg_controllen = sizeof buf};
  if (recvmsg(sock, &m, 0) <= 0) return -1;
  int fd;
  memcpy(&fd, CMSG_DATA(CMSG_FIRSTHDR(&m)), sizeof fd);
  return fd;
}

static int read_str(pid_t pid, unsigned long addr, char *out, size_t cap) {
  struct iovec local = {.iov_base = out, .iov_len = cap - 1};
  struct iovec remote = {.iov_base = (void *)addr, .iov_len = cap - 1};
  ssize_t got = process_vm_readv(pid, &local, 1, &remote, 1, 0);
  if (got <= 0) {
    // The string may end before a page the process has not mapped: read less.
    remote.iov_len = local.iov_len = 4096 - (addr % 4096);
    got = process_vm_readv(pid, &local, 1, &remote, 1, 0);
    if (got <= 0) return -1;
  }
  out[got] = 0;
  return 0;
}

static void resolve(pid_t pid, long dirfd, const char *p, char *out, size_t cap) {
  if (p[0] == '/') {
    snprintf(out, cap, "%s", p);
    return;
  }
  char link[64], base[4096];
  if ((int)dirfd == AT_FDCWD) snprintf(link, sizeof link, "/proc/%d/cwd", pid);
  else snprintf(link, sizeof link, "/proc/%d/fd/%ld", pid, dirfd);
  ssize_t n = readlink(link, base, sizeof base - 1);
  if (n < 0) n = 0;
  base[n] = 0;
  if (p[0] == 0) snprintf(out, cap, "%s", base);
  else snprintf(out, cap, "%s/%s", base, p);
}

static int notify_fd;
static FILE *logf;

static void *listen_loop(void *arg) {
  (void)arg;
  struct seccomp_notif_sizes sz;
  syscall(__NR_seccomp, SECCOMP_GET_NOTIF_SIZES, 0, &sz);
  struct seccomp_notif *req = calloc(1, sz.seccomp_notif);
  struct seccomp_notif_resp *resp = calloc(1, sz.seccomp_notif_resp);
  char s1[4096], s2[4096], a1[8192], a2[8192];
  for (;;) {
    memset(req, 0, sz.seccomp_notif);
    if (ioctl(notify_fd, SECCOMP_IOCTL_NOTIF_RECV, req) < 0) {
      // ENOENT: the caller died before its notice was read. Stopping here
      // would leave every later caller waiting forever.
      if (errno == EINTR || errno == ENOENT) continue;
      break;
    }
    pid_t pid = req->pid;
    int nr = req->data.nr;
    unsigned long long *a = req->data.args;
    const char *op = "?";
    long flags = 0;
    a1[0] = a2[0] = 0;
    // (dirfd, path) for most; two paths for rename and link; symlinkat names (target, dirfd, path).
    if (nr == __NR_symlinkat) {
      op = "symlink";
      if (read_str(pid, a[2], s1, sizeof s1) == 0) resolve(pid, (long)a[1], s1, a1, sizeof a1);
    } else {
      if (read_str(pid, a[1], s1, sizeof s1) == 0) resolve(pid, (long)a[0], s1, a1, sizeof a1);
      if (nr == __NR_openat) op = "open", flags = (long)a[2];
      else if (nr == __NR_openat2) {
        op = "open";
        unsigned long long how[3];
        struct iovec l = {how, sizeof how}, r = {(void *)a[2], sizeof how};
        if (process_vm_readv(pid, &l, 1, &r, 1, 0) > 0) flags = (long)how[0];
      } else if (nr == __NR_newfstatat || nr == __NR_statx) op = "stat";
      else if (nr == __NR_faccessat || nr == __NR_faccessat2) op = "access";
      else if (nr == __NR_readlinkat) op = "readlink";
      else if (nr == __NR_unlinkat) op = "unlink";
      else if (nr == __NR_mkdirat) op = "mkdir";
      else if (nr == __NR_renameat || nr == __NR_renameat2 || nr == __NR_linkat) {
        op = nr == __NR_linkat ? "link" : "rename";
        if (read_str(pid, a[3], s2, sizeof s2) == 0) resolve(pid, (long)a[2], s2, a2, sizeof a2);
      }
    }
    struct stat st;
    int exists = a1[0] && lstat(a1, &st) == 0;
    if (a1[0]) fprintf(logf, "%d %s %lx %d %s%s%s\n", pid, op, flags, exists, a1, a2[0] ? "\t" : "", a2);
    memset(resp, 0, sz.seccomp_notif_resp);
    resp->id = req->id;
    resp->flags = SECCOMP_USER_NOTIF_FLAG_CONTINUE;
    ioctl(notify_fd, SECCOMP_IOCTL_NOTIF_SEND, resp);
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 4) return 2;
  prctl(PR_SET_CHILD_SUBREAPER, 1);
  logf = fopen(argv[2], "w");
  setvbuf(logf, 0, _IOFBF, 1 << 20);
  int sv[2];
  socketpair(AF_UNIX, SOCK_STREAM, 0, sv);
  pid_t sh = fork();
  if (sh == 0) {
    close(sv[0]);
    int fd = install();
    if (fd < 0) _exit(126);
    send_fd(sv[1], fd);
    close(fd);
    char ok;
    if (read(sv[1], &ok, 1) != 1) _exit(125);
    execl("/bin/sh", "sh", "-c", argv[3], (char *)0);
    _exit(127);
  }
  close(sv[1]);
  notify_fd = recv_fd(sv[0]);
  pthread_t t;
  pthread_create(&t, 0, listen_loop, 0);
  write(sv[0], "", 1);
  int status;
  for (;;) {
    pid_t p = wait(&status);
    if (p == sh) {
      FILE *f = fopen(argv[1], "w");
      fprintf(f, "%d\n", WIFEXITED(status) ? WEXITSTATUS(status) : 128);
      fclose(f);
    } else if (p < 0 && errno == ECHILD) {
      fflush(logf);
      return 0;
    }
  }
}
