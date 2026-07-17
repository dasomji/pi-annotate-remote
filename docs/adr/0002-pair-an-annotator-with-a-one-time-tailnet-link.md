# Pair an annotator with a one-time tailnet link

Use a pairing link as the primary way to connect an annotator to a broker. When `/annotate` or `/annotate setup` has a verified Tailscale Serve endpoint, Pi authenticates to the localhost broker and asks it for a five-minute pairing code. Pi prints a tailnet HTTPS URL whose fragment contains that code; the long-lived bearer token is never part of the URL or its initial HTTP request.

The broker's public `/pair` page sends the pairing code to one pinned annotator extension ID. The annotator accepts external messages only from an exact `/pair` path on HTTPS `*.ts.net` origins, derives the broker endpoint from the browser-provided sender URL, and opens an extension-owned confirmation page. The user must confirm the exact broker origin and grant optional access to that hostname. Only then may the extension exchange the one-time code for the bearer token and replace its saved broker configuration.

Pairing codes are random 256-bit values, memory-only, single-use, bounded in count, and invalid after five minutes. The exchange route accepts a bounded body and requires the exact pinned extension origin. Keep endpoint-and-token entry as a manual recovery path. Do not put the bearer token in a link, accept a broker endpoint from the external message payload, request broad install-time host access, or attempt to bypass Chrome's user-gesture permission requirement.

Pin the unpacked extension identity with a public manifest key so the broker page can address it reliably. The selected ID is `bpeadifabilnfpephegaodjbcjjfjghk`. This distribution intentionally retains no private signing key: it supports a stable unpacked folder/ZIP identity, not future self-signed CRX publication under that ID. Moving to a Chrome Web Store identity may therefore require another one-time reinstall.

## Consequences

Existing unpacked installations receive a new extension identity once and do not inherit the old extension's local storage. Users must remove the old copy, load the newly pinned extension, and pair again. The setup flow is near-one-click rather than silent: link click, extension confirmation, and Chrome's host-permission approval are all required. The broker protocol version is bumped so a surviving older detached broker is replaced automatically before pairing links are issued; live annotation sessions reconnect through their existing retry behavior.

Desktop Chrome and Chromium can use the pairing link when they can reach the tailnet endpoint. Chrome on iOS and Android does not support desktop Chrome extensions, so opening the link there cannot connect this annotator; a mobile-native annotator would be a separate product decision. Pairing failure never disables the annotation session: Pi continues to show the exact endpoint and bearer token as a manual fallback.
