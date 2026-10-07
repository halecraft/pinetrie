# pine·trie's disks helper (ADR-0103): btrfs-progs, and GNU tar for a lane
# converted from `container` (pre-docker). Run with the lanes directory bound
# and no added capability; every disk operation is one `docker exec` in it.
# iptables is for the host's grants of the Mac's ports (`planHostPortRules`),
# run in a throwaway container of this image, never in the helper.
FROM docker.io/library/alpine:3.23
RUN apk add --no-cache btrfs-progs tar iptables
