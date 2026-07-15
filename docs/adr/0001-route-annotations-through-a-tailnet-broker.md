# Route annotations through a tailnet broker

Use one browser-initiated HTTPS broker per headless host, normally exposed from localhost through Tailscale Serve at a configured MagicDNS address. Live Pi sessions register with the broker over local IPC, and the annotator lists and targets them by opaque session ID. The first `/annotate` invocation auto-starts a detached broker and creates a private bearer token; later Pi sessions reuse it. Do not scan the tailnet, maintain a persistent browser WebSocket, or retain the same-machine Native Messaging transport: scanning is unreliable and permission-heavy, WebSockets add unnecessary lifecycle complexity to a browser-initiated workflow, and a broker-only transport keeps one setup and security model.

## Consequences

The broker must acknowledge delivery, expire disconnected sessions, validate bounded payloads, and authenticate annotator requests. The annotator requests optional browser access only for the configured broker hostname and keeps the bearer token in trusted extension storage contexts. Multiple headless hosts are configured as multiple broker endpoints rather than discovered automatically. `/annotate setup` must display the Tailscale Serve command and bearer token when the browser needs pairing information.
