// lanehost/layout — where a project's disks are in the lanes directory, and
// which names may stand for one. Every path the server touches is built here
// from names it has checked, so a call can never name a path outside its
// project.
//
//   <lanesDir>/projects/<projectKey>/root            the project's root path
//   <lanesDir>/projects/<projectKey>/lanes/<lane>    each lane's subvolume, and
//                                                    `folder-line` while a read makes a state
//   <lanesDir>/projects/<projectKey>/snapshots/<id>  snapshots, the base too
//   <lanesDir>/projects/<projectKey>/nested/<lane>   a nested lane's inner lanes
//   <lanesDir>/projects/<projectKey>/states/<lane>   a folder lane's states, which
//                                                    its container sees read-only

import { isDiskName } from "@pinetrie/core"

/** Where one project's disks are on Docker's machine. */
export function projectDisks(lanesDir: string, key: string) {
  const dir = `${lanesDir}/projects/${key}`
  return {
    dir,
    root: `${dir}/root`,
    lanes: `${dir}/lanes`,
    snapshots: `${dir}/snapshots`,
    nestedDir: `${dir}/nested`,
    statesDir: `${dir}/states`,
    lane: (lane: string) => `${dir}/lanes/${lane}`,
    nested: (lane: string) => `${dir}/nested/${lane}`,
    snapshot: (id: string) => `${dir}/snapshots/${id}`,
    states: (lane: string) => `${dir}/states/${lane}`,
  }
}
export type ProjectDisks = ReturnType<typeof projectDisks>

/** A project's key: 16 hex digits (`projectKey`, a hash of its root). */
export const isProjectKey = (key: string): boolean => /^[0-9a-f]{16}$/.test(key)

/** `name`, checked to be a disk's (`isDiskName`); throws on any other. */
export const checkedDiskName = (name: string): string => {
  if (!isDiskName(name))
    throw new Error(`not a disk's name: ${JSON.stringify(name)}`)
  return name
}

/**
 * The disk a read of your folder is made on (`readIn`): restored from your
 * folder's newest state, then dropped once snapshotted. No thread's id is a
 * disk name with this shape.
 */
export const FOLDER_LINE = "folder-line"

/** Where the disks role sees the project's root, read-only. */
export const FOLDER_MOUNT = "/pinetrie-folder"

/** The directory on a disk that holds pine·trie's own files. */
export const LANE_FILES = ".pinetrie-lane"
