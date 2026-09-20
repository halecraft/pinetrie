// storage/pi-deep — the few pi entry points that have no public export.
//
// `createAgentHarness`, `addUsage`/`emptyUsage` and `ModelRuntime` are real,
// stable parts of pi's surface but are not listed in either package's
// `exports` map, so a package specifier is refused. A file URL bypasses the
// map. Every such import is collected HERE so the blast radius of pi's
// churn is one file (roadmap: "keep `Storage` the only deep coupling").
//
// Verified export maps at 0.85.0:
//   @earendil-works/pi-agent-core  -> ".", "./node", "./harness/context",
//        "./harness/env/nodejs", "./harness/runtime/reducer",
//        "./harness/session", "./harness/session/testing"
//   @earendil-works/pi-coding-agent -> ".", "./rpc-entry", "./client",
//        "./experimental/plugin"
// `@earendil-works/pi-coding-agent`'s root ALSO cannot be imported here: it
// pulls in dist/experimental/server.js, which requires `@earendil-works/pi-server`,
// a package the install does not ship. So ModelRuntime must come from its file.

const base = new URL("../node_modules/", import.meta.url)
const deep = (p) => import(new URL(p, base).href)

const usage = await deep("@earendil-works/pi-agent-core/dist/harness/utils/usage.js")
const runtime = await deep("@earendil-works/pi-agent-core/dist/harness/runtime/index.js")
const modelRuntime = await deep("@earendil-works/pi-coding-agent/dist/core/model-runtime.js")

export const { addUsage, emptyUsage } = usage
export const { createAgentHarness } = runtime
export const { ModelRuntime } = modelRuntime
