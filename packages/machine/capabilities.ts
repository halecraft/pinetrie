// machine/capabilities — what a backend can do to the store, as a value, so
// a planner plans only what is offered: on Linux nothing grows.

/** Where the store is: the lane VM's data disk on the Mac, or Docker's own machine. */
export type StoreTarget = "lane-vm" | "docker-host"

export interface Capabilities {
  /** The store's disk can be made larger: the lane VM's `data.img`, at its start. */
  readonly grow: boolean
}

export const planCapabilities = (target: StoreTarget): Capabilities => ({
  grow: target === "lane-vm",
})
