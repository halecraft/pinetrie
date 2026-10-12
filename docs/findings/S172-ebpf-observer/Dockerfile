# S172: the probe's image, built in the lane VM's Docker. Disposable.
FROM alpine:3.23 AS build
RUN apk add --no-cache clang llvm libbpf-dev bpftool elfutils-dev zlib-static zstd-static zstd-dev linux-headers build-base liburing-dev
COPY *.c *.h build.sh /src/
RUN mkdir /out && sh /src/build.sh /out

FROM alpine:3.23
RUN apk add --no-cache python3 strace gdb
COPY --from=build /out/ /opt/s172/
COPY workload.sh check.py /opt/s172/
ENV PATH=/opt/s172:$PATH
