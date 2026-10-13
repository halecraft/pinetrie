# The observer's loader (observe.c, with observe.bpf.c in its skeleton),
# static, for the machine's own architecture; the suite's guest, an
# initramfs of busybox, the loader and the workloads
# (apps/pinetrie/e2e/observer); and the machine role's image (`machine`).
FROM docker.io/library/alpine:3.23 AS build
RUN apk add --no-cache clang llvm libbpf-dev bpftool elfutils-dev zlib-static zstd-static zstd-dev linux-headers build-base
COPY kernel.h observe.h observe.bpf.c observe.c /src/
WORKDIR /src
RUN arch=$(uname -m | sed 's/aarch64/arm64/; s/x86_64/x86/') \
 && clang -O2 -g -Wall -target bpf -D__TARGET_ARCH_$arch -I. -c observe.bpf.c -o observe.bpf.o \
 && bpftool gen skeleton observe.bpf.o name observe_bpf > observe.skel.h \
 && cc -O2 -Wall -Wextra -static -I. -o /observe observe.c -lbpf -lelf -lz -lzstd

FROM build AS suite
RUN apk add --no-cache busybox-static liburing-dev cpio
COPY suite/work.c suite/init /suite/
RUN cc -O2 -Wall -Wextra -static -o /suite/work /suite/work.c -luring -lpthread \
 && mkdir -p /guest/bin /guest/proc /guest/sys /guest/dev /guest/w /guest/tmp \
 && cp /bin/busybox.static /guest/bin/busybox \
 && for a in $(/bin/busybox.static --list); do ln -sf busybox /guest/bin/$a; done \
 && cp /observe /suite/work /guest/bin/ \
 && cp /suite/init /guest/init && chmod 755 /guest/init \
 && (cd /guest && find . | cpio -o -H newc --quiet | gzip -1) > /initramfs.cpio.gz

# The machine role's image, self-contained: nothing is mounted from a host,
# since on the Mac a slot's share empties with its lease. The host builds it
# with two named contexts: `runtime`, the lane runtime (its Node), and
# `install`, pine·trie's packages.
FROM docker.io/library/alpine:3.23 AS machine
COPY --from=build /observe /usr/local/bin/observe
COPY --from=runtime . /pinetrie-runtime
COPY --from=install core /pinetrie/packages/core
COPY --from=install channel /pinetrie/packages/channel
COPY --from=install lanehost /pinetrie/packages/lanehost
