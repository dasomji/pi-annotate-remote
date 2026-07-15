# Default Multi mode, minimizable bar, and Escape state machine

Status: ready-for-agent

Implement requirements 1, 2, and 6 from the PRD in `chrome-extension/content.js`, including delivery-error UI hooks needed by remote submission.

## Acceptance

- Multi is active after first activation and reset.
- Minimize/restore preserves all state; bubble is draggable and reports selection count.
- Note placement reserves no bottom bar space while minimized.
- First/second Escape only blur focused fields; third within two seconds opens an abort dialog.
- Held-key repeats do not increment; a non-Escape key or timeout resets the sequence.
- Escape dismisses the dialog; explicit Abort sends cancellation.

## Comments

- Implemented on `feature/remote-annotation-broker` in `chrome-extension/content.js`.
- Validated with `node --check`, `git diff --check`, and a CDP fixture: Multi retained two selections, minimize/restore and drag suppression worked, bubble count updated, Escape blurred the textarea, repeated keydown was ignored, the third Escape opened the dialog, and Escape dismissed it without cancelling.
- Delivery-error UI remains part of issue 03 because it depends on the broker submission protocol.
