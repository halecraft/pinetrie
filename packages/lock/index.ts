// lock — a lock a live process owns and the kernel frees with it, refused
// to anyone else, whatever the OS (`TECHNICAL.md`).

export {
  awaitLock,
  type HeldLock,
  holderPid,
  holdOutcome,
  type LockAttempt,
  type LockFailed,
  type LockOptions,
  lockCommand,
  type OnWaiting,
  removeLockFile,
  type SaidPid,
  tryLock,
  withLock,
} from "./lock.ts"
