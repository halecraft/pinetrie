// host/host-refused — the one error a start throws as a refusal: its words
// say what to fix, and `server.ts` prints them and exits 1.

/**
 * Thrown by `startHost` when a host with tools cannot run its lanes here:
 * `findProject`'s refusal or the project's, worded with its fix, or a
 * preparation of the lanes that failed, worded with its step's error.
 */
export class HostRefused extends Error {}
