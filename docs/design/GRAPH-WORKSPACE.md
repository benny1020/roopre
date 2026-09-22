# Graph workspace implementation

The user's September 22 instruction authorizes implementation of the graph UX proposal and release-quality validation. Human design approval, runtime isolation, parallel stage barriers and merge policy remain intact.

## Design and scope

Use the existing ADE graphite/light palette, system UI typography and 4/8/12/16/24 spacing. A structured left-to-right stage graph communicates the process; agent nodes live within stage lanes. Neutral selection is distinct from operational running/success/failure states. The primary interaction is selecting a stage or agent and inspecting its instructions or evidence. Pan/zoom and explicit fit controls support smaller windows without changing workflow semantics.

Flow editing operates on a local draft. Moving an agent validates its existing capability; implementation agents cannot move into read-only stages. Keyboard users have an equivalent stage selector. Undo restores the prior draft. Saving uses the existing optimistic revision command and invalidates design approvals as before. Shared imported standards remain managed through the package editor. Editing is locked during active or not-yet-terminated project runs. No arbitrary stage reordering or partial retry is added.

Execution graphs read the selected run's frozen harness and current attempt only. Legacy runs without harness snapshots show recorded execution agents rather than borrowing current project assignments. No elapsed-time progress, fictional file events or assumed passed stages. Planning and implementation runs remain separate; historical results never certify a current attempt. A selected historical stage does not move the runtime cursor.

AI refinement is an explicit, bounded model request against a user-selected saved connection. It returns a validated editable agent draft, never a command or approval. No tools, filesystem content or credentials are sent in the prompt. Generated output cannot change capability, scope, connection or workflow without the user's ordinary editor actions.

## Verification targets

Current vs historical attempts; selection vs runtime; parallel defaults and sequential overrides; compatible and rejected moves; undo; draft preservation; revisions and save errors; shared-standard and active-run locks; AI malformed/oversized/refused/failed responses; keyboard and contrast checks; light/dark and 1024px layouts; Electron packaging and independent PR review.

## Distribution boundary

This iteration raises product quality but does not assert App Store eligibility. The existing local Docker/PostgreSQL/CLI architecture needs a separate App Sandbox feasibility decision. Developer ID distribution already has a signing/notarization path. App Store submission must not silently replace it or weaken runner isolation.
