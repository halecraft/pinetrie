// machine/capabilities — what a backend can do to the store, as a value, so
// a planner plans only what is offered: on Linux nothing grows, and nothing
// is repaired.

/** Where the store is: the lane VM's data disk on the Mac, or Docker's own machine. */
export type StoreTarget = "lane-vm" | "docker-host"

export interface StoreCapabilities {
  /** The store's disk can be made larger: the lane VM's `data.img`, at its start. */
  readonly grow: boolean
  /**
   * The store's disk can be repaired offline: the lane VM's, its VM
   * stopped. Whether its repair boot is ready is another matter, found when
   * it would run.
   */
  readonly repairDisk: boolean
}

export const planStoreCapabilities = (
  target: StoreTarget,
): StoreCapabilities => ({
  grow: target === "lane-vm",
  repairDisk: target === "lane-vm",
})
