# ADR-0002 — Kyneta is the storage of record; JSONL becomes an exporter

- **Status:** Accepted
- **Area:** `docs/01-architecture.md`

**Context.** Initially framed as "dual-write to pi's v4 JSONL for interop, or
single-write to Kyneta and fork the ecosystem." Investigation showed the second
horn is wrong (see ADR-0003): the ecosystem binds to the *lane/session API*, not
the file format.

**Decision.** Single-write to Kyneta. Provide a v4 JSONL **exporter** if
interchange is needed.

**Consequences.** Lost: session *interchange* — terminal `pi` cannot `/resume`
or `/tree` our sessions; `pi-acp`/Zed cannot see them; `--fork`, `/export`,
`/share`, and session pickers are path-based. Kept: skills, extensions, prompt
templates, MCP, subagents, compaction, providers — everything that is actually
the moat. An exporter is far cheaper to maintain than two live write paths.

**Alternatives rejected.** *Dual-write* — two live write paths that must agree,
for a benefit (TUI interop) we do not need in v1.
