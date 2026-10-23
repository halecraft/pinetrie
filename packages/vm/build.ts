// vm/build — building the lane VM's image (`image/build.sh`) on the Mac, in
// a one-shot VM of its own (`builder/`): the kernel the image ships and
// Alpine's minirootfs, both pinned, with the modules a build loads and the
// builder's `/init`. The guest writes the outputs to its one disk as a tar;
// they are read back, checked against `SHA256SUMS`, and renamed into place.

import { execFile, spawn } from "node:child_process"
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { gunzipSync } from "node:zlib"
import { withLock } from "@pinetrie/lock"
import { apkFiles, pinnedKernel } from "./apk.ts"
import {
  ensurePinned,
  type FetchBytes,
  FetchRefused,
  fetchBytes,
  sha256Hex,
} from "./pinned.ts"
import {
  type BuilderPins,
  changedImageFiles,
  IMAGE_FILES,
  IMAGE_OUTPUTS,
  IMAGE_SOURCE_SUMS,
  type ImageFile,
  type ImageSources,
  imageDir,
  imageKey,
  imageRefusal,
  imageSourceSums,
  isBuildLogLine,
  type KernelModule,
  moduleOrder,
  parseSums,
  planVmBuildRun,
  vmBuildWaitWords,
} from "./plan.ts"
import { BUILDER, buildBinary, gatherBinary } from "./swift.ts"

const SOURCE_DIR = path.join(import.meta.dirname, "image")
export const BUILDER_DIR = path.join(import.meta.dirname, "builder")

/** The image's sources, read from `image/`. */
export async function readImageSources(): Promise<ImageSources> {
  const read = async (name: string) =>
    [name, await readFile(path.join(SOURCE_DIR, name), "utf8")] as const
  return Object.fromEntries(
    await Promise.all(IMAGE_FILES.map(read)),
  ) as ImageSources
}

export const readBuilderPins = async (): Promise<BuilderPins> =>
  JSON.parse(
    await readFile(path.join(BUILDER_DIR, "pins.json"), "utf8"),
  ) as BuilderPins

const fileSha256 = (file: string): Promise<string | null> =>
  readFile(file).then(sha256Hex, () => null)

/** Why the image in `dir` cannot be used, or null. */
export async function checkImageDir(dir: string): Promise<string | null> {
  const sums = await readFile(path.join(dir, "SHA256SUMS"), "utf8").catch(
    () => null,
  )
  if (sums === null) return "there is no SHA256SUMS"
  const actual: Record<string, string | null> = {}
  for (const name of IMAGE_OUTPUTS)
    actual[name] = await fileSha256(path.join(dir, name))
  return imageRefusal(parseSums(sums), actual)
}

/** The image in `dir`'s record of its sources' hashes, or null when it has none. */
export const readImageSourceSums = (
  dir: string,
): Promise<ReadonlyMap<string, string> | null> =>
  readFile(path.join(dir, IMAGE_SOURCE_SUMS), "utf8").then(
    parseSums,
    () => null,
  )

/**
 * The image files the running image `running` (its key) differs in from
 * the current sources; null when it has no record, or is not known. The
 * current image's record is made from the sources, not read: it may not
 * be built yet.
 */
export async function gatherChangedFiles(
  stateDir: string,
  running: string | null,
): Promise<readonly ImageFile[] | null> {
  if (running === null) return null
  const [record, sources] = await Promise.all([
    readImageSourceSums(imageDir(stateDir, running)),
    readImageSources(),
  ])
  return changedImageFiles(record, parseSums(imageSourceSums(sources)))
}

const exec = (program: string, args: readonly string[]) =>
  new Promise<void>((resolve, reject) =>
    execFile(program, args, { maxBuffer: 1 << 20 }, (error, _out, stderr) =>
      error === null
        ? resolve()
        : reject(new Error(`${program} ${args.join(" ")}: ${stderr.trim()}`)),
    ),
  )

/**
 * Put the checked outputs in `from` at `image`. A whole image already there
 * is kept and ours trashed, unless `force`: a launcher may be starting
 * from it. One that is not whole is replaced.
 */
