# ADR-0006 — References live in their own namespace

**Status:** Superseded by ADR-0043 (references are withdrawn). Accepted

**Context.** "Annotation" was too small a frame. What is wanted is a *pointer*:
a conversation should be able to reference anything discussed — a span of an
earlier message, a file range, an image region, a URL, another branch.

**Decision.** A discriminated union of reference kinds, stored in a dedicated
namespace rather than as fields on entries.

**Realised by ADR-0017:** the dedicated namespace is pi's `pineta.reference`
value namespace.

**Consequences.** Backlinks are queryable in both directions for free. Two
orthogonal graphs over the same nodes: `parentId` is causal, references are
semantic. New reference kinds are additive. Anchor stability splits by target
mutability (entries: stable offsets; files: content-addressed; composer: Loro
cursors).
