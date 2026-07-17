<p>
  <img src="banner.png" alt="Pi Annotate" width="1100">
</p>

# Pi Annotate

**Visual annotation for AI. Click elements, capture screenshots, fix code.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Browser](https://img.shields.io/badge/Browser-Chrome%20%7C%20Chromium-blue?style=for-the-badge)]()

Pi Annotate gives Chromium a Figma-like annotation layer and delivers the result to the correct live Pi session. The browser can run on your laptop while Pi and the project run on a headless machine elsewhere on your Tailscale tailnet.

Click elements, add comments, and submit. Pi receives selectors, box model data, accessibility details, screenshots, and optional DevTools edit captures.

https://github.com/user-attachments/assets/115b10ca-86e8-4b1c-b8a4-492c68759c58

## How it works

```text
Chromium on your laptop
  popup + content UI
          │ authenticated HTTPS over your tailnet
          ▼
Tailscale Serve URL
          │ proxies to localhost only
          ▼
Pi Annotate broker on the headless host
          │ private local IPC
          ├── project-a (main)
          └── project-b (feature/header)
```

The browser lists only currently available annotation sessions. Routing uses an opaque session ID; project paths and other private Pi state are not exposed.

## Quick start

### 1. Install the Pi package

```bash
pi install git:github.com/dasomji/pi-annotate-remote
```

Restart Pi after installation.

### 2. Load the browser extension

1. Open `chrome://extensions` in Google Chrome or Chromium.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this package's `chrome-extension/` directory.
   - Git installs normally place it at `~/.pi/agent/git/github.com/dasomji/pi-annotate-remote/chrome-extension/`.
   - Local installs use the `chrome-extension/` directory in that checkout.
4. Pin **Pi Annotate** to the toolbar.

The manifest pins a stable unpacked-extension ID so a broker pairing page can address the annotator. If you loaded an older Pi Annotate build before this identity was pinned, remove that old extension once before loading the new directory. Chrome treats it as a different extension, so its saved broker configuration does not migrate.

### 3. Make a Pi session available

In the project session you want to annotate, run:

```text
/annotate
```

Every invocation starts or reconnects the shared localhost broker, configures Tailscale Serve when needed, and prints:

- a pairing link that expires after five minutes;
- the exact HTTPS endpoint and bearer token as a manual fallback;
- the verified Serve route to the local broker.

The default local broker is `http://127.0.0.1:32179`. Pi Annotate exposes it on the same tailnet HTTPS port, producing an endpoint such as:

```text
https://your-machine.your-tailnet.ts.net:32179
```

Automatic setup is idempotent: an existing matching route is reused, and an unrelated Serve or Funnel route on port `32179` is never overwritten. If Tailscale is unavailable, disconnected, awaiting HTTPS enablement, or has a port conflict, `/annotate` keeps the local broker running and prints a bounded warning instead of a misleading remote URL. Fix the reported condition and run `/annotate setup` to retry.

Tailscale Serve keeps the broker available only on your tailnet. Do **not** enable Tailscale Funnel for this service. See the [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve) for machine and tailnet setup.

### 4. Pair the browser and choose a session

1. Open the pairing link from `/annotate` in the desktop Chrome or Chromium profile where Pi Annotate is loaded.
2. Pi Annotate opens its own confirmation page. Verify the exact broker origin, then click **Connect**.
3. Approve Chrome's request for access to that broker host.
4. Open the Pi Annotate popup, select a live annotation session, and click **Start annotation**.

The link contains a one-time pairing code in its URL fragment, not the bearer token. The code is removed from the visible tailnet page immediately, can be exchanged only once, and expires after five minutes. If the link expires or was already used, run `/annotate setup` to create another.

For manual recovery, paste the endpoint and token printed under **Manual fallback** into the popup, click **Save & connect**, and approve host access. The extension requests optional network access only for the selected hostname. `http://localhost` and `http://127.0.0.1` are accepted for local development; remote endpoints must use HTTPS.

Desktop Chrome and Chromium support this extension flow. Chrome on iOS and Android does not support desktop Chrome extensions, so opening the link there cannot connect Pi Annotate; use a desktop extension-capable browser on the tailnet.

## Pi commands

| Command | Effect |
|---|---|
| `/annotate` or `/annotate on` | Make the session available, ensure Tailscale Serve, and print a fresh pairing link plus manual setup values |
| `/annotate status` | Report whether this session is registered and show its known endpoint |
| `/annotate setup` | Re-check Tailscale Serve and print a fresh pairing link plus manual setup values |
| `/annotate off` | Remove this session from the popup without stopping the shared broker |

The `annotate` tool uses the same availability flow when Pi decides visual feedback is useful. Browser submissions arrive later as a user message in the selected Pi session; the tool does not hold an agent turn open while you annotate.

If Pi is already working when you submit, the annotation is accepted immediately and added to Pi's native follow-up queue. It runs after the current tools, retries, compaction, and other automatic continuations finish. You can start and submit more annotations without waiting; Pi preserves their follow-up order. This is runtime-idle ordering rather than a guess about whether the broader human task is conceptually complete.

A session remains available until `/annotate off`, Pi exits, or its broker connection is lost. Multiple Pi sessions can be available simultaneously, labelled with project directory and Git branch.

## Browser controls

| Action | How |
|---|---|
| Start annotation | Select a Pi session in the popup and click **Start annotation** |
| Start again with the saved session | `⌘/Ctrl+Shift+P` |
| Select elements | Click the page; Multi mode is the default |
| Replace selection | Choose **Single** mode |
| Cycle ancestors | `Alt/⌥` + scroll while hovering |
| Add a comment | Type in the floating note card |
| Reposition a note | Drag its header |
| Minimize the bar | Click `−`; drag the floating π bubble and click it to restore |
| Screenshot mode | Choose **Crop**, **Full**, or **None** in the bar |
| Record browser edits | Enable **Etch** |
| Cancel | Click **Cancel**, or press Escape three times and confirm **Abort annotation** |

Minimized mode stops reserving space at the bottom of the page, and both the full bar and floating bubble are hidden during screenshot capture.

Escape never aborts immediately. It first blurs an active annotation field. Three non-repeated Escape presses within two seconds open an accessible confirmation dialog; Escape closes that dialog, and only **Abort annotation** discards the work.

## Delivery and retry

Submission is successful only after the selected Pi session acknowledges it. While delivery is pending, the annotation controls stay in a sending state. If the session disconnects, authentication fails, or the network request times out, the annotation UI is restored with a **Retry** button and the selections and comments remain available.

## Captured context

**Element context** — Selector, text, box model, key styles, attributes, and accessibility information. Debug mode adds computed styles, parent layout context, and CSS variables.

**Inline note cards** — Draggable comments connected to selected elements, with per-element screenshot controls.

**Screenshots** — Cropped element images or a full viewport image with numbered badges.

**Edit capture** — Etch mode records inline styles, CSS rule changes, classes, attributes, text, and DOM structure changes. When edits are detected, Pi Annotate also captures before/after screenshots.

Example output:

```markdown
## Page Annotation: https://example.com
**Viewport:** 1440×900

**Context:** Fix the styling issues

### Selected Elements (1)

1. **button**
   - Selector: `#submit-btn`
   - Classes: `btn, btn-primary`
   - Text: "Submit"
   - **Box Model:** 120×40 (content: 96×24, padding: 8 16, border: 1)
   - **Accessibility:** role=button, name="Submit", focusable=true
   - **Comment:** Make this blue with rounded corners

### Screenshots
- Element 1: /tmp/pi-annotate-...-el1.png
```

## Security and storage

- The broker listens on `127.0.0.1` by default; Pi Annotate configures Tailscale Serve on the broker port to provide tailnet HTTPS.
- Browser requests require a random bearer token stored in `chrome.storage.local` and restricted to trusted extension contexts.
- Pairing links contain only a random 256-bit, memory-only code in the URL fragment. The code expires after five minutes, works once, and is exchanged for the token only after extension confirmation.
- The pairing page addresses one pinned extension ID; the extension validates the page's browser-provided tailnet URL and derives the broker origin from it rather than trusting message data.
- The token file is mode `0600`; runtime/state directories and local IPC are private to the user.
- The popup and pairing confirmation request optional host permission for only the configured broker hostname.
- Broker responses expose session `{id, label}` only, not absolute paths or transcript data.
- Request bodies, local IPC messages, and browser responses are bounded.
- Screenshot payloads and credentials are never logged by the broker or service worker.

Default host paths:

| Data | Default |
|---|---|
| Token with `XDG_STATE_HOME` | `$XDG_STATE_HOME/pi-annotate/broker-token` |
| Token fallback | `~/.local/state/pi-annotate/broker-token` |
| Socket/lock with `XDG_RUNTIME_DIR` | `$XDG_RUNTIME_DIR/pi-annotate/` |
| Socket/lock fallback | `/tmp/pi-annotate-<uid>/` |

Advanced overrides: `PI_ANNOTATE_PORT`, `PI_ANNOTATE_RUNTIME_DIR`, `PI_ANNOTATE_STATE_DIR`, `PI_ANNOTATE_SOCKET`, `PI_ANNOTATE_TOKEN_FILE`, and `PI_ANNOTATE_ALLOWED_ORIGINS`. Set `PI_ANNOTATE_TAILSCALE=off` to disable automatic Serve configuration intentionally.

## Project layout

| File | Purpose |
|---|---|
| `index.ts` | Pi command/tool registration, session label, result formatting |
| `types.ts` | Annotation data interfaces |
| `broker/daemon.js` | Detached shared broker lifecycle |
| `broker/server.js` | HTTP API, authentication, pairing, routing, acknowledgements |
| `broker/client.js` | Pi session registration, protocol upgrades, and reconnecting local IPC client |
| `broker/pairing.js` | Pairing-link creation, stable annotator identity, and tailnet handoff page |
| `broker/tailscale.js` | Conflict-safe automatic Tailscale Serve setup and endpoint discovery |
| `chrome-extension/background.js` | Credential storage, broker requests, pairing exchange, screenshots, tab injection |
| `chrome-extension/pair.html` / `pair.js` | Trusted broker confirmation and host-permission request |
| `chrome-extension/popup.html` / `popup.js` | Manual broker setup and live session selection |
| `chrome-extension/content.js` | Element picker and annotation UI |

There is no Native Messaging host and no build step.

## Development

```bash
npm ci
npm test
npm run check
npm pack --dry-run
```

Reload the unpacked extension at `chrome://extensions` after changing browser files. Restart or reload Pi after changing `index.ts`.

The broker is detached and shared by Pi sessions. A protocol-version change replaces an older broker automatically. For ordinary broker changes that keep the same protocol version, stop the current process using the PID in `broker.lock`; the next `/annotate` invocation starts the updated code:

```bash
RUNTIME_DIR="${PI_ANNOTATE_RUNTIME_DIR:-${XDG_RUNTIME_DIR:+$XDG_RUNTIME_DIR/pi-annotate}}"
RUNTIME_DIR="${RUNTIME_DIR:-/tmp/pi-annotate-$(id -u)}"
kill "$(cat "$RUNTIME_DIR/broker.lock")"
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Popup says no sessions are available | Run `/annotate` in the target Pi session, then click **Refresh** |
| `/annotate` reports a Tailscale warning | Resolve the reported connectivity, HTTPS-consent, or port-conflict condition, then run `/annotate setup` |
| Broker cannot be reached | Copy the exact endpoint printed by `/annotate`; check `tailscale status` and `tailscale serve status --json` |
| Access was not granted | Click **Connect** on the pairing confirmation again (or **Save & connect** for manual setup) and approve the host-access prompt |
| Pairing link says Pi Annotate was not found | Load or reload the pinned extension in desktop Chrome, then run `/annotate setup` and open the new link in that browser profile |
| Pairing code is invalid or expired | Run `/annotate setup` and use the new link within five minutes |
| Authentication fails | Run `/annotate setup` and pair again, or paste the current manual fallback token |
| Delivery fails after annotation | Keep the UI open, refresh the popup session list if needed, then click **Retry** |
| UI does not appear | Open a normal `http://` or `https://` page; browser-internal and extension pages cannot be annotated |
| Broker code did not update | Stop the detached broker using the development command above, then run `/annotate` |
| Browser and Pi are on the same machine | Use `http://127.0.0.1:32179` in the popup; HTTPS is still required for non-local hosts |

The public `GET /health` endpoint returns only broker health and protocol version. Session listing and delivery require the bearer token.

## Credits

Pi Annotate was originally created by [Nico Bailon](https://github.com/nicobailon). This repository is a fork of [nicobailon/pi-annotate](https://github.com/nicobailon/pi-annotate) and preserves the original project's MIT license and attribution.

## License

MIT
