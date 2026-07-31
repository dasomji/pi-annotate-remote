# Prototype the pause, resume, and interaction-step interface

State: closed
Status: ready-for-human
Labels: wayfinder:prototype
Assignee: Daniel
Parent: [Specify same-page interaction mode for persistent workflow annotation](../PRD.md)
Blocked by: none

## Question

Which concrete interface most clearly distinguishes Annotation mode from Interaction mode while reusing the draggable π bubble as a visibly paused Resume control, presenting ordered Interaction steps, identifying historical Element annotations whose source has disappeared, exposing capture progress or failure, and making deletion consequences understandable without obstructing the page?

## Comments

### Resolution

Use the filmstrip direction demonstrated in the [throwaway interaction-mode prototype](../../../chrome-extension/prototypes/interaction-mode.html), with these refinements approved through the live prototype review:

- Keep one prominent **Pause & interact** action; do not add redundant Annotate / Interact mode buttons.
- Interaction mode collapses the annotator into the visibly paused draggable π bubble; activating the bubble resumes Annotation mode.
- Represent every Interaction step with a thumbnail of its full visible-viewport screenshot and its Element annotation count.
- Select the current Interaction step by default. Selecting another step shows only that step's annotation overlays and notes; this is a visibility filter, never deletion.
- Provide an explicit **All steps** control to clear the filter.
- Overlay a closed-eye icon on every saved step whose annotations are hidden by the current filter, making hidden work distinct from deleted work.
- Keep historical Element annotations visible within their selected step, clearly state that the source element no longer exists, and retain their metadata, comment, and crop.
- Show capture progress and failure adjacent to the workflow UI. Deleting an Element annotation explicitly deletes its crop, and deleting the final item removes its now-empty step and viewport image.

The selected direction is Variant B in the prototype. The prototype remains a temporary decision asset rather than production code.
