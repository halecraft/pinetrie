// lock — a lock a live process owns and the kernel frees with it, refused
// to anyone else, whatever the OS (`TECHNICAL.md`).

export {
  awaitLock,
  type HeldLock,
  holderPid,
  holdOutcome,
  type LockAttempt,
  type LockFailed,
  type LockMode,
  type LockOptions,
  lockCommand,
  removeLockFile,
  type SaidPid,
  tryLock,
  withLock,
} from "./lock.ts"
