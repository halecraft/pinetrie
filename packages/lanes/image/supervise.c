// supervise: runs one tool call's command with every file it names reported.
//
//   supervise [--root DIR] [--shared DIR]... <socket> <run-id> -- <program> [arg]...
//
// Three processes:
// - the front (this process, the one the caller waits for): it exits with
//   the command's status as soon as the command's first process exits;
// - the listener, its child, in a process group of its own, so a signal to
//   the caller's group (an abort) never reaches it. It is the subreaper of
//   everything the command starts, answers the seccomp listener, and stays
//   until every descendant has exited: a daemon the command left running
//   is still reported, and still served;
// - the command, the listener's child, moved back into the front's process
//   group so that an abort's signal to the group reaches it. It installs a
//   seccomp filter that sends every file-naming call to the listener, then
//   execs. The filter is inherited by everything it starts and cannot be
//   removed, so daemons, static binaries and `env -i` are reported alike.
//
// Each reported call is one line on <socket> (the helper's), or, if that
// cannot be reached or stops taking lines, in
// <root>/.pinetrie-lane/runs/<run-id>.log. Lines are tab-separated, with
// `\`, tab and newline escaped in paths:
//   hello <run-id>
//   <op> <µs> <pid> <flags> <kind> <path> <kind2> <path2> <stamp>
//   exit <µs> <status>        the command's first process exited
//   end <µs>                  every process of the command has exited
// <op> is open, rename, unlink, mkdir, link, symlink or release; <kind> is
// what the path was before the call: f, d, l, o (other) or - (missing).
// <stamp> is `<size>:<ctime ns>` for a regular file, else empty: what the
// host reads of the same file too, on the Mac through virtiofs, whose
// inodes are not the Mac's.
// release is a descriptor opened for writing under a shared directory being
// let go of (close, dup3 over it, exit, exec), with the file's stamp then.
// Only paths under --root are reported. Stat and access calls are not
// watched: their cost is the most of all, and nothing needs them.
//
// The listener must never stop answering: a call it does not answer waits
// forever, and once its descriptor closes every file call of the command
// fails. So it continues past EINTR and ENOENT (a caller that died before
// its notice was read), and falls back to the log file rather than block.
#define _GNU_SOURCE
#include <errno.h>
#include <dirent.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/time.h>
#include <sys/uio.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#if !defined(__aarch64__)
#error "supervise watches aarch64's system calls; another architecture has others (open, rename, dup2)"
#endif

#define MAX_SHARED 32
// How long a line may wait on a socket the helper is not reading before
// the listener gives the socket up for the log file.
#define SEND_TIMEOUT_S 5
// How long a line may wait in the buffer while the command is quiet.
#define FLUSH_MS 100

static const char *root = "/workspace";
static size_t root_len;
static const char *shared[MAX_SHARED];
static size_t shared_len[MAX_SHARED];
static int n_shared;
static const char *run_id;

static int notify_fd = -1;
static int out_fd = -1;
static int out_is_file;
static pthread_mutex_t out_lock = PTHREAD_MUTEX_INITIALIZER;
static char out_buf[1 << 16];
static size_t out_used;

static long long now_us(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1000000LL + t.tv_nsec / 1000;
}

static int under(const char *path, const char *dir, size_t len) {
  return strncmp(path, dir, len) == 0 && (path[len] == '/' || path[len] == 0);
}

static int in_root(const char *path) { return path[0] && under(path, root, root_len); }

static int in_shared(const char *path) {
  for (int i = 0; i < n_shared; i++)
    if (under(path, shared[i], shared_len[i])) return 1;
  return 0;
}

static int mkdirs(char *path) {
  for (char *p = path + 1; *p; p++)
    if (*p == '/') {
      *p = 0;
      if (mkdir(path, 0755) != 0 && errno != EEXIST) return -1;
      *p = '/';
    }
  return 0;
}

