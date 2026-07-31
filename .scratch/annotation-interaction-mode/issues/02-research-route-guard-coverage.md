# Establish Chromium route-guard coverage

State: closed
Status: ready-for-human
Labels: wayfinder:research
Assignee: Daniel
Parent: [Specify same-page interaction mode for persistent workflow annotation](../PRD.md)
Blocked by: none

## Question

Using current Chromium extension documentation and web-platform specifications, which top-level navigation surfaces can an MV3 annotator reliably detect and prevent with a custom dialog, which require a native `beforeunload` warning, and which cannot be guarded—including links, forms, reload, tab or window close, address-bar navigation, History API changes, fragment changes, back/forward traversal, and script-driven navigation across isolated and main execution worlds?

## Comments

### Resolution

#### Bottom line

Use two guards for the lifetime of a non-empty annotation draft:

1. A synchronous `navigation` `navigate` listener cancels every cancelable top-level event with `preventDefault()`. Cancellation happens immediately; the annotator then opens its asynchronous custom **Discard** / **Stay on this page** dialog. **Discard** replays the captured action behind a one-shot bypass, while **Stay** leaves the canceled route untouched.
2. A `beforeunload` listener is armed at the same time. It is the browser-owned fallback for transitions that page script cannot cancel or never observes. Chromium controls this warning's text and buttons; it cannot be replaced by the annotator's custom dialog.

