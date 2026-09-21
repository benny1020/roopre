# ADE workspace redesign

## Scope and audit

The September 21 user brief authorizes this redesign and implementation. It does not change the product's human design approval, execution contract, security boundary or merge policies. Earlier approved designs remain intact.

Inspected Electron main/preload boundaries, snapshot/command contracts, renderer state and navigation, design/version/thread/approval flows, execution manager data, harness packages, agent configuration, onboarding and existing browser tests. Baseline screenshots are locally recorded in `artifacts/ade-before-{overview,design}.png` using an isolated fixture, never production workspace data.

| Current problem                                                                         | UX reasoning                                                                         | Proposed solution                                                                                                | Expected improvement                                    |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Four settings destinations dominate permanent navigation                                | Configuration is occasional; building and deciding are continuous                    | One Settings entry with contextual subnavigation                                                                 | Project/task context stays prominent                    |
| Design gate and execution status compete; planning completion looks like implementation | Operational state must represent the latest real work, without claiming delivery     | Shared presentation state and explicit next action, separate design approval from handoff                        | Understand current stage and responsibility at a glance |
| Tall title + repeated policy banner precede useful work                                 | Desktop space should favor documents, evidence and work                              | Compact context header, restrained stage rail and typography                                                     | More working surface at the Electron minimum size       |
| Execution is a stack of run cards with nested raw text                                  | Supervisors need to compare changes, checks and blockers, not scroll through history | Select a run; tabs for changes, verification, review and artifacts; contextual agent inspector and output drawer | Related evidence remains in one context                 |
| One diff string is shared across all run buttons                                        | A patch without run identity risks reviewing the wrong work                          | Request/result identity and explicit refresh, no automatic moving-target substitution                            | Trustworthy read-only change inspection                 |
| Command search only searches features, lacks arrow navigation                           | Commands should be predictable and keyboard-first                                    | Project/feature/navigation/create commands, independent query, focus containment and restoration                 | Fast navigation without mutating background filters     |
| Design panel uses a tiny range slider for width                                         | Pane boundaries should afford resizing where the user expects it                     | Pointer and keyboard accessible separator                                                                        | Direct manipulation without extra toolbar chrome        |

## One design language

A compact graphite workstation. No dashboard widget grid, gradients, decorative glows or chatbot center.

Core palette: graphite `#15181d`, workspace `#1c2026`, divider `#343c46`, text `#e6ebf1`, restrained blue `#91b8f5`, light canvas `#f5f6f8`. Semantic green/amber/red are reserved for actual outcome/attention, never decoration. Light mode uses ink `#202832` and accent `#285da8`. Text contrast takes precedence over subtlety.

Typography: system SF / Apple SD Gothic Neo for UI, SFMono / Menlo for hashes, code and execution output. Workspace titles 18px; sections 14px; body 13px; metadata 12px; code 12px. Scale: 4, 8, 12, 16, 24px. Controls 28–32px; navigation rows 32px; feature rows 56px. Focus rings remain visible in both themes.

Surfaces: navigation < working canvas < context inspector; terminal/output is a recessed surface; overlays are reserved for commands and consequential forms. Borders separate panes and rows rather than every item. Status is a small semantic dot plus text. Human review and agent inspection share the right-side position but are never displayed as two competing permanent inspectors.

## Layout exploration

Option A — every pane always open:

```text
project tree | document | agent | human review
             terminal / tests / logs
```

Rejected: at 1024px, four columns leave an unusable document and split decision context.

Option B — contextual workstation (selected):

```text
native titlebar · project / feature context                  sync / theme
projects      | feature title                    actual state / next action
work queues   | intent → plan → execution → verification → handoff
              | Design · Requirements · Execution · Instructions
              | design document       | HUMAN: review + approval
              |          OR
              | changes / checks      | AGENT: activity + applied rules
              | execution output (expand / collapse / resize)
Settings      | SYSTEM: run identity / verified tree / evidence
```

