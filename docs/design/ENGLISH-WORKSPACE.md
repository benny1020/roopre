# English workspace and practical workflow polish

## Requirements

Use natural English for product-owned screens, commands, feedback, defaults and execution status. Keep existing repositories, user-authored Markdown, requirements, conversations and approval records intact. Maintain human design approval before implementation, parallel agents by default, isolated worktrees and independent verification.

## UX decisions

- Keep Home, Work, Quality and Agents as the primary navigation. Standards and runtime configuration remain in Settings.
- Home prioritizes decisions and live activity, with a direct route to the complete attention queue. Project progress remains a compact Plan → Build → Review rail.
- Describe work in terms of the next action. An empty requirement starts at intent, rather than incorrectly asking users to review a design.
- Use one vocabulary throughout: feature, design, workflow, stage, run, attempt, check, review, evidence and approval. Agents are workers; contextual consultation remains secondary.
- The agent picker explains the selected stage's execution mode and each role's purpose. Existing roles and creating a new role share one entry point.
- Stage backgrounds remain behind agent nodes even when selected; adding an agent must not hide existing workers or block pointer interaction.
- Use a short workspace search label, distinct navigation landmarks, clear action verbs and compact desktop typography. Preserve resizable panels, keyboard navigation, diffs and execution logs.

The reference principles are the workspace/task separation of [Vibe Kanban](https://github.com/BloopAI/vibe-kanban), isolated agent workspaces of [Emdash](https://github.com/generalaction/emdash), and task/agent operational visibility of [Paperclip](https://github.com/paperclipai/paperclip). These inform hierarchy and progressive disclosure; no reference product is copied and no new claims about their current implementation are required.

## Environment recovery

A real setup integration check found that a new dedicated database always contacted the registry even when the required PostgreSQL image was already cached. Reuse the local `postgres:18-alpine` image, matching the runner image's existing cache-first behavior. Pull it only when missing. This permits repeat setup without registry access while preserving identity persistence, private loopback binding, volume ownership checks and cancellation. This change does not delete or migrate data automatically.

## Compatibility

Review section wire keys remain unchanged so existing checked criteria and review threads retain their meaning. UI labels and newly generated documents use English. Publication and planning validation recognize both legacy Korean headings and English headings, including mixed documents. New and legacy template guidance cannot be published as a completed design. Company standards imported from Git or Markdown remain unchanged.

Product-generated API errors and runner activity are English. English safe-error classification keeps consultation errors useful while avoiding exposure of unrelated backend errors. The bundled standard advances to version 1.1.0 so its English content does not conflict with the digest of an installed 1.0.0 standard. Existing saved defaults are not silently rewritten: users may have edited them.

## Validation boundaries

Verification must include type checking, domain/API regressions, English/legacy document compatibility, keyboard and approval flows, light/dark and compact visual checks, accessibility, packaging integrity and independent PR review. Fixture screenshots verify presentation, not live provider execution. Real paid model execution, signing/notarization and enterprise authentication are separate from this change.
