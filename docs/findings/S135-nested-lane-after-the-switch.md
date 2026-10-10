# S135 — In a nested lane, setuid `newuidmap` cannot write a uid map: it needs file capabilities. And a lane of the switched host has no network past the VM

- **Status:** Answered
- **Led to:** ADR-0103, ADR-0130

Item 2 is answered on the Mac below, and fixed in S136.

**Question.** After the switch, in pine·trie's own lane on Docker, granted
`lanes.nested`:
1. Why does the inner Docker not start ("newuidmap: write to uid_map
   failed: Operation not permitted", as under `container` in S133)?
2. Does the lane reach the network?

**Kill criterion.** No way to write an inner namespace's uid map without
`CAP_SYS_ADMIN`.

**Throw away.** The copies of `newuidmap`, `newgidmap` and
`dockerd-rootless.sh` made in the lane, which it deleted.

## How it ran

In the lane (Docker 29.5.2 in the lane VM, its capabilities Docker's
default set, `0xa80425fb`, `NoNewPrivs` 0, the narrow seccomp profile),
each step one command:
- a namespace made by uid 1000 (`unshare -U sleep`), its uid map written by
  Debian's `newuidmap` (setuid root, shadow 4.17.4), by root with
  `printf`, and by a copy of `newuidmap` without setuid and with the file
  capability `cap_setuid+ep` (written with Python's `setxattr`: the lane
  had no network to install `setcap`);
- the inner Docker started with copies of both tools so made;
- a TCP connection to Docker's bridge gateway (`172.17.0.1`), to the Mac's
  NAT (`192.168.65.1`), and to `1.1.1.1:443`.

## Answers

1. **A uid map is written by the namespace's owner, not by root.**
   - uid 1000 mapping only itself (`unshare -r`): written.
   - Root, with `CAP_SETUID` and `CAP_SETFCAP`, writing `0 1000 1` and
     `1 100000 65536`: "Operation not permitted". So was setuid
     `newuidmap`, even mapping only uid 1000.
   - The copy with `cap_setuid+ep`, run as uid 1000: wrote both ranges.

   The kernel's `map_write` requires the file's opener to hold
   `CAP_SYS_ADMIN` over the target namespace (read in
   `kernel/user_namespace.c`, not measured further). Its owner has it there.
   Root in a container without `CAP_SYS_ADMIN` does not, and setuid
   `newuidmap` opens the file as root. S125's `docker:dind-rootless`
   worked. Not checked whether its image ships the tools with file
   capabilities.

   With both tools so made, `rootlesskit` got past the uid map and stopped
   at the tap device: the image has no `ip` (iproute2). Not run further.
2. **No network past the VM.** The VM booted at about 21:41 and the
   checks ran at 21:48:
   - the bridge gateway refused at once (reachable);
   - `192.168.65.1:53` and `:9`: "No route to host" after 3 s;
   - `1.1.1.1:443`: could not connect after 3 s;
   - DNS timed out.

   DHCP had answered in this boot: the lane's `resolv.conf`, which Docker
   copied from the VM's, names `192.168.65.1` and the domain `lan`. So the
   VM's network came up and was gone within minutes. A VM left running
   earlier the same day timed out on the same resolver, while fresh VMs in
   a script's own state directory pulled images.

## Item 2 on the Mac (`.plans/lane-runtime-mac/nat.ts`)

A VM of the script's own, its lookups and GETs from a container in it, and
the Mac's `192.168` addresses, before and after one
`container run --rm alpine true`:
- **With the host's VM still running on the dead NAT** (launcher 9793): the
  new VM got no DHCP answer in 10 s, and the Mac had no address but `en0`'s.
- **With every launcher stopped:** the new VM's DHCP answered at T+1.77
  (`192.168.65.45`), the Mac had `bridge100` at `192.168.65.1`, and a
  lookup and a GET from the VM worked. Within 0.1 s of the `container run`,
  `bridge100` was gone, and for the 90 s after every lookup timed out and
  every GET failed ("Host is unreachable" from 40 s on).

So one `container run` takes the Mac's side of Virtualization's NAT away
from a running VM, and a VM started later joins the dead network. Why is
not known: `container`'s own network (`192.168.64.1`) kept working.

## What this means

- The default image installs `newuidmap` and `newgidmap` with
  `cap_setuid+ep` and `cap_setgid+ep` in place of setuid, and adds
  `iproute2`. Whether the inner Docker then starts is checked once a lane
  runs that image.
- Item 2 is to be found from the Mac's side: the VM's `console.log`, and
  whether the Mac's NAT answers other VMs while it fails.
