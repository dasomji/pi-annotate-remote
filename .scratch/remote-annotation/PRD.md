# Remote multi-session annotation

## Goal

Let a Chromium-based annotator on a laptop send visual annotations over a Tailscale tailnet to the correct live Pi session on a headless machine, while making local annotation faster and less obstructive.

## Product requirements

1. New annotation sessions start in Multi selection mode. Single remains an explicit toolbar option.
2. The bottom annotation bar can collapse into a draggable floating bubble that shows the selection count and restores the bar when clicked. Minimized mode must stop reserving bar height when positioning notes, and screenshot capture must hide both forms.
3. `/annotate` makes the current Pi session available through a local broker until disabled or the Pi session ends. The session label uses project directory plus Git branch; routing uses an opaque session ID.
4. The browser popup connects to one configured Tailscale Serve/MagicDNS HTTPS endpoint, lists available annotation sessions, and starts annotation on the active tab for the selected session.
5. Submission uses ordinary HTTPS and remains open on delivery failure so the user can retry. Success is shown only after the target Pi session acknowledges receipt.
6. Escape never directly aborts. Escape blurs focused annotation fields without collapsing notes. Three non-repeated Escape keydowns within two seconds show an accessible abort dialog. Escape dismisses that dialog; only its Abort action cancels.
7. Native Messaging is removed; the broker is the sole transport.

## Broker interface

- `GET /health`
- `GET /v1/sessions`
- `POST /v1/sessions/:id/annotations`

The broker listens on localhost, is exposed through Tailscale Serve, authenticates browser requests, validates message shapes and size limits, removes disconnected sessions, and returns delivery acknowledgement or a bounded error.

## Security and privacy

- Do not expose absolute project paths; only public session labels and machine metadata.
- Store broker credentials in browser extension storage and a mode-0600 local state file.
- Permit only configured broker origins from the browser extension.
- Keep the broker listener on localhost by default.
- Enforce request and screenshot limits already present in the project.
- Never log screenshot payloads or credentials.

## Out of scope

- Automatic tailnet scanning.
- Public internet access through Tailscale Funnel.
- Firefox or Safari packaging.
- A central broker shared by multiple headless machines.
