import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import { hostJjVersion, prepareImages } from "./image.ts"
import {
  filesContainerfileCopies,
  type ImagePlan,
  planImages,
} from "./image-plan.ts"

const here = (...p: string[]) => path.join(import.meta.dirname, ...p)
const json = (file: string) =>
  JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>

test("both daemons cap BuildKit's cache with one setting; the lane's keeps runc's NoNewKeyring", () => {
  const lane = json(here("image", "daemon.json"))
  const vm = json(here("..", "vm", "image", "daemon.json"))
  expect(lane.builder).toEqual(vm.builder)
  expect(lane["default-runtime"]).toBe("nokeyring")
  expect(lane.runtimes).toEqual({
    nokeyring: {
      runtimeType: "io.containerd.runc.v2",
      options: { NoNewKeyring: true },
    },
  })
})

test("the files a Containerfile copies in, never another stage's", () => {
  expect(
    filesContainerfileCopies(
      [
        "FROM node AS build",
        "COPY --chown=1000:1000 a.json b.txt /etc/x/",
        "add c.tar /opt",
        "COPY --from=build /out /out",
        "RUN echo COPY d e",
      ].join("\n"),
    ),
  ).toEqual(["a.json", "b.txt", "c.tar"])
})

test("the default image copies in its daemon.json, bash's checksums and patch, and mkfifo's source, so a change to one is a new tag", () => {
  expect(
    filesContainerfileCopies(
      readFileSync(here("image", "Containerfile"), "utf8"),
    ),
  ).toEqual([
    "bash/SHA256SUMS",
    "bash/apply.py",
    "bash/mkfifo.c",
    "daemon.json",
  ])
})

test("the default image's tag follows the files it copies in", async () => {
  const given: ImagePlan[] = []
  const { runtimeFrom } = await prepareImages(
    {
      ensureLaneImages: async plans => {
        given.push(...plans)
      },
    },
    here("no-such-project"),
    "1.64.1",
  )
  const containerfile = here("image", "Containerfile")
  const tagWith = async (sources: readonly string[]) =>
    planImages({
      pinetrie: {
        file: containerfile,
        content: readFileSync(containerfile, "utf8"),
        sources,
      },
      project: null,
      jjVersion: await hostJjVersion(),
      playwrightVersion: "1.64.1",
    }).pinetrie.tag
  expect(given.map(p => p.tag)).toEqual([runtimeFrom])
  expect(runtimeFrom).toBe(
    await tagWith(
      ["bash/SHA256SUMS", "bash/apply.py", "bash/mkfifo.c", "daemon.json"].map(
        f => readFileSync(here("image", f), "utf8"),
      ),
    ),
  )
  expect(runtimeFrom).not.toBe(await tagWith([]))
})

test("the default image downloads each tool for the machine it is built on, naming no architecture", () => {
  const urls =
    readFileSync(here("image", "Containerfile"), "utf8").match(
      /https:\/\/\S+/g,
    ) ?? []
  expect(urls.length).toBeGreaterThan(0)
  for (const url of urls)
    expect(url, url).not.toMatch(/aarch64|x86_64|arm64|amd64/)
})
