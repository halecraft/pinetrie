// protocol/messages — the host<->client contract, as plain values.
//
// ZERO imports. Not pi, not Kyneta, not Node. This file is the contract both
// sides agree on; binding it to a transport happens in protocol/line.mjs.

/** Line topic for the command channel (ADR-0007: commands over a Line). */
export const CONTROL_TOPIC = "pineta.control"

/** Document ids replicated host -> client (ADR-0007: state over documents). */
export const SESSION_DOC_ID = "pineta:session"

/**
 * Exchange id of the host. A Line is addressed to a peer id, so both sides must
 * agree on this string. The skeleton has exactly one host; discovery is a
 * thickening step, not a skeleton step.
 */
export const HOST_PEER_ID = "host"

export const COMMAND_KINDS = ["prompt"]

/**
 * Kyneta schemas are total: every field must be present on every message.
 * These defaults spell out the full shape, so callers spread rather than
 * remember it.
 *
 * NOTE (ADR-0013): there is deliberately no `seq` field anywhere in this
 * contract. `seq` is a replica-local arrival index and must never cross the
 * wire as a durable identifier. Entry `id` is the durable identifier.
 */
export const EMPTY_COMMAND = Object.freeze({
  id: "",
  kind: "prompt",
  text: "",
})

export const EMPTY_REPLY = Object.freeze({
  id: "",
  accepted: false,
  runId: "",
  errorCode: "",
  errorMessage: "",
})

export const command = (fields) => ({ ...EMPTY_COMMAND, ...fields })
export const reply = (fields) => ({ ...EMPTY_REPLY, ...fields })