// The log file, after the socket failed. Never fails the command: with no
// file either, lines are dropped and calls still answered.
static void to_file(void) {
  if (out_fd >= 0) close(out_fd);
  out_is_file = 1;
  char path[4096];
  snprintf(path, sizeof path, "%s/.pinetrie-lane/runs/%s.log", root, run_id);
  mkdirs(path);
  out_fd = open(path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
}

static int write_all(int fd, const char *p, size_t n) {
  while (n > 0) {
    ssize_t w = write(fd, p, n);
    if (w < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    p += w;
    n -= (size_t)w;
  }
  return 0;
}

// Caller holds out_lock. A socket that fails or times out mid-line leaves
// the helper a partial line, which it drops at the connection's end; the
// whole buffer then goes to the file.
static void flush_locked(void) {
  if (out_used == 0) return;
  if (out_fd >= 0 && write_all(out_fd, out_buf, out_used) != 0 && !out_is_file) {
    to_file();
    if (out_fd >= 0) write_all(out_fd, out_buf, out_used);
  }
  out_used = 0;
}

static void emit(const char *line, size_t n) {
  pthread_mutex_lock(&out_lock);
  if (out_used + n > sizeof out_buf) flush_locked();
  if (n > sizeof out_buf) {
    if (out_fd >= 0) write_all(out_fd, line, n);
  } else {
    memcpy(out_buf + out_used, line, n);
    out_used += n;
  }
  pthread_mutex_unlock(&out_lock);
}

static void flush(void) {
  pthread_mutex_lock(&out_lock);
  flush_locked();
  pthread_mutex_unlock(&out_lock);
}

static size_t escape(const char *s, char *out, size_t cap) {
  size_t o = 0;
  for (; *s && o + 2 < cap; s++) {
    if (*s == '\\' || *s == '\t' || *s == '\n') {
      out[o++] = '\\';
      out[o++] = *s == '\t' ? 't' : *s == '\n' ? 'n' : '\\';
    } else out[o++] = *s;
  }
  out[o] = 0;
  return o;
}

static char kind_of(const struct stat *st, int exists) {
  if (!exists) return '-';
  if (S_ISREG(st->st_mode)) return 'f';
  if (S_ISDIR(st->st_mode)) return 'd';
  if (S_ISLNK(st->st_mode)) return 'l';
  return 'o';
}

static void stamp_of(const struct stat *st, int exists, char *out, size_t cap) {
  if (exists && S_ISREG(st->st_mode))
    snprintf(out, cap, "%lld:%lld", (long long)st->st_size,
             (long long)st->st_ctim.tv_sec * 1000000000LL + st->st_ctim.tv_nsec);
  else out[0] = 0;
}

static void emit_call(const char *op, pid_t pid, long flags, char kind, const char *path, char kind2,
                      const char *path2, const char *stamp) {
  static char line[20000];
  static char e1[8200], e2[8200];
  escape(path, e1, sizeof e1);
  escape(path2, e2, sizeof e2);
  int n = snprintf(line, sizeof line, "%s\t%lld\t%d\t%lx\t%c\t%s\t%c\t%s\t%s\n", op, now_us(), pid,
                   flags, kind, e1, kind2, e2, stamp);
  if (n > 0 && (size_t)n < sizeof line) emit(line, (size_t)n);
}

static const int WATCHED[] = {
    __NR_openat, __NR_openat2, __NR_renameat, __NR_renameat2, __NR_unlinkat,
    __NR_mkdirat, __NR_linkat, __NR_symlinkat,
};
// Watched only with a shared directory: where a write is let go of.
static const int RELEASES[] = {__NR_close, __NR_dup3, __NR_exit_group, __NR_execve};
#define N_WATCHED (int)(sizeof WATCHED / sizeof WATCHED[0])
#define N_RELEASES (int)(sizeof RELEASES / sizeof RELEASES[0])

static int install(void) {
  struct sock_filter f[5 + 2 * (N_WATCHED + N_RELEASES)];
  int n = 0;
  f[n++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch));
  f[n++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_AARCH64, 1, 0);
  f[n++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  f[n++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
  for (int i = 0; i < N_WATCHED + (n_shared > 0 ? N_RELEASES : 0); i++) {
    int nr = i < N_WATCHED ? WATCHED[i] : RELEASES[i - N_WATCHED];
    f[n++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (unsigned)nr, 0, 1);
    f[n++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_USER_NOTIF);
  }
  f[n++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  struct sock_fprog prog = {.len = (unsigned short)n, .filter = f};
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return -1;
  return (int)syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_NEW_LISTENER, &prog);
}

static void send_fd(int sock, int fd) {
  char c = 0;
  struct iovec io = {.iov_base = &c, .iov_len = 1};
  char buf[CMSG_SPACE(sizeof(int))];
  memset(buf, 0, sizeof buf);
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
  struct cmsghdr *h = CMSG_FIRSTHDR(&m);
  if (h == NULL || h->cmsg_type != SCM_RIGHTS) return -1;
  int fd;
  memcpy(&fd, CMSG_DATA(h), sizeof fd);
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
  if (n < 0) {
    out[0] = 0;
    return;
  }
  base[n] = 0;
  if (p[0] == 0) snprintf(out, cap, "%s", base);
  else snprintf(out, cap, "%s/%s", base, p);
}

// A descriptor opened for writing under a shared directory, being let go of.
static void release_fd(pid_t pid, const char *fdname) {
  char link[96], target[4096], info[96], line[256];
  snprintf(link, sizeof link, "/proc/%d/fd/%s", pid, fdname);
  ssize_t n = readlink(link, target, sizeof target - 1);
  if (n <= 0) return;
  target[n] = 0;
  if (!in_shared(target)) return;
  snprintf(info, sizeof info, "/proc/%d/fdinfo/%s", pid, fdname);
  FILE *fi = fopen(info, "re");
  long fl = 0;
  while (fi && fgets(line, sizeof line, fi))
    if (strncmp(line, "flags:", 6) == 0) fl = strtol(line + 6, 0, 8);
  if (fi) fclose(fi);
  if ((fl & O_ACCMODE) == O_RDONLY) return;
  struct stat st;
  int exists = stat(target, &st) == 0;
  char stamp[96];
  stamp_of(&st, exists, stamp, sizeof stamp);
  emit_call("release", pid, fl, kind_of(&st, exists), target, '-', "", stamp);
}

static void release_all(pid_t pid) {
  char dir[64];
  snprintf(dir, sizeof dir, "/proc/%d/fd", pid);
  DIR *d = opendir(dir);
  if (d == NULL) return;
  struct dirent *e;
  while ((e = readdir(d)))
    if (e->d_name[0] != '.') release_fd(pid, e->d_name);
  closedir(d);
}

static void handle(const struct seccomp_notif *req) {
  pid_t pid = (pid_t)req->pid;
  int nr = req->data.nr;
  const unsigned long long *a = req->data.args;
  char fdname[32];
  if (nr == __NR_close || nr == __NR_dup3) {
    // dup3 over a descriptor closes it with no close call: a shell restoring
    // its stdout after a redirection does exactly this.
    snprintf(fdname, sizeof fdname, "%lld", (long long)a[nr == __NR_close ? 0 : 1]);
    release_fd(pid, fdname);
    return;
  }
  if (nr == __NR_exit_group || nr == __NR_execve) {
    // A shell's redirection to fd 1 is let go of only by its exit.
    release_all(pid);
    return;
  }
  static char s1[4096], s2[4096], p1[8192], p2[8192];
  const char *op;
  long flags = 0;
  p1[0] = p2[0] = 0;
  if (nr == __NR_symlinkat) {
    // symlinkat(target, dirfd, path): the link's own path is what is written.
    op = "symlink";
    if (read_str(pid, a[2], s1, sizeof s1) == 0) resolve(pid, (long)a[1], s1, p1, sizeof p1);
  } else {
    if (read_str(pid, a[1], s1, sizeof s1) == 0) resolve(pid, (long)a[0], s1, p1, sizeof p1);
    if (nr == __NR_openat) {
      op = "open";
      flags = (long)a[2];
    } else if (nr == __NR_openat2) {
      op = "open";
      unsigned long long how[3];
      struct iovec l = {how, sizeof how}, r = {(void *)a[2], sizeof how};
      if (process_vm_readv(pid, &l, 1, &r, 1, 0) > 0) flags = (long)how[0];
    } else if (nr == __NR_unlinkat) {
      op = "unlink";
      flags = (long)a[2];
    } else if (nr == __NR_mkdirat) op = "mkdir";
    else {
      op = nr == __NR_linkat ? "link" : "rename";
      if (read_str(pid, a[3], s2, sizeof s2) == 0) resolve(pid, (long)a[2], s2, p2, sizeof p2);
    }
  }
  if (!in_root(p1) && !in_root(p2)) return;
  struct stat st1, st2;
  int e1 = p1[0] && lstat(p1, &st1) == 0;
  int e2 = p2[0] && lstat(p2, &st2) == 0;
  char stamp[96];
  stamp_of(&st1, e1, stamp, sizeof stamp);
  emit_call(op, pid, flags, kind_of(&st1, e1), p1, p2[0] ? kind_of(&st2, e2) : '-', p2, stamp);
}

static void *listen_loop(void *arg) {
  (void)arg;
  struct seccomp_notif_sizes sz;
  if (syscall(__NR_seccomp, SECCOMP_GET_NOTIF_SIZES, 0, &sz) != 0) return NULL;
  struct seccomp_notif *req = calloc(1, sz.seccomp_notif);
  struct seccomp_notif_resp *resp = calloc(1, sz.seccomp_notif_resp);
  for (;;) {
    struct pollfd p = {.fd = notify_fd, .events = POLLIN};
    int ready = poll(&p, 1, FLUSH_MS);
    if (ready == 0) {
      flush();
      continue;
    }
    if (ready < 0) {
      if (errno == EINTR) continue;
      return NULL;
    }
    // Every process holding the filter is gone; none can call again.
    if (p.revents & POLLHUP) return NULL;
    memset(req, 0, sz.seccomp_notif);
    if (ioctl(notify_fd, SECCOMP_IOCTL_NOTIF_RECV, req) < 0) {
      if (errno == EINTR || errno == ENOENT) continue;
      return NULL;
    }
    handle(req);
    memset(resp, 0, sz.seccomp_notif_resp);
    resp->id = req->id;
    resp->flags = SECCOMP_USER_NOTIF_FLAG_CONTINUE;
    // ENOENT: the caller died while it was handled. Nothing waits for it.
    ioctl(notify_fd, SECCOMP_IOCTL_NOTIF_SEND, resp);
  }
}

static int connect_helper(const char *path) {
  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return -1;
  struct sockaddr_un addr = {.sun_family = AF_UNIX};
  if (strlen(path) >= sizeof addr.sun_path) goto fail;
  strcpy(addr.sun_path, path);
  if (connect(fd, (struct sockaddr *)&addr, sizeof addr) != 0) goto fail;
  struct timeval tv = {.tv_sec = SEND_TIMEOUT_S};
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
  return fd;
fail:
  close(fd);
  return -1;
}

static int status_of(int status) {
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 1;
}

static int usage(void) {
  fputs("usage: supervise [--root DIR] [--shared DIR]... <socket> <run-id> -- <program> [arg]...\n", stderr);
  return 2;
}

// The listener: see the header. Writes the command's status, then whether
// it stays (1) or is about to exit (0), to `report`.
static int listener(const char *socket_path, char **argv, pid_t group, int report) {
  setpgid(0, 0);
  prctl(PR_SET_CHILD_SUBREAPER, 1);
  int sv[2];
  if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, sv) != 0) return 125;
  pid_t command = fork();
  if (command < 0) return 125;
  if (command == 0) {
    close(sv[0]);
    close(report);
    setpgid(0, group);
    int fd = install();
    if (fd < 0) {
      fprintf(stderr, "supervise: the seccomp listener was refused: %s\n", strerror(errno));
      _exit(126);
    }
    send_fd(sv[1], fd);
    close(fd);
    char go;
    if (read(sv[1], &go, 1) != 1) _exit(125);
    close(sv[1]);
    signal(SIGPIPE, SIG_DFL);
    execvp(argv[0], argv);
    fprintf(stderr, "supervise: %s: %s\n", argv[0], strerror(errno));
    _exit(127);
  }
  close(sv[1]);
  notify_fd = recv_fd(sv[0]);
  out_fd = connect_helper(socket_path);
  if (out_fd < 0) to_file();
  char hello[512];
  int n = snprintf(hello, sizeof hello, "hello\t%s\n", run_id);
  emit(hello, (size_t)n);
  flush();
  pthread_t thread;
  int listening = notify_fd >= 0 && pthread_create(&thread, NULL, listen_loop, NULL) == 0;
  if (write(sv[0], "", 1) != 1) {}
  close(sv[0]);
  // The command has the caller's stdio; the listener must not hold it open.
  int null = open("/dev/null", O_RDWR);
  if (null >= 0) {
    dup2(null, 0);
    dup2(null, 1);
    dup2(null, 2);
    if (null > 2) close(null);
  }
  int status;
  for (;;) {
    pid_t p = waitpid(-1, &status, 0);
    if (p < 0 && errno == EINTR) continue;
    if (p == command) {
      int code = status_of(status);
      char line[64];
      n = snprintf(line, sizeof line, "exit\t%lld\t%d\n", now_us(), code);
      emit(line, (size_t)n);
      flush();
      int stays = waitpid(-1, &status, WNOHANG) != -1 || errno != ECHILD;
      unsigned char r[2] = {(unsigned char)code, (unsigned char)stays};
      if (write(report, r, 2) != 2) {}
      close(report);
      if (!stays) break;
    } else if (p < 0 && errno == ECHILD) break;
  }
  // No process holding the filter is left, so no call can be waiting: the
  // listener thread needs no join, which a kernel without POLLHUP on the
  // listener would never give.
  (void)listening;
  (void)thread;
  char line[64];
  n = snprintf(line, sizeof line, "end\t%lld\n", now_us());
  emit(line, (size_t)n);
  flush();
  return 0;
}

int main(int argc, char **argv) {
  int i = 1;
  for (; i < argc && strncmp(argv[i], "--", 2) == 0 && argv[i][2] != 0; i += 2) {
    if (i + 1 >= argc) return usage();
    if (strcmp(argv[i], "--root") == 0) root = argv[i + 1];
    else if (strcmp(argv[i], "--shared") == 0 && n_shared < MAX_SHARED) {
      shared[n_shared] = argv[i + 1];
      shared_len[n_shared] = strlen(argv[i + 1]);
      n_shared++;
    } else return usage();
  }
  if (argc - i < 4 || strcmp(argv[i + 2], "--") != 0) return usage();
  root_len = strlen(root);
  const char *socket_path = argv[i];
  run_id = argv[i + 1];
  if (strchr(run_id, '/') || strchr(run_id, '\t') || strchr(run_id, '\n')) return usage();
  char **command = argv + i + 3;
  signal(SIGPIPE, SIG_IGN);
  int report[2];
  if (pipe2(report, O_CLOEXEC) != 0) return 125;
  pid_t group = getpgrp();
  pid_t child = fork();
  if (child < 0) return 125;
  if (child == 0) {
    close(report[0]);
    _exit(listener(socket_path, command, group, report[1]));
  }
  close(report[1]);
  unsigned char r[2];
  ssize_t got;
  do got = read(report[0], r, 2);
  while (got < 0 && errno == EINTR);
  if (got != 2) return 125;
  // A listener that is done is reaped here; one that stays is the init's.
  if (r[1] == 0) waitpid(child, NULL, 0);
  return r[0];
}
