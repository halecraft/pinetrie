import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { installImage, readImageSourceSums } from "./build.ts"
import { sha256Hex } from "./pinned.ts"
import {
  type BuilderPins,
  IMAGE_OUTPUTS,
  IMAGE_SOURCE_SUMS,
  type ImageSources,
  imageSourceSums,
  parseSums,
} from "./plan.ts"

const imageFile = (name: string) =>
  readFileSync(path.join(import.meta.dirname, "image", name), "utf8")

describe("the image's sources", () => {
  const manifest = JSON.parse(imageFile("manifest.json")) as {
    packages: Record<string, string>
    stage1: string[]
    modules: string[]
  }
  test("every package is pinned to an exact version", () => {
    for (const [name, version] of Object.entries(manifest.packages))
      expect(version, name).toMatch(/^\d[\w.]*-r\d+$/)
  })
  test("the scripts parse", () => {
    for (const name of ["build.sh", "init", "clock", "stage1-init"])
      execFileSync("sh", ["-n", path.join(import.meta.dirname, "image", name)])
  })
  test("the VM's init opens no shell on any vsock port", () => {
    const init = imageFile("init")
    expect(init).not.toMatch(/EXEC:[^\s]*sh/)
    expect(init).not.toMatch(/SYSTEM:[^']*'[^']*\bsh\b/)
  })
  test("Docker reaches the Mac only behind the lanes' fence", () => {
    const init = imageFile("init")
    const fenced = init.indexOf("if ! fence; then")
    const bridged = init.indexOf("VSOCK-LISTEN:2375")
    expect(fenced).toBeGreaterThan(0)
    expect(bridged).toBeGreaterThan(fenced)
  })
  test("the fence rejects gvproxy's network but the gateway's DNS", () => {
    const init = imageFile("init")
    expect(init).toContain(
      "iptables -I DOCKER-USER -d 192.168.127.0/24 -j REJECT",
    )
    expect(init).toContain(
      "iptables -I DOCKER-USER -d 192.168.127.1 -p udp --dport 53 -j RETURN",
    )
    expect(init).toContain(
      "iptables -I DOCKER-USER -d 192.168.127.1 -p tcp --dport 53 -j RETURN",
    )
  })
  test("the init starts the clock on the RTC, which build.sh installs", () => {
    expect(imageFile("init")).toContain(
      "/usr/local/sbin/pinetrie-clock /sys/class/rtc/rtc0/since_epoch &",
    )
    expect(imageFile("build.sh")).toContain(
      'cp "$src/clock" "$root/usr/local/sbin/pinetrie-clock"',
    )
  })
  test("the init loads the manifest's modules, which build.sh writes", () => {
    expect(imageFile("init")).toContain(
      "modprobe -a $(cat /etc/pinetrie/modules)",
    )
    expect(imageFile("build.sh")).toContain(
      `jq -r '.modules[]' "$m" > "$root/etc/pinetrie/modules"`,
    )
  })
})

describe("the clock", () => {
  /** One check of `clock` with the clock at `now` and the RTC at `rtc`: whether it stepped, and what it said. */
  async function check(now: number, rtc: number) {
    const dir = await mkdtemp(path.join(tmpdir(), "vm-clock-"))
    try {
      const bin = path.join(dir, "bin")
      await mkdir(bin)
      const stub = async (name: string, body: string) =>
        writeFile(path.join(bin, name), `#!/bin/sh\n${body}\n`, {
          mode: 0o755,
        })
      await stub("date", `[ "$1" = +%s ] && echo ${now}`)
      const stepped = path.join(dir, "stepped")
      await stub("hwclock", `echo "$*" > ${stepped}`)
      await writeFile(path.join(dir, "rtc"), `${rtc}\n`)
      const said = execFileSync(
        "sh",
        [
          path.join(import.meta.dirname, "image", "clock"),
          path.join(dir, "rtc"),
          "once",
        ],
        { env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" },
      )
      return {
        stepped: existsSync(stepped)
          ? readFileSync(stepped, "utf8").trim()
          : null,
        said,
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  test("a clock behind the RTC is stepped to it, in UTC", async () => {
    expect(await check(1_000, 60_000)).toEqual({
      stepped: "-s -u",
      said: "clock: stepped 59000 s to the RTC\n",
    })
  })
  test("a clock ahead of the RTC is stepped to it", async () => {
    expect((await check(60_000, 1_000)).stepped).toBe("-s -u")
  })
  test("a clock within 2 s of the RTC is left alone", async () => {
    for (const now of [9_998, 10_000, 10_002])
      expect(await check(now, 10_000)).toEqual({ stepped: null, said: "" })
  })
})

describe("the builder's pins", () => {
  const manifest = JSON.parse(imageFile("manifest.json")) as {
    alpine: string
    arch: string
    packages: Record<string, string>
  }
  const pins = JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, "builder", "pins.json"),
      "utf8",
    ),
  ) as BuilderPins
  test("the builder boots the kernel the image ships, on the manifest's root", () => {
    expect(pins.kernel.version).toBe(manifest.packages["linux-virt"])
    expect(pins.root.version).toBe(
      manifest.packages["alpine-base"]?.replace(/-r\d+$/, ""),
    )
  })
  test("each pin's URL names its version, the manifest's branch and arch", () => {
    for (const pin of [pins.kernel, pins.root]) {
      expect(pin.url).toContain(`/v${manifest.alpine}/`)
      expect(pin.url).toContain(manifest.arch)
      expect(pin.url).toContain(pin.version)
      expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
  test("the repair's packages are Alpine's, on the manifest's branch, its btrfs-progs the image's", () => {
    const btrfs = pins.repair.packages.find(p => p.name === "btrfs-progs")
    expect(btrfs?.version).toBe(manifest.packages["btrfs-progs"])
    for (const pin of pins.repair.packages) {
      expect(pin.url).toContain(`/v${manifest.alpine}/main/${manifest.arch}/`)
      expect(path.basename(pin.url)).toBe(`${pin.name}-${pin.version}.apk`)
      expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
  test("the repair's init parses, and prints sizes whole past 2³¹", () => {
    const init = path.join(import.meta.dirname, "builder", "repair-init")
    execFileSync("sh", ["-n", init])
    const text = readFileSync(init, "utf8")
    expect(text).toContain("%.0f")
    expect(text).not.toMatch(/printf[^\n]*%d/)
  })
  test("the builder's init parses, and writes to its one disk", () => {
    const init = path.join(import.meta.dirname, "builder", "init")
    execFileSync("sh", ["-n", init])
    expect(readFileSync(init, "utf8")).toContain("-cf /dev/vda")
  })
})

describe("installImage", () => {
  /** A directory of outputs with their sums, or with sums that do not hold. */
  async function outputs(root: string, name: string, bad = false) {
    const dir = path.join(root, name)
    await mkdir(dir, { recursive: true })
    const lines: string[] = []
    for (const o of IMAGE_OUTPUTS) {
      await writeFile(path.join(dir, o), `${name}:${o}`)
      lines.push(`${sha256Hex(bad ? "x" : `${name}:${o}`)}  ${o}`)
    }
    await writeFile(path.join(dir, "SHA256SUMS"), `${lines.join("\n")}\n`)
    return dir
  }
  const dirs: string[] = []
  afterEach(async () => {
    for (const d of dirs.splice(0))
      await rm(d, { recursive: true, force: true })
  })
  const temp = async () => {
    const d = await mkdtemp(path.join(tmpdir(), "pinetrie-install-"))
    dirs.push(d)
    return d
  }

  test("an image whose files do not match its sums is refused", async () => {
    const root = await temp()
    const from = await outputs(root, "new", true)
    await expect(
      installImage(from, path.join(root, "key"), false),
    ).rejects.toThrow("does not match SHA256SUMS")
    expect(existsSync(path.join(root, "key"))).toBe(false)
  })
  test("a whole image already there is kept, and the build discarded", async () => {
    const root = await temp()
    const there = await outputs(root, "key")
    const from = await outputs(root, "new")
    expect(await installImage(from, there, false)).toBe(false)
    expect(readFileSync(path.join(there, "Image"), "utf8")).toBe("key:Image")
  })
  test("an image that is not whole is replaced", async () => {
    const root = await temp()
    const there = await outputs(root, "key")
    await rm(path.join(there, "Image"))
    const from = await outputs(root, "new")
    expect(await installImage(from, there, false)).toBe(true)
    expect(readFileSync(path.join(there, "Image"), "utf8")).toBe("new:Image")
  })
  test("a forced build replaces a whole image", async () => {
    const root = await temp()
    const there = await outputs(root, "key")
    const from = await outputs(root, "new")
    expect(await installImage(from, there, true)).toBe(true)
    expect(readFileSync(path.join(there, "Image"), "utf8")).toBe("new:Image")
    expect(await readdir(root)).toEqual(["key"])
  })
})

test("an image's sources record is read from its directory, null when it has none", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-sums-"))
  try {
    expect(await readImageSourceSums(dir)).toBeNull()
    const sources: ImageSources = {
      "manifest.json": "{}",
      "build.sh": "b",
      init: "i",
      clock: "c",
      "stage1-init": "s",
      "daemon.json": "{}",
    }
    await writeFile(path.join(dir, IMAGE_SOURCE_SUMS), imageSourceSums(sources))
    expect(await readImageSourceSums(dir)).toEqual(
      parseSums(imageSourceSums(sources)),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
