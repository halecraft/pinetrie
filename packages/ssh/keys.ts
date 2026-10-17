// ssh/keys — whether a key pair in the service folder can be a service
// identity, decided from its files before anything runs: `ssh-add` would
// otherwise ask for a passphrase no one is there to type.

import { ascii, wireReader } from "./wire.ts"

/** A key pair's files, as the host read them. */
interface ServiceKeyFiles {
  /** Its file name in the folder: the identity's name. */
  readonly name: string
  readonly path: string
  readonly privateText: string
  /** The private key's mode bits. */
  readonly mode: number
  /** The `.pub` beside it; null when there is none. */
  readonly pub: string | null
}

export interface UsableServiceKey {
  readonly name: string
  readonly path: string
  /** The public key's line. */
  readonly pub: string
  /** Its key blob, base64, as an agent lists it. */
  readonly blob: string
}

export type ServiceKeyRefusal =
  /** Group or others may read it, which ssh refuses. */
  | "readable"
  /** It has a passphrase: nobody is there to type it. */
  | "passphrase"
  | "no-pub"
  | "not-a-key"

export type ServiceKeyCheck =
  | { readonly kind: "usable"; readonly key: UsableServiceKey }
  | {
      readonly kind: "refused"
      readonly name: string
      readonly why: ServiceKeyRefusal
    }

/**
 * A public key line's blob, base64; null for a line that is not one. A
 * blob begins with its own key type, as a string, which the line names too.
 */
export function pubBlob(line: string): string | null {
  const [type, blob] = line.trim().split(/\s+/)
  if (type === undefined || blob === undefined) return null
  if (!/^[A-Za-z0-9+/]+=*$/.test(blob)) return null
  const named = wireReader(Buffer.from(blob, "base64")).string()
  return named !== null && ascii(named) === type ? blob : null
}

const OPENSSH =
  /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/
const MAGIC = "openssh-key-v1\0"

/**
 * Whether a private key's text is encrypted; null for text that is no key
 * this reads. An `openssh-key-v1` key names its cipher after the magic, and
 * `none` is a key without a passphrase; a PEM key says `ENCRYPTED`.
 */
export function isEncrypted(text: string): boolean | null {
  const openssh = OPENSSH.exec(text)?.[1]
  if (openssh !== undefined) {
    const r = wireReader(Buffer.from(openssh.replace(/\s/g, ""), "base64"))
    const magic = r.bytes(MAGIC.length)
    if (magic === null || ascii(magic) !== MAGIC) return null
    const cipher = r.string()
    return cipher === null ? null : ascii(cipher) !== "none"
  }
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(text)) return true
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text))
    return /^Proc-Type:\s*4,ENCRYPTED/m.test(text)
  return null
}

export function serviceKeyCheck(files: ServiceKeyFiles): ServiceKeyCheck {
  const refused = (why: ServiceKeyRefusal): ServiceKeyCheck => ({
    kind: "refused",
    name: files.name,
    why,
  })
  // ssh refuses a private key with any group or other bit set.
  if ((files.mode & 0o077) !== 0) return refused("readable")
  const encrypted = isEncrypted(files.privateText)
  if (encrypted === null) return refused("not-a-key")
  if (encrypted) return refused("passphrase")
  if (files.pub === null) return refused("no-pub")
  const blob = pubBlob(files.pub)
  if (blob === null) return refused("no-pub")
  return {
    kind: "usable",
    key: { name: files.name, path: files.path, pub: files.pub.trim(), blob },
  }
}