`chrome.webNavigation` and `chrome.tabs` are diagnostics only, not guard primitives: `webNavigation.onBeforeNavigate` exposes an observational callback with no cancellation response, and `tabs.onRemoved` fires after a tab is closed ([Chrome `webNavigation`](https://developer.chrome.com/docs/extensions/reference/api/webNavigation), [Chrome `tabs.onRemoved`](https://developer.chrome.com/docs/extensions/reference/api/tabs#event-onRemoved)).

This answer assumes an ordinary, non-adversarial host page. No in-page extension can promise containment against a page deliberately trying to disable, starve, or race the guard.

#### Coverage matrix

| Top-level surface | Custom dialog | Native fallback | Reason / qualification |
|---|---:|---:|---|
| Ordinary same-tab link, including a cross-origin destination | Yes | Armed but normally not reached | A non-traversal `navigate` event is cancelable. New-tab / new-window links do not unload the draft's tab and need no loss warning. |
| GET or POST form submission, including script `submit()` / `requestSubmit()` | Yes | Armed but normally not reached | The Navigation API reports form navigations; POST data is exposed as `formData`. To honor **Discard**, retain enough source/submitter information to replay the original submission rather than converting it to a GET. |
| `location.href =`, `location.assign()`, `location.replace()`, `window.open(..., "_self")`, `navigation.navigate()` | Yes, when initiated by the active document | Yes for externally initiated cases | These enter the browser's Navigation-event path instead of depending on which JavaScript world called them. Do not depend on monkey-patching page methods; separately verify isolated-world event delivery as specified below. |
| `history.pushState()` / `history.replaceState()` and Navigation API push/replace | Yes | No unload occurs | The HTML Standard fires a cancelable push/replace `navigate` event before changing URL/history. `popstate` and `hashchange` are after-the-fact notifications and are not guards. |
| Fragment link or script-set fragment | Yes | No unload occurs | Fragment navigation fires a cancelable `navigate` event with `hashChange: true`; it can be canceled even though it remains in the same document. |
| Same-document back/forward traversal | Yes, when `event.cancelable` | No unload occurs | A top-level same-document traversal is cancelable when it has history-action activation. Cancellation consumes that activation; responding to the custom dialog supplies a new trusted interaction before another attempt. Always branch on the event's actual `cancelable` value. |
| Cross-document back/forward traversal | No | Yes | For a traversal that changes `Document`, the standard runs `beforeunload` before the traversal's Navigation event; the latter cannot be used for a dependable custom guard. This includes same-origin entries backed by another `Document`. |
| Script/API reload (`location.reload()`, `navigation.reload()`) | Yes | Armed but normally not reached | Script-initiated reload fires a cancelable `navigate` event. |
| Browser reload button / browser keyboard reload | No | Yes | Browser-UI reload bypasses the document's push/replace/reload Navigation event path, then runs unload cancellation. |
| Address bar, bookmark, browser search, or browser-UI navigation to a new document | No | Yes | The Navigation API explicitly does not fire for location-bar-initiated new-document navigations. Address-bar fragment-only navigation is the exception: it follows the fragment path and can emit `navigate`. |
| Tab close, window close, or script-closing a script-closable tab | No | Yes | There is no cancellable extension tab-close event; the document's unload prompt is the supported warning surface. |
| Same-origin frame/window script navigating the top level | Usually yes | Yes | It can reach the active document's Navigation event when the standard's same-origin checks permit it. |
| Cross-origin iframe, opener, or other window navigating this top level | No | Yes | New-document navigations initiated from another origin/window do not provide the current document a cancellable Navigation event. |
| Declarative refresh (`<meta http-equiv=refresh>` / Refresh processing) | Yes when initiated from the active document | Yes | It enters the normal document-initiated navigation path. A redirect after a user has already chosen **Discard** is no longer draft loss because the bypass has intentionally committed the route. |
| Download link / server attachment, or a link opening another top level | No warning needed | No unload expected | These do not replace the current document. A download requested through a link is identified by `downloadRequest`; browser-UI downloads may not emit `navigate` at all. |

The Navigation API's `canIntercept` flag is **not** the guard test. `canIntercept` asks whether a route can be converted into a same-document navigation. A cross-origin ordinary navigation can have `canIntercept === false` while its event remains `cancelable === true`; the guard should test `event.cancelable` and call `preventDefault()`, not require `canIntercept` ([HTML Navigation API](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-navigation-api)).

#### Execution worlds and dialog mechanics

Chrome defines `ISOLATED` as the extension-private JavaScript environment and `MAIN` as the environment shared with host-page JavaScript; both share the page DOM ([Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Chrome `scripting.ExecutionWorld`](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-ExecutionWorld)). Therefore:

- Keep draft state, the HTML `<dialog>`, and extension messaging in the isolated content script.
- Install the browser-level Navigation and `beforeunload` listeners without replacing `history`, `location`, form, or router functions. If Chromium integration testing shows `navigation` event delivery differs in the isolated world, use a minimal `MAIN`-world listener that synchronously cancels and signals the isolated owner through the shared DOM; do not move draft data into the main world.
- Cancellation must occur during `navigate` dispatch. An async dialog cannot postpone the original route. Cancel first, display the dialog second, and replay only after **Discard**.
- The one-shot bypass must be scoped to one exact replay and cleared on success, error, or timeout; a global “allow next navigation” boolean could accidentally admit a competing page route.
- Keep `beforeunload` armed while the custom dialog is open and while replay is pending. Disarm it only for the exact confirmed replay or after the draft is submitted/deleted.

Pi Annotate currently has `activeTab` and `scripting`. Chrome says the temporary grant survives same-origin navigation but is revoked on cross-origin navigation or tab close ([Chrome `activeTab`](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)). That is sufficient to install guards in the already-annotated document, but it does not create persistence after a route commits—which is intentionally out of scope.

#### Unguardable or degraded cases

- **No sticky user activation:** Chromium will dispatch `beforeunload`, but will not show its warning until the page has received a trusted user gesture. Starting and using the annotator should normally establish sticky activation, but code must not claim a guarantee before that point.
- **UA suppression and sandboxing:** the HTML Standard permits a prompt only when the document is not sandboxed against modals and the user agent considers the prompt not annoying, deceptive, or pointless. The warning is therefore a best-available fallback, not an absolute veto.
- **Forced termination:** renderer/browser crash, OS or task-manager kill, device shutdown, extension reload/uninstall, and comparable discard paths can destroy the draft without any Navigation or `beforeunload` opportunity. Chromium explicitly describes unload-family events as unreliable on such lifecycle paths ([Chromium dialog policy](https://developer.chrome.com/blog/dialogs-policy/)).
- **`javascript:` document replacement and non-navigation document destruction:** the HTML navigation algorithm special-cases `javascript:` URLs before ordinary Navigation-event and unload-cancellation paths. A `javascript:` URL that evaluates to a string can replace the `Document`; APIs such as `document.open()` can likewise destroy the annotator without representing a route. A capture listener can stop an ordinary clicked `javascript:` link, but arbitrary script-driven document replacement is not comprehensively guardable. Treat these as unsupported hostile/exotic cases.
- **Uninjectable pages:** extension guards cannot exist on browser-owned/restricted pages or any URL lacking a usable host grant. Pi Annotate already falls back away from in-page annotation there; no persistent draft should be started on such a page.
- **Repeated or competing navigation:** the platform may expose a traversal as non-cancelable, and a page can initiate another route while the custom decision is pending. The native guard remains the safety net for any resulting cross-document unload; same-document races require the implementation to serialize decisions and reject all cancelable events until one is resolved.

#### Required Chromium verification before implementation handoff

Automated Chromium coverage should exercise both page-script worlds and real browser UI:

1. Links and GET/POST forms to same- and cross-origin destinations.
2. Main-world and isolated-world calls for Location, History, Navigation, form submission, and fragment APIs.
3. Same-document and cross-document back/forward, including a second attempt after **Stay**.
4. Script reload versus toolbar/keyboard reload, address-bar navigation, tab close, and window close.
5. Top navigation from same- and cross-origin iframes/openers.
6. Missing sticky activation, CSP `sandbox` without `allow-modals`, dialog-open races, replay bypass cleanup, and `javascript:` replacement as a documented negative test.

Assertions must distinguish: custom dialog shown and URL unchanged; native Chromium warning shown; current document intentionally retained with no warning (download/new tab); and explicitly unguardable draft loss.

#### Primary sources

- [HTML Standard — Navigation API and `navigate` event](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-navigation-api)
- [HTML Standard — navigation, traversal, reload, and unload cancellation](https://html.spec.whatwg.org/multipage/browsing-the-web.html)
- [HTML Standard — sticky and history-action activation](https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation)
- [Chrome for Developers — Navigation API](https://developer.chrome.com/docs/web-platform/navigation-api/)
- [Chrome Extensions — content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome Extensions — `chrome.scripting`](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome Extensions — `chrome.webNavigation`](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)
- [Chrome Extensions — `activeTab`](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chromium policy on JavaScript dialogs](https://developer.chrome.com/blog/dialogs-policy/)
