// Probe B's helper. Disposable.
//   cdc gen <file> <bytes> <seed>   write <bytes> of pseudo-random data
//   cdc chunk <file> <start>        print chunk ends from <start>, one per line,
//                                   until EOF (the reader stops it when resynced)
// Chunking is FastCDC's gear hash with normalized masks: min 256 KiB, average
// about 1 MiB, max 4 MiB. A boundary depends only on the 64 bytes before it, so
// chunking resumed at an old boundary finds the old boundaries again.
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

static uint64_t gear[256];
static uint64_t sm(uint64_t *s) {
  uint64_t z = (*s += 0x9e3779b97f4a7c15ULL);
  z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
  z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
  return z ^ (z >> 31);
}

int main(int argc, char **argv) {
  if (argc < 4) return 2;
  if (!strcmp(argv[1], "gen")) {
    uint64_t n = strtoull(argv[3], 0, 10), s = strtoull(argv[4], 0, 10);
    int fd = open(argv[2], O_WRONLY | O_CREAT | O_TRUNC, 0644);
    size_t B = 64 << 20;
    uint64_t *buf = malloc(B);
    for (uint64_t done = 0; done < n;) {
      for (size_t i = 0; i < B / 8; i++) buf[i] = sm(&s);
      size_t w = n - done < B ? n - done : B;
      if (write(fd, buf, w) != (ssize_t)w) return 1;
      done += w;
    }
    fsync(fd);
    return close(fd);
  }
  uint64_t seed = 42;
  for (int i = 0; i < 256; i++) gear[i] = sm(&seed);
  const uint64_t MIN = 256 << 10, AVG = 1 << 20, MAX = 4 << 20;
  uint64_t MASK_S = 0, MASK_L = 0;  // 22 and 18 bits, spread over the high half
  for (int b = 0; b < 22; b++) MASK_S |= 1ULL << (63 - 2 * b);
  for (int b = 0; b < 18; b++) MASK_L |= 1ULL << (63 - 2 * b);
  int fd = open(argv[2], O_RDONLY);
  struct stat st;
  fstat(fd, &st);
  uint64_t n = st.st_size, pos = strtoull(argv[3], 0, 10);
  const uint8_t *m = mmap(0, n ? n : 1, PROT_READ, MAP_SHARED, fd, 0);
  madvise((void *)m, n, MADV_SEQUENTIAL);
  setvbuf(stdout, 0, _IOLBF, 0);
  while (pos < n) {
    uint64_t end = pos + MAX < n ? pos + MAX : n, i = pos + MIN, h = 0, cut = end;
    if (i >= end) cut = end;
    else
      for (; i < end; i++) {
        h = (h << 1) + gear[m[i]];
        if (!(h & (i - pos < AVG ? MASK_S : MASK_L))) {
          cut = i + 1;
          break;
        }
      }
    printf("%llu\n", (unsigned long long)cut);
    pos = cut;
  }
  return 0;
}
