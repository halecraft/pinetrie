// The walk's diff (packages/lanehost/walk.ts) between two snapshots, as JSON.
import { compareTrees, walkTree } from "../../../packages/lanehost/walk.ts"

const [a, b] = process.argv.slice(2)
console.log(JSON.stringify(compareTrees(await walkTree(a), await walkTree(b))))
