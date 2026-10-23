// lock — a lock a live process owns and the kernel frees with it, refused
// to anyone else, whatever the OS (`TECHNICAL.md`).

export {
  type Held,
  type Hold,
  holdLock,
  holdOutcome,
  type LockPlatform,
  lockCommand,
} from "./lock.ts"
