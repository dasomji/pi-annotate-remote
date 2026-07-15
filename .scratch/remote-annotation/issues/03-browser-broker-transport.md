# Replace Native Messaging with browser-to-broker HTTPS

Status: ready-for-agent

Replace the popup/background Native Messaging flow with configured broker access, annotation-session selection, content-script activation, and acknowledged submission.

## Acceptance

- Popup can save a broker endpoint and credential, test it, list sessions, and select one.
- Starting annotation injects the content script into the active non-restricted tab.
- The selected opaque session ID travels with the annotation.
- Content UI deactivates only after acknowledged delivery; failure restores the UI and offers retry.
- Native Messaging permission, host scripts, and setup copy are removed.
- Broker requests originate only from the extension background context.

## Comments

- Replaced the Native Messaging service worker with authenticated broker fetches for configuration, session listing, exact-session delivery, screenshot capture, and active-tab content-script injection.
- Rebuilt the popup around one saved broker endpoint/token, explicit connection testing, refreshable session selection, and start controls with loading, empty, and error states.
- Chose endpoint-scoped optional host access via Postbox: saving an endpoint requests only that HTTPS host (or localhost HTTP for development), rather than installing with broad required network access. The stored token is restricted to trusted extension contexts.
- The selected opaque session ID now travels through `START_ANNOTATION` and `ANNOTATIONS_COMPLETE`. The content UI waits for broker acknowledgement, restores itself with an inline `Retry` state on failure, and deactivates only after delivery succeeds.
- Removed `nativeMessaging`, persistent `<all_urls>` host access/content-script injection, and all files under `chrome-extension/native/`. Broker `fetch()` appears only in `chrome-extension/background.js`.
- Added VM-backed tests for service-worker routing/security, popup permission/session behavior, and content retry/ack behavior. Chrome's pack-extension command accepts the resulting manifest.
- Real Chromium CDP validation with an unpacked extension and live isolated broker passed endpoint/token connection, session listing, active-tab injection, selected element/comment delivery, acknowledgement-driven close, intentional rejection with restored `Retry`, and successful retry.
