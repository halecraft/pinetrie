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
  IMAGE_FILES,
  IMAGE_OUTPUTS,
  type ImageSources,
  imageKey,
  imageRefusal,
  isBuildLogLine,
  parseSums,
  planLock,
  planVmBuildRun,
  type VmBuildRun,
} from "./plan.ts"
import { BUILDER, buildBinary, gatherBinary } from "./swift.ts"

const SOURCE_DIR = path.join(import.meta.dirname, "image")
const BUILDER_DIR = path.join(import.meta.dirname, "builder")

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

const exec = (program: string, args: readonly string[]) =>
  new Promise<void>((resolve, reject) =>
    execFile(program, args, { maxBuffer: 1 << 20 }, (error, _out, stderr) =>
      error === null
        ? resolve()
        : reject(new Error(`${program} ${args.join(" ")}: ${stderr.trim()}`)),
    ),
  )

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Run `body` holding `lock`, one build per image at a time: a lock a live
 * process holds is waited on, one whose holder is gone is broken.
 */
async function withLock<T>(lock: string, body: () => Promise<T>): Promise<T> {
  for (;;) {
    const taken = await writeFile(lock, String(process.pid), {
      flag: "wx",
    }).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") return false
        throw error
      },
    )
    if (taken) break
    const held = await readFile(lock, "utf8").catch(() => null)
    const holder = held === null ? null : Number.parseInt(held, 10)
    const step = planLock({
      holder: holder === null || Number.isNaN(holder) ? null : holder,
      alive: holder !== null && isAlive(holder),
    })
    if (step === "break") await rm(lock, { force: true })
    else if (step === "wait") await sleep(1000)
  }
  try {
    return await body()
  } finally {
    await rm(lock, { force: true })
  }
}

/**
 * Put the checked outputs in `from` at `image`. A whole image already there
 * is kept and ours discarded, unless `force`: a launcher may be starting
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

/** The initrd's own part: the modules, `m/order`, the builder's `init`, the image's sources. */
async function writeInitrdDir(
  run: VmBuildRun,
  apk: Uint8Array,
  sources: ImageSources,
): Promise<void> {
  const m = path.join(run.initrdDir, "m")
  const src = path.join(run.initrdDir, "src")
  await mkdir(m, { recursive: true })
  await mkdir(src, { recursive: true })
  const files = apkFiles(
    apk,
    run.modules.map(x => x.entry),
  )
  for (const { entry, as } of run.modules) {
    const gz = files.get(entry)
    if (gz === undefined)
      throw new Error(`the builder's kernel package holds no ${entry}`)
    await writeFile(path.join(m, as), gunzipSync(gz))
  }
  await writeFile(path.join(m, "order"), run.order)
  await copyFile(
    path.join(BUILDER_DIR, "init"),
    path.join(run.initrdDir, "init"),
  )
  await chmod(path.join(run.initrdDir, "init"), 0o755)
  for (const name of IMAGE_FILES)
    await writeFile(path.join(src, name), sources[name])
}

/** The initrd: the minirootfs as newc cpio, then our part, concatenated; both owned by root. */
async function writeInitrd(
  run: VmBuildRun,
  rootTarball: string,
): Promise<void> {
  const root = path.join(run.scratch, "root.cpio")
  const own = path.join(run.scratch, "own.cpio")
  await exec("bsdtar", ["--format", "newc", "-cf", root, `@${rootTarball}`])
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
    run.initrdDir,
    "m",
    "init",
    "src",
  ])
  const initrd = await open(run.initrd, "w")
  try {
    for (const part of [root, own]) await initrd.write(await readFile(part))
  } finally {
    await initrd.close()
  }
}

/** Run the builder, logging its console's build lines; its last lines name a failure. */
function runBuilder(
  binary: string,
  args: readonly string[],
  log: (line: string) => void,
): Promise<{ readonly built: boolean; readonly tail: readonly string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const tail: string[] = []
    let built = false
    const keep = (line: string) => {
      tail.push(line)
      if (tail.length > 30) tail.shift()
      if (line === "[builder] built") built = true
      if (isBuildLogLine(line)) log(line)
    }
    createInterface({ input: child.stdout }).on("line", keep)
    createInterface({ input: child.stderr }).on("line", keep)
    child.on("error", reject)
    child.on("close", code =>
      code === 0
        ? resolve({ built, tail })
        : reject(
            new Error(
              `the image's builder exited ${code}:\n${tail.join("\n")}`,
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
 * own. Waits for a build of the same image another process is making; a
 * whole image already there is kept unless `force`. Returns its directory,
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
  return withLock(run.lock, async () => {
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
      await writeInitrdDir(run, apk, sources)
      await writeInitrd(run, rootTarball)
      const disk = await open(run.disk.path, "w")
      await disk.truncate(run.disk.bytes)
      await disk.close()
      const ran = await runBuilder(builder.binary, run.builderArgs, input.log)
      if (!ran.built)
        throw new Error(
          `the lane VM's image did not build:\n${ran.tail.join("\n")}`,
        )
      await mkdir(run.out)
      await exec("tar", ["-xf", run.disk.path, "-C", run.out])
      const built = await installImage(run.out, run.image, input.force)
      return { dir: run.image, built }
    } finally {
      await rm(run.scratch, { recursive: true, force: true })
    }
  })
}
