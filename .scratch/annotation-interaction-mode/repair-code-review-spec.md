# Spec review

**Spec sources:** `.scratch/annotation-interaction-mode/PROPOSED-SPEC.md` and its resolved child tickets, especially `issues/05-specify-route-guard.md`.

## Findings

1. **Programmatic POST replay still does not preserve the original encoding.** The route contract requires retaining the “**Original source form, submitter, method, action, encoding, and captured form data for GET or POST submission**” (`issues/05-specify-route-guard.md:46-50`). In `chrome-extension/content.js:1072-1080`, the `NavigationEvent.formData` fallback for `HTMLFormElement.submit()` hard-codes:

   > `method: "post"`
   > `enctype: "application/x-www-form-urlencoded"`

   This repairs the reviewed default-urlencoded case, but a programmatic `multipart/form-data` or `text/plain` submission is replayed with different wire semantics. The existing exact-form test covers `text/plain` only through the `submit`-event path; the new programmatic test uses the default encoding. Capture the form configuration at the programmatic form-data seam (or otherwise retain the original encoding) and add a programmatic non-default-encoding regression.

## Missing/partial requirements

No other missing or partial requirement found. The failed-capture lock, historical-note restoration, Etch restart/warning delivery, and current-step default match their quoted requirements and now have observable regression coverage.

## Scope creep

None found. The additive `etchWarnings` field is a direct implementation of “retain it in `etchWarnings` for submission and Pi presentation” (`PROPOSED-SPEC.md:216`) and is documented in the v2 contract.

## Apparently wrong implementations

Only finding 1 above.
