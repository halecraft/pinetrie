# S163 — The lane VM's clock falls behind the Mac's while it runs, its RTC does not, and apt refuses Debian's signatures for it

- **Status:** Answered

**Question.** The default lane image (`packages/lanes/image/Containerfile`)
would not build in a lane: `apt-get update` failed, and with it the four
images checks of the browser suite. S162 had noted the VM's clock 16.6 h
behind the Mac's and guessed that was why. Is it, where does the VM's time
come from, and can the VM keep it without the network?

**Kill criterion.** If the guest has no clock source that holds the Mac's
time, keeping time needs the network (NTP through gvproxy) or the launcher,
and this fix is not the VM's alone.

**Throw away.** The commands below; nothing was built for it.

## Answers

1. **apt fails on the clock, nothing else.** In `node:24-trixie-slim` in
   this lane, `apt-get update` failed with `OpenPGP signature verification
   failed … Not live until 2026-10-12T01:45:09Z`, and then `The repository
   … is not signed`. Debian's `sqv` refuses a signature made after the
   clock's now.
2. **The guest's clock was 16.6 h behind; its RTC was right.** Read at the
   same moment:

   | | UTC |
   |---|---|
   | `date` | Oct 11 11:35 |
   | deb.debian.org's `Date:` header | Oct 12 04:11 |
   | `/sys/class/rtc/rtc0` (`rtc-pl031`) | Oct 12 04:12 |

   The VM had been up 14 h 13 min (`uptime`), less than the offset, so the
   clock was not set wrong at boot: it lost time while running. The likely
   cause, not measured here, is the Mac sleeping, during which a
   Virtualization guest's counter (`arch_sys_counter`) stops while the
   PL031, read from the Mac, does not. On the Mac, `pmset -g log` would
   show it.
3. **Nothing re-reads the RTC after boot.** `hctosys` is 1: the kernel set
   the clock from `rtc0` once, at boot. Neither the VM's `init` nor the
   launcher sets the time again, and no NTP daemon runs.
4. **The PL031 is built into `linux-virt`,** not a module (`/proc/modules`
   names none), so it is there before `init` runs.
5. **A lane cannot set the clock.** Its effective capabilities
   (`a80425fb`) lack `CAP_SYS_TIME`. Busybox's `date -s` there fails with
   `can't set date` and still exits 0; busybox's `hwclock -s` exits non-zero
   when it cannot.

**What this means.** The kill criterion does not fire: the RTC holds the
Mac's time, so the VM can keep its clock without the network or the
launcher by stepping it to the RTC with `hwclock -s -u` whenever the two
part. The cost is one extra script in the VM image (`packages/vm/TECHNICAL.md`,
"The clock is kept to the RTC"). Every lane on the VM shares its kernel's
clock, so the drift also stamped lanes' jj commits about 16 h early.
