// web/storage-keys — the keys the page keeps your values under in the
// browser's storage (`tab-state.ts`): who you are, the sidebar's width and the
// inventory's dock. Each value's codec is the interface's.

/** Where the identity is kept, in the device's `localStorage`. */
export const IDENTITY_KEY = "pinetrie-identity"

/** The key the sidebar's width is kept under, in both slots. */
export const LIST_KEY = "pinetrie-list"

/** The key the inventory's dock is kept under in `localStorage`. */
export const DOCK_KEY = "pinetrie-inventory-dock"
