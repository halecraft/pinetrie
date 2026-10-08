// web/main — the page's entry, which Vite serves directly. Everything that
// touches the browser as the page loads is here: the device's stores, who you
// are, the connection and the mount. `App` (`app.tsx`) is given them.

import { ExchangeProvider } from "@kyneta/react"
import {
  type Dock,
  decodeLayout,
  dockCodec,
  encodeLayout,
  type Identity,
  identityCodec,
  listWidthCodec,
} from "@pinetrie/interface"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { connectSession } from "@pinetrie/session"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App, type AppStores } from "./app.tsx"
import { askIdentity } from "./identity-form.tsx"
import { REVIEW_PREFS_KEY, reviewPrefsCodec } from "./review-prefs.ts"
import { DOCK_KEY, IDENTITY_KEY, LIST_KEY } from "./storage-keys.ts"
import { deviceState, tabState } from "./tab-state.ts"

const stores: AppStores = {
  /**
   * The tab you are on and each root's columns: this browser tab's, or on a
   * new one the device's latest (ADR-0027). The key predates tabs; the
   * layout's version tells an older one apart.
   */
  layout: tabState({
    key: `pinetrie-columns:${SESSION_DOC_ID}`,
    codec: {
      encode: encodeLayout,
      decode: decodeLayout,
    },
    tab: sessionStorage,
    device: localStorage,
  }),
  /**
   * Who this device says it is (ADR-0037), shared by its tabs. Another tab
   * clearing it, or storing another email, reloads this one too (below); a
   * new name for the same email reloads nothing.
   */
  identity: deviceState<Identity>({
    key: IDENTITY_KEY,
    codec: identityCodec,
    device: localStorage,
    events: window,
  }),
  /** Where the inventory panel is docked (ADR-0048): the device's, not the session's. */
  dock: deviceState<Dock>({
    key: DOCK_KEY,
    codec: dockCodec,
    device: localStorage,
    events: window,
  }),
  /**
   * The sidebar full or folded to icons (ADR-0088): this browser tab's choice,
   * or on a new one the device's latest.
   */
  list: tabState({
    key: LIST_KEY,
    codec: listWidthCodec,
    tab: sessionStorage,
    device: localStorage,
  }),
  /** How you read a review: wrapped, its file list folded (ADR-0087). */
  review: deviceState({
    key: REVIEW_PREFS_KEY,
    codec: reviewPrefsCodec,
    device: localStorage,
    events: window,
  }),
}

// connectSession owns the Exchange, so ExchangeProvider is handed that same
// connection rather than opening a second one. The e2e check drives the exact
// same function in Node.

const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`
const root = document.getElementById("root")
if (root === null) throw new Error("client/main: missing #root in the page")

// Who you are: your email, asked once per device and shared by its tabs, so a
// reload, another tab and another device with the same email are one person
// (ADR-0037). Kyneta gives each tab its own seat.
const identity =
  stores.identity.load() ?? stores.identity.save(await askIdentity(root))
stores.identity.subscribe(next => {
  if (next?.email !== identity.email) location.reload()
})
const session = await connectSession({
  url: wsUrl,
  WebSocket,
  principal: identity.email,
})
createRoot(root).render(
  <StrictMode>
    <ExchangeProvider exchange={session.exchange}>
      <App session={session} stores={stores} />
    </ExchangeProvider>
  </StrictMode>,
)
