# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

A Wayfinder map uses the feature PRD as its map issue and the feature's issue files as child tickets.

- Map identity: `.scratch/<feature-slug>/PRD.md` with `Labels: wayfinder:map`.
- Child relationship: `Parent: [<map title>](../PRD.md)` in each ticket.
- Ticket type: one of `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task` on the `Labels:` line.
- Lifecycle: `State: open` or `State: closed`, independent of the triage `Status:` line.
- Claim: replace `Assignee: unassigned` with the driving developer before any work. The assignee is the claim.
- Blocking: because Local Markdown has no native dependency relation, use `Blocked by: none` or a comma-separated list of named ticket links. A ticket is unblocked only when every linked blocker has `State: closed`.
- Frontier query: inspect the map's issue directory in filename order and select children that are open, unassigned, and unblocked. Never infer the frontier from a stale list in the map body.
- Resolution: append the answer under `## Comments`, set `State: closed`, then append a one-line named link to the map's **Decisions so far** section.

In human-readable text, always refer to maps and tickets by their linked titles rather than bare file numbers or slugs.
