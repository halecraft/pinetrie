// Mutations for @pinetrie/vm. Run: pnpm mutate scripts/mutations/vm.ts
// Unit tests only: the image's build and boot are checked on the Mac.
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/vm"]

export const mutations: readonly Mutation[] = [
  {
    name: "the image's key ignores its scripts",
    file: "packages/vm/plan.ts",
    from: "  for (const name of IMAGE_FILES) hash.update(",
    to: '  for (const name of ["manifest.json"] as const) hash.update(',
    command: unit,
    expect: "imageKey: stable, and changed by any of the image's sources",
  },
  {
    name: "a built image whose file differs from its sum is used",
    file: "packages/vm/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    if (have !== want) return `${name} does not match SHA256SUMS`\n",
    to: "",
    command: unit,
    expect: "each output must be there, named, with its hash",
  },
  {
    name: "a build is renamed into place unchecked",
    file: "packages/vm/build.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    if (refused !== null) throw new Error(`the built VM image: ${refused}`)\n",
    to: "",
    command: unit,
    expect: "an image whose files do not match its sums is refused",
  },
  {
    name: "the VM's init keeps the probes' root shell",
    file: "packages/vm/image/init",
    from: "socat -t 3600 VSOCK-LISTEN:2375,reuseaddr,fork UNIX-CONNECT:/var/run/docker.sock &\n",
    to: "socat -t 3600 VSOCK-LISTEN:2375,reuseaddr,fork UNIX-CONNECT:/var/run/docker.sock &\nsocat -t 3600 VSOCK-LISTEN:2376,reuseaddr,fork EXEC:/bin/sh,stderr &\n",
    command: unit,
    expect: "the VM's init opens no shell on any vsock port",
  },
  {
    name: "vm declares lanes",
    file: "packages/vm/package.json",
    from: '    "@pinetrie/core": "workspace:*"\n',
    to: '    "@pinetrie/core": "workspace:*",\n    "@pinetrie/lanes": "workspace:*"\n',
    command: ["pnpm", "exec", "vitest", "run", "workspace.test.ts"],
    expect: "vm declares only core: it knows nothing of lanes",
  },
  {
    name: "the image is built in Apple's container though the VM's Docker runs",
    file: "apps/pinetrie/host/work/runtime.ts",
    from: '  if (f.vmDocker) return { kind: "docker-vm" }\n',
    to: "",
    command: [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "apps/pinetrie/host/work/runtime.test.ts",
    ],
    expect: "the VM's own Docker first, on any platform",
  },
  {
    name: "a source given read-only and read-write is shared read-only",
    file: "packages/vm/plan.ts",
    from: "    readOnly.set(d.source, (readOnly.get(d.source) ?? true) && d.readOnly)",
    to: "    readOnly.set(d.source, d.readOnly)",
    command: unit,
    expect: "one entry per source, read-write if either is",
  },
  {
    name: "a running VM is not joined without an image",
    file: "packages/vm/plan.ts",
    from: '  if (f.answering) return { kind: "join" }\n',
    to: "",
    command: unit,
    expect: "a running VM is joined; else one is started",
  },
  {
    name: "the VM's memory has no floor",
    file: "packages/vm/plan.ts",
    from: "Math.max(4 * GiB, ",
    to: "Math.max(0, ",
    command: unit,
    expect: "vmMemory: a quarter of the Mac's, between 4 and 16 GiB",
  },
  {
    name: "a lease fills its slot twice",
    file: "packages/vm/lease.ts",
    from: '      if (filled) throw new Error("a slot is filled once")\n',
    to: "",
    command: unit,
    expect: "a lease: a slot, then one fill with the slot's entries",
  },
  {
    name: "a launcher's message of an unknown kind is read as one it knows",
    file: "packages/vm/protocol.ts",
    from: "    default:\n      return null\n  }\n}\n\n/** A line to the launcher",
    to: '    default:\n      return { kind: "filled" }\n  }\n}\n\n/** A line to the launcher',
    command: unit,
    expect:
      "an unknown kind, an unknown reason, or a malformed field is refused",
  },
]
