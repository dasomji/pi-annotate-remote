# Add broker and Pi annotation-session registry

Status: ready-for-agent

Implement the localhost HTTP broker, local IPC registry, authenticated delivery acknowledgement, daemon startup, and Pi session lifecycle integration.

## Acceptance

- Multiple Pi sessions can register simultaneously.
- `GET /v1/sessions` returns opaque IDs and public labels only.
- Annotation POST routes to exactly one connected session and waits for acknowledgement.
- Disconnect removes the session; malformed, unauthenticated, oversized, unknown-session, and timed-out requests return bounded errors.
- `/annotate` enables availability and `/annotate off` disables it.
- Session shutdown cleans up local resources.

## Comments

- Implemented the broker in `broker/` with localhost HTTP, bearer auth, restricted CORS, bounded JSON bodies, a multi-client Unix-socket registry, delivery acknowledgements/timeouts, XDG-aware private state, and detached auto-start.
- Reworked `index.ts` so `/annotate` enables the current project/branch annotation session, `/annotate status` reports it, `/annotate setup` repeats endpoint/token instructions, `/annotate off` unregisters, and `session_shutdown` cleans up. The `annotate` tool now enables availability and displays setup details in Pi's UI when pairing is needed.
- Added `node:test` coverage for daemon/token setup, auth, concurrent session listing, exact routing, acknowledgement/rejection, disconnect, reconnect, timeout, malformed/oversized bodies, and CORS.
- Validated the real Pi extension loader through RPC: `/annotate` auto-started the broker and registered one opaque session, setup instructions were emitted, status reported available, and `/annotate off` removed it.
