# S206 — pi's `writeFile` through a lane's channel writes raw bytes intact, 64 MiB in a quarter second, recorded as a tool write

- **Status:** Answered
- **Led to:** ADR-0151

**Question.** A host tool that saves a shared blob into its lane
(`save_blob`) would write the blob's bytes through the lane's environment
(`laneEnv` in `packages/pi/lane-env.ts`), so that the helper records the
write as a tool's: the disk model classes it, and a write into a shared
directory gets its lineage.

1. Does pi's `ExecutionEnv.writeFile` take bytes, or only text?
2. Do bytes cross the channel unchanged, including a NUL and bytes that
   are not UTF-8?
3. Up to what size, and how fast?
4. Does the helper record a bytes write as it records a text one, in the
   workspace and in a shared directory?

**Kill criterion.** Bytes cannot cross without a change to the channel or
the helper's protocol, or a 32 MiB write (`MAX_UPLOAD_BYTES`) fails or
takes seconds.

**Throw away.** `sandbox/s198-bytes/probe.ts`, which opened a local helper
as `packages/pi/lane-runs.test.ts` does and wrote through `laneEnv`.

## Answers

1. **Bytes.** pi 0.87.1's `ExecutionEnv.writeFile(path, content: string |
   Uint8Array, context)` (`pi-agent-core`'s `dist/harness/types.d.ts`),
   and its `NodeExecutionEnv`, which the helper serves, takes either.
2. **Unchanged.** `@pinetrie/channel` already carries any `Uint8Array` as
   base64 (`packages/channel/wire.ts`; S43 item 2), as `readBinaryFile`'s
   result needs. Random bytes starting `00 ff`, written then read back
   from the disk, had the same SHA-256 at every size.
3. **64 MiB, the largest tried, in 231 ms**, on a local helper process
   (one JSON line of about 87 MB). 1 MiB took 7 ms, 8 MiB 36 ms, 32 MiB
   114 ms. The host's resident memory rose from 130 to 349 MB over the
   run: a blob is held whole, as bytes and as its base64 line, while it
   crosses. Nothing in the channel caps a line (`readline` on both ends).
4. **Yes, as a tool write.** The drain listed every file among
   `toolWrites`, and the write into the shared directory among
   `toolShared` too, stamped before and after as a text write is.

**Not measured.** The production stream is the lane runtime's `exec -i`
(on the Mac, through the lane VM's bridge), not a local process. It
carries the same JSON lines, at 0.2 ms a call (S147); its throughput for
one line of tens of MB was not measured. At `MAX_UPLOAD_BYTES` (32 MiB) the
line is 43 MB.

**For the plan.** `save_blob` writes with `env.writeFile(path, bytes,
context)` from its tool context's `env`: no protocol change, and the
helper's file access records it. Nothing larger than an upload ever
crosses, since a blob is at most `MAX_UPLOAD_BYTES`.
