// S171: the supervisor as every process's tracer. Disposable.
//   tracer <program> [arg]...
// Installs, in the child, a seccomp filter that returns SECCOMP_RET_TRACE for
// the calls supervise.c watches, then seizes it: each watched call stops its
// process at entry, and the tracer reads its path, resolves it and lstat()s
// it, as supervise.c does, then continues it. Follows forks, clones and execs,
// passes signals on, keeps group stops (PTRACE_LISTEN), and stays until every
// traced process has gone. Prints how many stops it served to stderr.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/elf.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/ptrace.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <unistd.h>
#include <asm/ptrace.h>

static const int WATCHED[] = {__NR_openat, __NR_openat2, __NR_renameat, __NR_renameat2, __NR_unlinkat,
                              __NR_mkdirat, __NR_linkat, __NR_symlinkat, __NR_close, __NR_dup3};
#define NW (int)(sizeof WATCHED / sizeof WATCHED[0])

static int install(void) {
  struct sock_filter f[4 + 2 * NW + 1];
  int n = 0;
  f[n++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch));
  f[n++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_AARCH64, 1, 0);
  f[n++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  f[n++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
  for (int i = 0; i < NW; i++) {
    f[n++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (unsigned)WATCHED[i], 0, 1);
    f[n++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_TRACE);
  }
  f[n++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  struct sock_fprog prog = {.len = (unsigned short)n, .filter = f};
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return -1;
  return (int)syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, 0, &prog);
}

static long stops;

// The work supervise.c does for a call: its path read, resolved, lstat()ed.
static void handle(pid_t pid) {
  struct user_pt_regs regs;
  struct iovec io = {&regs, sizeof regs};
  if (ptrace(PTRACE_GETREGSET, pid, NT_PRSTATUS, &io) != 0) return;
  stops++;
  int nr = (int)regs.regs[8];
  if (nr == __NR_close || nr == __NR_dup3) return;
  unsigned long addr = nr == __NR_symlinkat ? regs.regs[2] : regs.regs[1];
  long dirfd = nr == __NR_symlinkat ? (long)regs.regs[1] : (long)regs.regs[0];
  char s[4096], out[8192], link[64], base[4096];
  struct iovec l = {s, sizeof s - 1}, r = {(void *)addr, sizeof s - 1};
  ssize_t got = process_vm_readv(pid, &l, 1, &r, 1, 0);
  if (got <= 0) {
    l.iov_len = r.iov_len = 4096 - (addr % 4096);
    got = process_vm_readv(pid, &l, 1, &r, 1, 0);
    if (got <= 0) return;
  }
  s[got] = 0;
  if (s[0] == '/') snprintf(out, sizeof out, "%s", s);
  else {
    if ((int)dirfd == AT_FDCWD) snprintf(link, sizeof link, "/proc/%d/cwd", pid);
    else snprintf(link, sizeof link, "/proc/%d/fd/%ld", pid, dirfd);
    ssize_t n = readlink(link, base, sizeof base - 1);
    base[n < 0 ? 0 : n] = 0;
    snprintf(out, sizeof out, "%s/%s", base, s);
  }
  struct stat st;
  lstat(out, &st);
}

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  pid_t child = fork();
  if (child == 0) {
    raise(SIGSTOP);
    if (install() != 0) _exit(126);
    execvp(argv[1], argv + 1);
    _exit(127);
  }
  int st;
  waitpid(child, &st, WUNTRACED);
  long opts = PTRACE_O_TRACESECCOMP | PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK | PTRACE_O_TRACECLONE |
              PTRACE_O_TRACEEXEC | PTRACE_O_EXITKILL;
  if (ptrace(PTRACE_SEIZE, child, 0, opts) != 0) {
    perror("seize");
    return 125;
  }
  kill(child, SIGCONT);
  int code = 0;
  for (;;) {
    pid_t pid = waitpid(-1, &st, __WALL);
    if (pid < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (WIFEXITED(st) || WIFSIGNALED(st)) {
      if (pid == child) code = WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
      continue;
    }
    if (!WIFSTOPPED(st)) continue;
    int sig = WSTOPSIG(st), ev = st >> 16;
    if (ev == PTRACE_EVENT_SECCOMP) {
      handle(pid);
      ptrace(PTRACE_CONT, pid, 0, 0);
    } else if (ev == PTRACE_EVENT_STOP) {
      if (sig == SIGSTOP || sig == SIGTSTP || sig == SIGTTIN || sig == SIGTTOU)
        ptrace(PTRACE_LISTEN, pid, 0, 0);
      else
        ptrace(PTRACE_CONT, pid, 0, 0);
    } else if (ev != 0) {
      ptrace(PTRACE_CONT, pid, 0, 0);
    } else {
      ptrace(PTRACE_CONT, pid, 0, sig);
    }
  }
  fprintf(stderr, "tracer: %ld stops\n", stops);
  return code;
}
