# Pi Annotate

Pi Annotate connects visual feedback captured in a browser to the live Pi session that should act on it.

## Language

**Annotation**:
A submitted bundle of page context, selected elements, comments, screenshots, and captured edits.
_Avoid_: Comment, report

**Annotation session**:
A live Pi session that has made itself available to receive annotations.
_Avoid_: Agent, terminal, client

**Broker**:
The rendezvous point that lists available annotation sessions and routes each annotation to the selected session.
_Avoid_: Daemon, server, gateway

**Session label**:
Human-readable project and branch metadata used to choose an annotation session. It is not an identity and may be duplicated.
_Avoid_: Session name, agent name

**Session ID**:
An opaque identifier used by the broker to route annotations to one live annotation session.
_Avoid_: Session label

**Annotator**:
The browser extension and in-page interface used to create and submit an annotation.
_Avoid_: Chrome plugin, picker

**Pairing link**:
A short-lived tailnet HTTPS URL that asks the annotator to connect to one broker. It carries a pairing code in its fragment, never the bearer token.
_Avoid_: Login link, token URL

**Pairing code**:
A one-time, memory-only secret that the broker exchanges for its bearer token after the user confirms the pairing link in the annotator.
_Avoid_: Bearer token, password
