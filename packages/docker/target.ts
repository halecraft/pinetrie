// docker/target — where Docker is, and where a host path is on Docker's
// machine. The Mac and Linux differ only in this value.

export interface DockerTarget {
  /** Docker's socket on the host. */
  readonly socket: string
  /** A host path as Docker's machine sees it: on the Mac, under the host's slot. */
  readonly pathOf: (hostPath: string) => string
  /** Labels every container made here carries (the slot, on the Mac). */
  readonly labels: Readonly<Record<string, string>>
  /**
   * The host's socket on Docker's machine, mounted where a lane's shape says
   * (`ContainerShape.hostSocket`); null with none. On the Mac a slot's socket
   * in the VM, which the launcher bridges to the one the lease named.
   */
  readonly hostSocket: string | null
  /**
   * Where a lane reaches the host's loopback, for the ports a project
   * grants (`lanes.hostPorts`): gvproxy's host address in the Mac's lane VM;
   * null where there is none (Linux).
   */
  readonly hostAddress: string | null
  /**
   * Host paths reach Docker's machine over virtiofs (the Mac's lane VM),
   * where only a fresh lstat reads a file's stamp as the host's: the
   * observer reads a shared directory's that way.
   */
  readonly remoteHostPaths: boolean
}
