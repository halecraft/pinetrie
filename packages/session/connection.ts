// session/connection — `@pinetrie/session/connect`: connecting to a host and
// minting ids, which name the runtime's globals (`WebSocket`, `crypto`,
// timers). Kept out of the main entry, so pure code that imports the session
// never reaches them.

export { type ConnectOptions, connectSession } from "./connect.ts"
export {
  newCanvasId,
  newCardId,
  newImageId,
  newMediaId,
  newNoteColumnId,
  newReferenceCardId,
  newRootId,
  newThreadId,
} from "./ids.ts"