export async function installImage(
  from: string,
  image: string,
  force: boolean,
): Promise<boolean> {
  const refused = await checkImageDir(from)
  if (refused !== null) throw new Error(`the built VM image: ${refused}`)
  const there = await stat(image).then(
    () => true,
    () => false,
  )
  if (there && (await checkImageDir(image)) === null && !force) return false
  if (there) {
    const aside = `${image}.old-${process.pid}`
    await rename(image, aside)
    await rm(aside, { recursive: true, force: true })
  }
  await rename(from, image)
  return true
}

/**
 * An initrd's own part, beside the root: modules out of the kernel's
 * package, gunzipped, with their load order, and its `/init`. The image
 * build and the repair boot each add their own files to `dir` after.
 */
export interface InitrdParts {
  readonly dir: string
  readonly kernelApk: Uint8Array
  readonly modules: readonly KernelModule[]
  /** The `/init` script's path. */
  readonly init: string
}

/** Writes `m/` (the modules and `m/order`) and `init` into `parts.dir`. */
export async function writeInitrdDir(parts: InitrdParts): Promise<void> {
  const m = path.join(parts.dir, "m")
  await mkdir(m, { recursive: true })
  const files = apkFiles(
    parts.kernelApk,
    parts.modules.map(x => x.entry),
  )
  for (const { entry, as } of parts.modules) {
    const gz = files.get(entry)
    if (gz === undefined)
      throw new Error(`the builder's kernel package holds no ${entry}`)
    await writeFile(path.join(m, as), gunzipSync(gz))
  }
  await writeFile(path.join(m, "order"), moduleOrder(parts.modules))
  await copyFile(parts.init, path.join(parts.dir, "init"))
  await chmod(path.join(parts.dir, "init"), 0o755)
}

/**
 * The initrd at `initrd`: the minirootfs as newc cpio, then every entry of
 * `dir`, concatenated; both owned by root, later entries winning. Its
 * parts are written in `scratch`.
 */
export async function writeInitrd(f: {
  readonly rootTarball: string
  readonly dir: string
  readonly scratch: string
  readonly initrd: string
}): Promise<void> {
  const root = path.join(f.scratch, "root.cpio")
  const own = path.join(f.scratch, "own.cpio")
  await exec("bsdtar", ["--format", "newc", "-cf", root, `@${f.rootTarball}`])
  await exec("bsdtar", [
    "--format",
    "newc",
    "--uid",
    "0",
    "--gid",
    "0",
    "-cf",
    own,
    "-C",
    f.dir,
    ...(await readdir(f.dir)).sort(),
  ])
  const initrd = await open(f.initrd, "w")
  try {
    for (const part of [root, own]) await initrd.write(await readFile(part))
  } finally {
    await initrd.close()
  }
}

/**
 * Runs the builder's machine, each line of its console and its own errors
 * handed to `onLine` as it comes; fails on an exit but 0, with its last
 * lines. Resolves with its last lines, which name what a guest that
 * stopped itself did not do.
 */
export function runBuilder(
  binary: string,
  args: readonly string[],
  onLine: (line: string) => void,
): Promise<{ readonly tail: readonly string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const tail: string[] = []
    const keep = (line: string) => {
      tail.push(line)
      if (tail.length > 30) tail.shift()
      onLine(line)
    }
    createInterface({ input: child.stdout }).on("line", keep)
    createInterface({ input: child.stderr }).on("line", keep)
    child.on("error", reject)
    child.on("close", code =>
      code === 0
        ? resolve({ tail })
        : reject(
            new Error(
              `the lane VM's builder machine exited ${code}:\n${tail.join("\n")}`,
            ),
          ),
    )
  })
}

/** A pin Alpine no longer serves, worded with what to update. */
function goneWords(error: unknown, pins: BuilderPins): Error {
  if (error instanceof FetchRefused && error.status === 404)
    return new Error(
      `Alpine no longer serves ${error.url}: it keeps only each package's latest version. Update linux-virt and alpine-base in packages/vm/image/manifest.json, and packages/vm/builder/pins.json with them (kernel ${pins.kernel.version}, root ${pins.root.version})`,
    )
  return error instanceof Error ? error : new Error(String(error))
}

