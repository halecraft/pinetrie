// docker/target — where Docker is, and where a host path is on Docker's
// machine (ADR-0103). The Mac and Linux differ only in this value.

export interface DockerTarget {
  /** Docker's socket on the host. */
  readonly socket: string
  /** A host path as Docker's machine sees it: on the Mac, under the host's slot. */
  readonly pathOf: (hostPath: string) => string
  /** Labels every container made here carries (the slot, on the Mac). */
  readonly labels: Readonly<Record<string, string>>
  /** The ssh agent's socket on Docker's machine, for a lane granted ssh; null with none. */
  readonly sshAgent: string | null
}
