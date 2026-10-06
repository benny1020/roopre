import { useEffect, useRef, useState } from "react";
import type { ConnectionInfo } from "../../../shared/runtime";
import type { RefinementOutput } from "../../../shared/agent-refinement";
import type { Stage } from "./WorkflowGraph";
import MarkdownPreview from "../MarkdownPreview";
export default function AgentRefinement({
  stage,
  connections,
  onApply,
}: {
  stage: Stage;
  connections: ConnectionInfo[];
  onApply: (draft: RefinementOutput) => void;
}) {
  const [brief, setBrief] = useState("");
  const [connection, setConnection] = useState(connections[0]?.id ?? "");
  const [result, setResult] = useState<RefinementOutput>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <details className="agent-refinement">
      <summary>Describe the role, then refine with AI</summary>
      <label className="field">
        Agent purpose
        <textarea
          maxLength={6000}
          placeholder="e.g. Check accessibility and layout on smaller screens"
          value={brief}
          disabled={busy}
          onChange={(e) => {
            setBrief(e.target.value);
            setResult(undefined);
          }}
        />
      </label>
      <label className="field">
        Connection for drafting
        <select
          value={connection}
          disabled={busy}
          onChange={(e) => setConnection(e.target.value)}
        >
          <option value="">Choose connection</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.model}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        Only this role and stage are sent to the selected connection. Model
        charges may apply. Review the result before applying; it is not saved
        automatically.
      </p>
      {!connections.length && (
        <p>Add an API key and endpoint in AI connections first.</p>
      )}
      <button
        disabled={
          busy ||
          brief.trim().length < 3 ||
          !connection ||
          !window.roopre?.refineAgent
        }
        onClick={async () => {
          setBusy(true);
          setError("");
          setResult(undefined);
          try {
            const draft = await window.roopre!.refineAgent({
              connectionId: connection,
              stage,
              brief,
            });
            if (mounted.current) setResult(draft);
          } catch (e) {
            if (mounted.current) setError((e as Error).message);
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
      >
        {busy ? "Drafting with AI…" : "Refine with AI"}
      </button>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {result && (
        <section aria-label="Suggested agent">
          <h3>{result.name}</h3>
          <p>{result.description}</p>
          <MarkdownPreview text={result.markdown} />
          <p className="muted">
            Applying replaces the name, description and Markdown. Permissions,
            scope and connection settings are preserved.
          </p>
          <div className="button-row">
            <button
              onClick={() => {
                onApply(result);
                setResult(undefined);
              }}
            >
              Apply to editor
            </button>
            <button onClick={() => setResult(undefined)}>
              Discard suggestion
            </button>
          </div>
        </section>
      )}
    </details>
  );
}
