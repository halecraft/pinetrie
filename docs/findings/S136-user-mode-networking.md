# S136 — On gvproxy, the lane VM's network survives a `container run`, and Docker answers 1.1 s into a boot; lanes must be fenced from gvproxy's own network, or they reach the Mac's loopback

- **Status:** Answered
- **Led to:** ADR-0103, ADR-0130

Follows S135, item 2.

**Question.** The lane VM's network is Virtualization's NAT, which macOS
runs for every VM on the Mac: one `container run` removed its Mac side,
`bridge100`, and the VM had no network from then on (S135). Tools that run
Linux on the Mac commonly wire the VM's network card to a process of their
own, a user-mode network stack (Podman, Lima and CRC use gvisor-tap-vsock's
`gvproxy`). With the launcher's card wired to `gvproxy` over a datagram
socket, as vfkit does it:
1. Does the VM boot and reach the network: DHCP, a lookup, HTTPS, a pull?
   How long until Docker answers, on a boot that formats the data disk and
   on one that does not?
2. Does its network survive a `container run`, for a container made after
   it and for one made before?
3. What does a lane reach on the Mac?
   - a Mac server on loopback, through `gvproxy`'s host address
     (`192.168.127.254`), pine·trie's own port 7391 among them;
   - a Mac server on all interfaces, at that address and at the Mac's LAN
     address;
   - `gvproxy`'s API on its gateway (`192.168.127.1`), which opens ports on
     the Mac.

   Under Virtualization's NAT a lane reaches only services bound to all
   interfaces (S128).
4. How fast: 100 MB downloaded in a lane, against the same on the Mac, and
   a pull of `node:24-trixie-slim`.

**Kill criterion.** The network does not survive a `container run`; or a
lane reaches the Mac's loopback services or `gvproxy`'s API, and that
cannot be turned off; or the boot passes 2 s on a formatted data disk.

**Throw away.** The script's state directory, VM, launcher build and Mac
servers, which it deletes; the kept data disk and the downloaded
`gvproxy` (`~/.local/state/pinetrie/s136/`); the script, the spike's
launcher (`packages/vm/launcher/launcher.swift` with the card wired to
`gvproxy`) and their results, in `.plans/s136-gvproxy/`.

## How it ran

Duane ran `node .plans/s136-gvproxy/run.ts ../pt-lanes` on the Mac four
times, on the image built from the thread's tip, with `gvproxy` v0.8.9
(downloaded from the release named `gvproxy-darwin`). The spike's launcher
connected its card to `gvproxy -listen-vfkit`, bound to a socket of its own,
sent `VFKT` first, and gave the VM the MAC address of `gvproxy`'s one DHCP
lease (`5a:94:ef:e4:0c:ee`). Results are in `.plans/s136-gvproxy/`.

- **Run 1** passed the VM 0 bytes of memory: the script wrote 4 GiB as
  `4 << 30`, which JavaScript's 32-bit shift makes 0, and the launcher
  raised it to Virtualization's floor, 4 MiB ("The virtual machine failed
  to start"). The launcher now refuses under 1 GiB.
- **Run 2** printed only exit codes, and its Mac servers ran in the
  script's own process, blocked in `spawnSync` while a lane connected, so
  every check against them timed out whatever the network did.
- **Runs 3 and 4** fixed both: servers in a process of their own, and each
  check printing what it got. Run 4 also started `gvproxy` with
  `-ssh-port -1`. The numbers below are run 4's unless said.

## Answers

1. **The VM boots and reaches the network.** DHCP answered 0.05 s after
   the disks (`192.168.127.2`, T+0.36). Docker answered 1,138 ms after the
   launcher started on a formatted disk (1,124 ms in run 3), and 2,337 ms
   in run 2, whose boot formatted it. A lookup, HTTPS to the registry and a
   pull of `alpine` worked.
2. **The network survives a `container run`,** in each of runs 2 to 4.
   Right after it, and 10 and 30 s after, a lookup and HTTPS worked from a
   new container, and a lookup from one started before the cut. The Mac had
   no `bridge100` to lose: its only `192.168` address was `en0`'s.
3. **Without a fence, a lane reaches the Mac's loopback.** From a container
   in the VM:

   | target | no firewall | with the firewall |
   |---|---|---|
   | Mac server on `127.0.0.1`, at `192.168.127.254` | **answered** | refused |
   | port 7391 on the Mac's loopback (nothing listening) | refused by the Mac | refused |
   | Mac server on `0.0.0.0`, at `192.168.127.254` | answered | refused |
   | Mac server on `0.0.0.0`, at the Mac's LAN address | answered | answered |
   | Mac server on `127.0.0.1`, at the Mac's LAN address | refused | refused |
   | `gvproxy`'s API, `192.168.127.1:80` | **answered** | refused |

   - Port 7391's "refused" without the firewall came from the Mac: the
     connection reached its loopback, where no host listened.
   - The API listed a forward of the Mac's `127.0.0.1:2222` to the VM's
     port 22 in run 3; with `-ssh-port -1`, none (`[]`).
   - The firewall was three rules in the VM's `DOCKER-USER` chain, added
     by the script from a privileged container: TCP and UDP 53 to the
     gateway returned, everything else to `192.168.127.0/24` rejected.
     Lookups and HTTPS still worked under it.

   With the firewall a lane reaches what it reached under Virtualization's
   NAT: the Mac's services bound to all interfaces, at its LAN address
   (S128), and not its loopback.
4. **Throughput is the Mac's:** a 392 MB ISO in 53.0 s in a lane, a
   container's start included (7 MB/s), against 46.4 s with `curl` on the
   Mac (8 MB/s): both the internet connection's. `node:24-trixie-slim`
   pulled in 17.5 s in run 2, on a fresh data disk.

## What this means

- **Kill criterion:** not met. The network survives `container run`, the
  boot holds 2 s, and lanes are kept from the Mac's loopback and from
  `gvproxy`'s API by the VM's firewall, which a lane cannot change.
- **The lane VM's network is `gvproxy`'s,** run by the launcher:
  - started with `-ssh-port -1`, its card connected as the spike's was;
  - the VM's init adds the three rules once Docker is up, before any lane
    runs; they are what keeps a lane off the Mac's loopback;
  - the guest's watchdog and the launcher's reattach port (vsock 2378),
    added for Virtualization's NAT, are deleted.
- ADR-0103 is amended: the network is the launcher's, not the OS's NAT.
