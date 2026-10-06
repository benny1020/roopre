import { useEffect, useState } from "react";
import { Pause, Pencil, Save } from "lucide-react";
import type { Snapshot } from "../../../shared/contracts";
import {
  canonicalSourceRef,
  type MemorySourceRef,
  type WorkMemory,
} from "../../../shared/memory";

export type MemorySeed = {
  title: string;
  body: string;
  sourceRef: MemorySourceRef;
};

export default function MemoryPanel({
  snapshot,
  projectId,
  featureId,
  agentId,
  seed,
}: {
  snapshot: Snapshot;
  projectId: string;
  featureId?: string;
  agentId?: string;
  seed?: MemorySeed;
}) {
  const project = snapshot.projects.find((item) => item.id === projectId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [manualSource, setManualSource] = useState("");
  const [sourceRef, setSourceRef] = useState<MemorySourceRef>();
  const [editing, setEditing] = useState<WorkMemory>();
  const [projectWide, setProjectWide] = useState(!featureId);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!seed) return;
    setTitle(seed.title);
    setBody(seed.body);
    setSourceRef(seed.sourceRef);
    setEditing(undefined);
    setConfirmed(false);
  }, [seed]);
  const scopeFeatureId = projectWide ? undefined : featureId;
  const memories = (project?.memories || []).filter(
    (memory) =>
      memory.agentDefinitionId === agentId &&
      memory.featureId === scopeFeatureId,
  );
  const activeRun = snapshot.runs.some((run) => {
    const feature = snapshot.features.find((item) => item.id === run.featureId);
    return (
      feature?.projectId === projectId &&
      ([
        "queued",
        "preparing",
        "implementing",
        "verifying",
        "reviewing",
        "repairing",
      ].includes(run.status) ||
        run.runtime?.terminationConfirmed === false)
    );
  });
  const save = async () => {
    const sourceRefs =
      editing?.sourceRefs ||
      (sourceRef
        ? [sourceRef]
        : manualSource.trim()
          ? [{ type: "manual" as const, label: manualSource }]
          : []);
    if (
      !agentId ||
      !title.trim() ||
      !body.trim() ||
      !sourceRefs.length ||
      !confirmed
    )
      return;
    try {
      await window.roopre!.command({
        type: "save_memory",
        projectId,
        expectedRevision: snapshot.revision,
        promoteToProject: projectWide && !!featureId,
        memory: {
          id: editing?.id || crypto.randomUUID(),
          agentDefinitionId: agentId,
          ...(scopeFeatureId ? { featureId: scopeFeatureId } : {}),
          title,
          body,
          revision: editing ? editing.revision + 1 : 1,
          sourceRefs,
          active: true,
        },
      });
      setTitle("");
      setBody("");
      setManualSource("");
      setSourceRef(undefined);
      setEditing(undefined);
      setConfirmed(false);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const deactivate = async (memory: WorkMemory) => {
    try {
      await window.roopre!.command({
        type: "deactivate_memory",
        projectId,
        memoryId: memory.id,
        expectedRevision: snapshot.revision,
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const edit = (memory: WorkMemory) => {
    setEditing(memory);
    setTitle(memory.title);
    setBody(memory.body);
    setSourceRef(memory.sourceRefs[0]);
    setProjectWide(!memory.featureId);
    setManualSource(
      memory.sourceRefs[0]?.type === "manual" ? memory.sourceRefs[0].label : "",
    );
    setConfirmed(false);
    setError("");
  };
  if (!agentId)
    return <p className="muted">Select an agent to manage its memory.</p>;
  return (
    <section className="memory-panel" aria-label="Work memory">
      <p className="conversation-boundary">
        Memory is pinned as input to the next approved run. It is not a command,
        approval or verification result. Saving memory requires project designs
        to be reviewed again.
      </p>
      {activeRun && (
        <p className="conversation-warning">
          Memory cannot change while a run is queued, active or awaiting
          termination confirmation.
        </p>
      )}
      {memories.map((memory) => (
        <article className="memory-item" key={memory.id}>
          <strong>{memory.title}</strong>{" "}
          <small>
            r{memory.revision} · {memory.active ? "Active" : "Deactivate"}
          </small>
          <p>{memory.body}</p>
          <small>
            Source: {memory.sourceRefs.map(canonicalSourceRef).join(", ")}
          </small>
          <button
            className="soft"
            disabled={activeRun}
            onClick={() => edit(memory)}
          >
            <Pencil size={13} /> Edit
          </button>
          {memory.active && (
            <button
              className="soft"
              disabled={activeRun}
              onClick={() => void deactivate(memory)}
            >
              <Pause size={13} /> Deactivate
            </button>
          )}
        </article>
      ))}
      <div className="memory-form">
        <label>
          Scope
          <select
            aria-label="Memory scope"
            disabled={!!editing || !featureId}
            value={projectWide ? "project" : "feature"}
            onChange={(event) =>
              setProjectWide(event.target.value === "project")
            }
          >
            <option value="feature">This feature</option>
            <option value="project">Entire project</option>
          </select>
        </label>
        {projectWide && featureId && (
          <p className="conversation-warning">
            Promote this feature's conversation context to project-wide memory.
            All project designs will require review again.
          </p>
        )}
        <label>
          Title
          <input
            aria-label="Memory title"
            value={title}
            maxLength={240}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Content
          <textarea
            aria-label="Memory content"
            value={body}
            maxLength={2000}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        {sourceRef ? (
          <p className="memory-source">
            Source: {canonicalSourceRef(sourceRef)}{" "}
            {editing && "(original source retained)"}
          </p>
        ) : (
          <label>
            User-confirmed source
            <input
              aria-label="User-confirmed source"
              value={manualSource}
              maxLength={240}
              placeholder="e.g. User decision on September 28"
              onChange={(event) => setManualSource(event.target.value)}
            />
          </label>
        )}
        <label className="memory-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />{" "}
          I confirm this content and scope and understand that project approvals
          need review again.
        </label>
        {error && (
          <p className="conversation-error" role="alert">
            {error}
          </p>
        )}
        <button
          disabled={
            activeRun ||
            !confirmed ||
            !title.trim() ||
            !body.trim() ||
            (!sourceRef && !manualSource.trim())
          }
          onClick={() => void save()}
        >
          <Save size={14} /> {editing ? "Save changes" : "Save as memory"}
        </button>
      </div>
    </section>
  );
}
