// lanehost/layout — where a project's disks are in the lanes directory, and
// which names may stand for one. Every path the server touches is built here
// from names it has checked, so a call can never name a path outside its
// project.
//
//   <lanesDir>/projects/<projectKey>/root            the project's root path
//   <lanesDir>/projects/<projectKey>/lanes/<lane>    each lane's subvolume
//   <lanesDir>/projects/<projectKey>/snapshots/<id>  snapshots, the base too
//   <lanesDir>/projects/<projectKey>/nested/<lane>   a nested lane's inner lanes

/** Where one project's disks are on Docker's machine. */
export function projectDisks(lanesDir: string, key: string) {
  const dir = `${lanesDir}/projects/${key}`
  return {
    dir,
    root: `${dir}/root`,
    lanes: `${dir}/lanes`,
    snapshots: `${dir}/snapshots`,
    nestedDir: `${dir}/nested`,
    lane: (lane: string) => `${dir}/lanes/${lane}`,
    nested: (lane: string) => `${dir}/nested/${lane}`,
    snapshot: (id: string) => `${dir}/snapshots/${id}`,
  }
}
export type ProjectDisks = ReturnType<typeof projectDisks>

/** A project's key: 16 hex digits (`projectKey`, a hash of its root). */
export const isProjectKey = (key: string): boolean => /^[0-9a-f]{16}$/.test(key)

/**
 * A lane's or a snapshot's name: one path segment, never `.` or `..`, and
 * never ending in `.tmp`, which a snapshot in the making holds.
 */
export const isDiskName = (name: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.endsWith(".tmp")

/** A file pine·trie keeps on a disk, under `.pinetrie-lane/`. */
export const isLaneFile = (name: string): boolean =>
  /^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)

/** The directory on a disk that holds pine·trie's own files. */
export const LANE_FILES = ".pinetrie-lane"
