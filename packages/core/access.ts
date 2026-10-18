// core/access — the owner's answers to a lane's use of their ssh identity.

/** What the owner can say to a lane's use of their ssh identity. */
export type AccessAnswer = "approve" | "refuse" | "revoke"
