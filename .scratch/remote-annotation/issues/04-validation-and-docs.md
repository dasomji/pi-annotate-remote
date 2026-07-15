# Validate and document broker-only setup

Status: ready-for-agent

Add automated coverage for protocol and broker behavior, manually validate browser flows, and rewrite setup/architecture/troubleshooting documentation.

## Acceptance

- Broker routing/auth/limits/lifecycle tests pass.
- Type checking or equivalent source validation passes.
- Package dry-run contains daemon/browser assets and no native host.
- README documents Tailscale Serve, broker endpoint/token setup, `/annotate` availability, popup session selection, minimization, and Escape behavior.
- Changelog records the breaking transport migration.

## Comments

- Rewrote `README.md` for the broker-only workflow: Tailscale Serve, endpoint/token pairing, Pi session availability and selection, command lifecycle, minimization, three-Escape confirmation, acknowledged delivery/retry, security, development, and troubleshooting.
- Added a breaking Unreleased migration entry to `CHANGELOG.md`, including the broker/session picker, Native Messaging removal, optional host access, and interaction changes.
- Aligned Pi core imports with package guidance by moving `@earendil-works/pi-coding-agent` and `typebox` to peer dependencies; refreshed `package-lock.json` from a clean npm install.
- `npm ci`, all 18 automated tests, `npm run check` (including `index.ts` source parsing), and `git diff --check` pass.
- `npm pack --dry-run` contains all Pi, broker daemon, and browser assets (20 entries) and zero native-host files. Chrome's pack-extension command accepts the manifest and browser bundle.
- Browser service-worker, popup permission/session selection, injection, exact delivery routing, and content retry/ack flows are covered in VM-backed tests.
- Also completed a real Chromium CDP pass using an unpacked extension and isolated live broker: the popup connected and listed the registered session, Start injected the content UI into an active HTTP page, one selected `#target` element/comment arrived at the exact broker client, acknowledged success closed the UI, an intentional Pi-side rejection restored the UI with `Retry`, and retry success closed it. Chrome/Chromium pack validation also succeeded.
