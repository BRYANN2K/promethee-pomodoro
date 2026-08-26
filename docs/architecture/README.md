# Architecture

The repository uses Electron/TypeScript/npm as its only product contract. Synthetic or mock-backed slices remain explicitly separate from complete product/platform evidence.

## Target Electron architecture

- [Target architecture](target-architecture.md) — layers, runtime components, trust boundaries, and open choices.
- [Build order](build-order.md) — dependency-ordered delivery changes plus proposed transport/research paths and their exit gates.
- [Pomodoro state machine](pomodoro-state-machine.md) — deterministic states, events, timing, and invariants.
- [Proposed Promethee bridge contract](promethee-bridge-contract.md) — capability negotiation, commands, events, errors, and security.
- [Compatibility and security](compatibility-and-security.md) — evidence boundary, threats, and failure behavior.
- [Architecture decision records](decisions/README.md) — durable choices, consequences, and revisit triggers.

ADR-0014 accepts the companion's external bridge by composing the strict ADR-0012/ADR-0013 SQLite observers with ADR-0011's action boundary. ADR-0016 selects the active native process/window helper, rendered-glyph targeting, and macOS CoreGraphics input. ADR-0019 adds a separate bounded local per-task reporting ledger, history deletion, and CSV export without Promethee writes or durable session IDs. Windows V1 is passive observation/attachment/reporting only and exposes no Promethee automation. Keep observation, action, local reporting, and platform-proof boundaries separate; the bounded macOS 1.3.29 flow is not Windows, installation, or release evidence.

See the [documentation index](../README.md) for product, development, and release material. Update this index whenever an architecture page is added, superseded, or archived.