/** What a build must do first, for its words (`vmBuildWords`). */
export async function gatherBuildFirst(stateDir: string): Promise<{
  readonly compile: boolean
  readonly fetch: boolean
}> {
  const pins = await readBuilderPins()
  const have = (pin: { readonly url: string }) =>
    stat(path.join(stateDir, "builder", path.basename(pin.url))).then(
      () => true,
      () => false,
    )
  const [builder, kernel, root] = await Promise.all([
    gatherBinary(stateDir, BUILDER),
    have(pins.kernel),
    have(pins.root),
  ])
  return { compile: builder.state !== "built", fetch: !kernel || !root }
}

/**
 * Build the image for the current sources under `stateDir` in a VM of its
 * own. Waits for any build another process is making, saying once whose
 * (`log`); a whole image already there is kept unless `force`. Returns its directory,
 * and whether this call built it.
 */
export async function buildVmImageInVm(input: {
  readonly stateDir: string
  readonly force: boolean
  readonly log: (line: string) => void
  readonly fetch?: FetchBytes
}): Promise<{ readonly dir: string; readonly built: boolean }> {
  const fetch = input.fetch ?? fetchBytes
  const [sources, pins] = await Promise.all([
    readImageSources(),
    readBuilderPins(),
  ])
  const pinsDir = path.join(input.stateDir, "builder")
  const kernel = await pinnedKernel(pinsDir, pins.kernel, fetch).catch(e => {
    throw goneWords(e, pins)
  })
  const run = planVmBuildRun({
    stateDir: input.stateDir,
    key: imageKey(sources),
    pins,
    pid: process.pid,
    cpus: os.availableParallelism(),
    kernel,
  })
  await mkdir(path.dirname(run.image), { recursive: true })
  const done = await withLock(
    run.lock,
    {
      platform: process.platform,
      writePid: true,
      onWaiting: holder => input.log(vmBuildWaitWords(holder?.saidPid ?? null)),
    },
    async () => {
      if (!input.force && (await checkImageDir(run.image)) === null)
        return { dir: run.image, built: false }
      const rootTarball = await ensurePinned(
        path.join(run.pinsDir, path.basename(pins.root.url)),
        pins.root,
        fetch,
      ).catch(e => {
        throw goneWords(e, pins)
      })
      const builder = await gatherBinary(input.stateDir, BUILDER)
      if (builder.state === "no-swiftc")
        throw new Error(
          "the lane VM's image builder needs Xcode's command line tools: `xcode-select --install`",
        )
      if (builder.state === "buildable")
        await buildBinary(builder.binary, BUILDER)
      await rm(run.scratch, { recursive: true, force: true })
      try {
        const apk = await readFile(
          path.join(run.pinsDir, path.basename(pins.kernel.url)),
        )
        await writeInitrdDir({
          dir: run.initrdDir,
          kernelApk: apk,
          modules: run.modules,
          init: path.join(BUILDER_DIR, "init"),
        })
        const src = path.join(run.initrdDir, "src")
        await mkdir(src)
        for (const name of IMAGE_FILES)
          await writeFile(path.join(src, name), sources[name])
        await writeInitrd({
          rootTarball,
          dir: run.initrdDir,
          scratch: run.scratch,
          initrd: run.initrd,
        })
        const disk = await open(run.disk.path, "w")
        await disk.truncate(run.disk.bytes)
        await disk.close()
        let isBuilt = false
        const ran = await runBuilder(builder.binary, run.builderArgs, line => {
          if (line === "[builder] built") isBuilt = true
          if (isBuildLogLine(line)) input.log(line)
        })
        if (!isBuilt)
          throw new Error(
            `the lane VM's image did not build:\n${ran.tail.join("\n")}`,
          )
        await mkdir(run.out)
        await exec("tar", ["-xf", run.disk.path, "-C", run.out])
        await writeFile(
          path.join(run.out, IMAGE_SOURCE_SUMS),
          imageSourceSums(sources),
        )
        const built = await installImage(run.out, run.image, input.force)
        return { dir: run.image, built }
      } finally {
        await rm(run.scratch, { recursive: true, force: true })
      }
    },
  )
  if (done.kind === "failed")
    throw new Error(
      `the lane VM's image build could not lock ${run.lock}: ${done.detail}`,
    )
  return done.value
}
