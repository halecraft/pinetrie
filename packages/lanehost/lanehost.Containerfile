# lanehost's image (ADR-0129): btrfs-progs for the disks and the diffs,
# git for a folder project's text merges (`git merge-file`), GNU tar for
# an accept's stream (`tar-out.ts`: pax, its paths by `--null -T -`), and
# iptables for a project's grant. Its server runs on pine·trie's own Node,
# from the lane runtime and the install a host mounts read-only.
FROM docker.io/library/alpine:3.23
RUN apk add --no-cache btrfs-progs git iptables tar
