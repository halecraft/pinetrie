// @pinetrie/channel — a held JSON-lines channel to a server process: a
// lane's helper, or lanehost's (TECHNICAL.md).

export { type Channel, openChannel } from "./client.ts"
export { type RunResult, runCommand } from "./run.ts"
export { type ServeContext, serve } from "./serve.ts"
export { decode, encode, type Reply, type Request } from "./wire.ts"
