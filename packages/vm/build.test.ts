import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { buildVmImage, planBuild, type Ran, readImageSources } from "./build.ts"
import { IMAGE_FILES, IMAGE_OUTPUTS, imageDir, imageKey } from "./plan.ts"

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
    for (const name of ["build.sh", "init", "stage1-init"])
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
  test("the init loads the manifest's modules, which build.sh writes", () => {
    expect(imageFile("init")).toContain(
      "modprobe -a $(cat /etc/pinetrie/modules)",
    )
    expect(imageFile("build.sh")).toContain(
      `jq -r '.modules[]' "$m" > "$root/etc/pinetrie/modules"`,
    )
  })
})

test("planBuild: Alpine at the manifest's branch, each source an argument, the outputs a tar on stdout", async () => {
  const sources = await readImageSources()
  const { image, argv } = planBuild(sources)
  expect(image).toBe("docker.io/library/alpine:3.23")
  expect(argv.slice(0, 2)).toEqual(["sh", "-c"])
  expect(argv[2]).toContain("sh /src/build.sh /src /out >&2")
  expect(argv[2]).toContain(
    `tar -C /out -cf - SHA256SUMS ${IMAGE_OUTPUTS.join(" ")}`,
  )
  const pairs = argv.slice(4)
  expect(pairs.length).toBe(IMAGE_FILES.length * 2)
  for (const [i, name] of IMAGE_FILES.entries()) {
    expect(pairs[i * 2]).toBe(name)
    expect(Buffer.from(pairs[i * 2 + 1] ?? "", "base64").toString()).toBe(
      sources[name],
    )
  }
})

describe("buildVmImage", () => {
  /** A build that writes `outputs` as a tar, with their sums, or bad ones. */
  async function fakeBuild(bad: boolean): Promise<Ran> {
    const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-vm-out-"))
    const lines: string[] = []
    for (const name of IMAGE_OUTPUTS) {
      await writeFile(path.join(dir, name), name)
      const hash = createHash("sha256")
        .update(bad ? "x" : name)
        .digest("hex")
      lines.push(`${hash}  ${name}`)
    }
    await writeFile(path.join(dir, "SHA256SUMS"), `${lines.join("\n")}\n`)
    const stdout = execFileSync("tar", ["-C", dir, "-cf", "-", "."])
    await rm(dir, { recursive: true })
    return { ok: true, code: 0, stdout, stderr: "[vm-build] built\n" }
  }

  test("builds once into the key's directory, then uses what is there", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "pinetrie-vm-"))
    try {
      let runs = 0
      const run = async () => {
        runs += 1
        return fakeBuild(false)
      }
      const logged: string[] = []
      const first = await buildVmImage({
        stateDir,
        run,
        log: l => logged.push(l),
      })
      const key = imageKey(await readImageSources())
      expect(first).toEqual({ dir: imageDir(stateDir, key), built: true })
      expect(logged).toContain("[vm-build] built")
      expect(
        await buildVmImage({ stateDir, run, log: () => {} }),
      ).toMatchObject({ built: false })
      expect(runs).toBe(1)
      expect(await readdir(path.join(stateDir, "images"))).toEqual([key])
    } finally {
      await rm(stateDir, { recursive: true, force: true })
    }
  })

  test("an image whose files do not match its sums is refused, and nothing is left", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "pinetrie-vm-"))
    try {
      await mkdir(path.join(stateDir, "images"), { recursive: true })
      await expect(
        buildVmImage({ stateDir, run: () => fakeBuild(true), log: () => {} }),
      ).rejects.toThrow("does not match SHA256SUMS")
      expect(await readdir(path.join(stateDir, "images"))).toEqual([])
      expect(existsSync(path.join(stateDir, "images"))).toBe(true)
    } finally {
      await rm(stateDir, { recursive: true, force: true })
    }
  })

  test("a failed build says so", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "pinetrie-vm-"))
    try {
      await expect(
        buildVmImage({
          stateDir,
          run: async () => ({
            ok: false,
            code: 1,
            stdout: new Uint8Array(),
            stderr: "[vm-build] Alpine 3.23 no longer has: x=1-r0",
          }),
          log: () => {},
        }),
      ).rejects.toThrow("the VM image's build failed (exit 1)")
    } finally {
      await rm(stateDir, { recursive: true, force: true })
    }
  })
})
