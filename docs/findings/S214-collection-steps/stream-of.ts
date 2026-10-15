import { Buffer } from "node:buffer"
export function streamOf(
  commands: readonly (readonly [cmd: number, path: string, pathTo?: string])[],
): Uint8Array {
  const attr = (type: number, text: string) => {
    const data = Buffer.from(text, "utf8")
    const head = Buffer.alloc(4)
    head.writeUInt16LE(type, 0)
    head.writeUInt16LE(data.length, 2)
    return Buffer.concat([head, data])
  }
  const command = (cmd: number, attrs: Buffer) => {
    const head = Buffer.alloc(10)
    head.writeUInt32LE(attrs.length, 0)
    head.writeUInt16LE(cmd, 4)
    return Buffer.concat([head, attrs])
  }
  const version = Buffer.alloc(4)
  version.writeUInt32LE(1, 0)
  return new Uint8Array(
    Buffer.concat([
      Buffer.from("btrfs-stream\0", "utf8"),
      version,
      ...commands.map(([cmd, p, to]) =>
        command(
          cmd,
          Buffer.concat([
            attr(15, p),
            ...(to === undefined ? [] : [attr(16, to)]),
          ]),
        ),
      ),
      command(21, Buffer.alloc(0)),
    ]),
  )
}
