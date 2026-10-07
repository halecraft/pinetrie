// lanes/container/runtime — Apple's `container` as a `LaneRuntime`: the
// facts, plan and CLI modules composed, deciding nothing here.

import { SPEC_LABEL, specHash } from "../plan.ts"
import type { LaneRuntime } from "../runtime-port.ts"
import {
  buildImage,
  imageExists,
  imagePath,
  removeContainer,
  runContainer,
  runDisk,
  runInImage,
  startContainer,
  stopContainer,
} from "./cli.ts"
import { containerFacts, snapshotExists, volumeExists } from "./facts.ts"
import { type DiskPaths, labelled, laneVolume, renderRun } from "./plan.ts"

/**
 * `container` keeping lanes' disks at `paths`. `trimImage` is the image a
 * stopped lane's disk is trimmed with, pinetrie's default, which the host
 * builds after the runtime exists.
 */
export function containerRuntime(input: {
  readonly paths: DiskPaths
  readonly trimImage: () => Promise<string>
}): LaneRuntime {
  const { paths, trimImage } = input
  return {
    disk: op => runDisk(op, paths),
    diskExists: lane => volumeExists(laneVolume(lane)),
    snapshotExists: id => snapshotExists(paths, id),
    runArgs: renderRun,
    async run(shape) {
      const args = renderRun(shape)
      await runContainer(labelled(args, `${SPEC_LABEL}=${specHash(args)}`))
    },
    containerFacts,
    start: startContainer,
    stop: container => stopContainer(container, trimImage),
    remove: removeContainer,
    execArgv: (container, argv) => [
      "container",
      "exec",
      "-i",
      container,
      ...argv,
    ],
    imageExists,
    buildImage,
    imagePath,
    runInImage,
  }
}