At small widths the inspector is explicitly toggled, and execution columns stack when necessary. Overflow belongs to the working panes, not the entire desktop. Planning completion returns attention to the design. `ready_for_merge` means handoff review, never a fabricated merge/completion. The current runtime has no merge confirmation event, interactive terminal or live file-operation feed; the interface must not invent those capabilities.

## Interaction and validation contract

- Human: publish design, read all sections, resolve blocking discussion, approve through the existing OS-authenticated flow.
- Agent: queue planning/implementation, inspect actual execution state, model, stage, outputs, failure and instructions.
- System: preserve approved version/binding, attempt, tree, fixed checks and artifact identities.
- Command palette: Cmd/Ctrl K, arrows, Enter, Escape, focus containment and restoration. Commands invoke existing actions only.
- Panes: pointer resizing plus arrow/Home/End keyboard behavior; persisted widths are clamped.
- Diff: read-only unified patch with file selection, line numbers, addition/removal styling and explicit empty/error/loading states.
- Verification: distinguish current-attempt evidence from history; passing historical checks are not proof of the current tree.
- Preserve settings/import/export/onboarding and all approval/invalidated-contract behavior.
- Validate with regression checks, isolated browser scenarios, keyboard and accessibility audit, dark/light and 1024×700 visual inspection, then Electron launch/package verification and independent PR review.

## Critique before implementation

The selected layout satisfies the brief's density and three-actor model without requiring an unrelated IDE backend. The risk is compressing review too far; the document remains the largest surface, reviewers retain scrollable context and approval controls. No speculative progress percentages are shown. Figma integration was inspected; file creation awaits the user's required team selection. Frontend-design guidance and Playwright visual inspection are already in use.

## Implemented

- Compact project/feature navigation, a single Settings entry and contextual settings navigation.
- Shared operational state across the feature list, stage board and feature header. The next-action link routes to design or execution context; design approval remains a separate domain gate.
- Accessible command palette for projects, features, navigation and creation. No natural-language automation is simulated.
- Run selection with historical run identity preserved when opening the execution overview. Late diff responses cannot populate a different run's view.
- Read-only, file-selectable unified diff with old/new line numbers and binary/rename metadata preservation.
- Current-attempt checks separated from history, exact tree/commit metadata, structured per-agent acceptance reviews, immutable instruction context and integrity-checked artifact reveal.
- Contextual agent inspector and collapsible output drawer; pointer and keyboard pane resizing. Output size is bounded by available workspace height.
- Design discussion, version comparison, draft conflict handling, checklists and authenticated human approval remain on the existing command path.
- Pre-execution instruction previews use the same shared harness resolver as execution, including feature scope. Existing package editing/import/export and onboarding remain available.

## Visual and accessibility review

Used frontend-design guidance for the audit and alternative layouts, Playwright MCP for interactive rendered inspection and screenshots, and `@axe-core/playwright` for automated WCAG A/AA scans. Figma tools/authentication were inspected, but no file was written because the connected account has multiple teams and the required team choice has not been supplied. Native CUA inspection was attempted; the Mac is locked. Neither limitation was replaced with a fabricated success claim.

Inspected dark/light execution, 1024×700 layout, design review, diff, acceptance review, command palette, feature overview and the real harness editor test flow. Iteration found and corrected an inherited full-width button rule that collapsed the command input, two simultaneously highlighted list tabs, oversized list rows and intermediate theme color contrast. Keyboard coverage includes command navigation/focus restoration, dialogs, roving tabs and separators.

Browser artifacts are isolated fixtures in `artifacts/ade-*.png`; fixtures are confined to `tests/fixtures`, excluded from the app entry points and packaging. The existing user's workspace and credentials are untouched. Automated scans are not a complete accessibility certification. [Playwright accessibility guidance](https://playwright.dev/docs/accessibility-testing).
