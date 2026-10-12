// S172: `stamp <file>...` prints each file's <size>:<ctime ns>, as the host's
// stamps are. Disposable.
#include <stdio.h>
#include <sys/stat.h>
int main(int argc, char **argv) {
  for (int i = 1; i < argc; i++) {
    struct stat st;
    if (lstat(argv[i], &st) != 0) { printf("%s\t-\n", argv[i]); continue; }
    printf("%s\t%lld:%lld\n", argv[i], (long long)st.st_size,
           (long long)st.st_ctim.tv_sec * 1000000000LL + st.st_ctim.tv_nsec);
  }
  return 0;
}
