#!/bin/sh
# S172: builds every probe, static, into $1. Run in Alpine with clang,
# libbpf-dev, bpftool, elfutils-dev, zlib-static, zstd-static, liburing-dev.
set -eu
out=$1
cd "$(dirname "$0")"
clang -O2 -g -target bpf -D__TARGET_ARCH_arm64 -I. -c observe.bpf.c -o "$out/observe.bpf.o"
bpftool gen skeleton "$out/observe.bpf.o" > "$out/observe.skel.h"
cc -O2 -Wall -I"$out" -static -o "$out/observe" observe.c -lbpf -lelf -lz -lzstd
for p in s172-run stamp threads mmapw bench eintr sink timeit; do cc -O2 -Wall -Wextra -static -o "$out/$p" $p.c -lpthread; done
cc -O2 -Wall -static -o "$out/uring" uring.c -luring
cc -O2 -Wall -Wextra -Werror -static -o "$out/supervise" supervise.c
echo "built: $(ls "$out" | tr '\n' ' ')"
