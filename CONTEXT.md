# Pi Annotate

Pi Annotate connects visual feedback captured in a browser to the live Pi session that should act on it.

## Language

**Annotation**:
A submitted bundle of page context, selected elements, comments, screenshots, and captured edits.
_Avoid_: Comment, report

**Annotation session**:
A live Pi session that has made itself available to receive annotations.
_Avoid_: Agent, terminal, client

**Annotation draft**:
The page-bound, unsent work being assembled in the annotator, including its ordered interaction steps and general context.
_Avoid_: Unsaved annotation, annotation session

**Annotation mode**:
The annotator mode in which page input selects elements for the annotation draft.
_Avoid_: Enabled annotation, selection mode

**Interaction mode**:
The annotator mode in which page input passes through to the site while the annotation draft remains available.
_Avoid_: Disabled annotation, browsing mode

**Interaction step**:
An ordered page state from one uninterrupted period of Annotation mode, grouping one or more Element annotations. Its representative viewport is the Send-time screenshot retained from the first Element annotation sent in that step.
_Avoid_: Page, screen, annotation session

**Element annotation**:
A selected element whose metadata and geometry are frozen when the click or explicit retarget is accepted. Its screenshot and crop are captured later when the comment is sent. It remains part of its Interaction step even when the source element no longer exists.
_Avoid_: Selection, marker, note

**Broker**:
The rendezvous point that lists available annotation sessions and routes each annotation to the selected session.
_Avoid_: Daemon, server, gateway

**Session label**:
Human-readable project and branch metadata plus a broker-assigned Session name used to choose an annotation session. Its Session name is unique among live annotation sessions, but the label is not an identity.
_Avoid_: Agent name

**Session name**:
A memorable human name assigned from the broker's fixed pool when an annotation session registers. No two live annotation sessions share one; disconnected names return to the pool.
_Avoid_: Agent name, Session ID

**Session ID**:
An opaque identifier used by the broker to route annotations to one live annotation session.
_Avoid_: Session label

**Session recommendation**:
A browser-local, advisory mapping from a page origin to the annotation session most recently used there. It preselects a live session but never changes broker routing by itself.
_Avoid_: Project mapping, base URL binding

**Session chooser**:
The centered, in-page dialog used to select a live annotation session before starting an annotation. A compact extension window is only a fallback for browser-owned or otherwise uninjectable pages and for connection settings.
_Avoid_: Picker, popup window

**Annotator**:
The browser extension and in-page interface used to create and submit an annotation.
_Avoid_: Chrome plugin

**Pairing link**:
A short-lived broker `/pair` URL that asks the annotator to connect to one broker. It uses tailnet HTTPS for remote access or loopback HTTP for same-machine access, and carries a pairing code in its fragment, never the bearer token.
_Avoid_: Login link, token URL

**Pairing code**:
A one-time, memory-only secret that the broker exchanges for its bearer token after the user confirms the pairing link in the annotator.
_Avoid_: Bearer token, password
