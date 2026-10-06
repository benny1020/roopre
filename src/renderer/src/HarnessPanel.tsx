import AgentRefinement from "./workspace/AgentRefinement";
import { useEffect, useState } from "react";
import type { Command, Snapshot } from "../../shared/contracts";
import {
  latestAgents,
  resolveHarness,
  stageNames,
  stages,
  type AgentDefinition,
  type Workflow,
  importAgentMarkdown,
  workflowSchema,
  workflowIssues,
} from "../../shared/harness";
import type { ConnectionInfo } from "../../shared/runtime";
import MarkdownPreview from "./MarkdownPreview";
import WorkflowEditor from "./workspace/WorkflowEditor";
import { Dialog } from "./workspace/Controls";
import type { Stage } from "./workspace/WorkflowGraph";
import { activeStatuses, executionCapacityOf } from "../../shared/runtime";
const instructions = {
  requirements: "",
  design: "",
  implementation: "",
  verification: "",
  review: "",
};
export default function HarnessPanel({
  snapshot,
  initialProjectId,
  onProjectChange,
  send,
  onSaved,
}: {
  snapshot: Snapshot;
  initialProjectId?: string;
  onProjectChange?: (id: string) => void;
  send: (c: Command) => Promise<unknown>;
  onSaved: () => Promise<unknown>;
}) {
  const [projectId, setProjectId] = useState(
    initialProjectId && snapshot.projects.some((p) => p.id === initialProjectId)
      ? initialProjectId
      : (snapshot.projects[0]?.id ?? ""),
  );
  const project = snapshot.projects.find((p) => p.id === projectId);
  const capacity = executionCapacityOf(snapshot.executionCapacity);
  const [pendingStage, setPendingStage] = useState<Stage>();
  const [editing, setEditing] = useState<AgentDefinition>();
  const draftKey = (id: string) => `roopre:flow-draft:${snapshot.teamId}:${id}`;
  const readDraft = (id: string) => {
    try {
      const raw = JSON.parse(localStorage.getItem(draftKey(id)) || "null");
      if (!raw || !Number.isInteger(raw.base) || raw.base < 0) return undefined;
      return {
        base: raw.base as number,
        flow: workflowSchema
          .extend({ assignments: workflowSchema.shape.assignments.min(0) })
          .parse(raw.flow),
      };
    } catch {
      return undefined;
    }
  };
  const [flow, setFlow] = useState<Workflow>(
    readDraft(projectId)?.flow ??
      project?.workflow ?? {
        revision: 1,
        assignments: [],
        instructions: { ...instructions },
      },
  );
  const [flowBase, setFlowBase] = useState(
    readDraft(projectId)?.base ?? project?.workflow?.revision ?? 0,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [preview, setPreview] = useState(false);
  const [composed, setComposed] = useState("");
  const agents = latestAgents(snapshot);
  const activeProject = snapshot.runs.some(
    (r) =>
      snapshot.features.find((f) => f.id === r.featureId)?.projectId ===
        projectId &&
      (activeStatuses.includes(r.status) ||
        r.runtime?.terminationConfirmed === false),
  );
  const locked = busy || activeProject || !!project?.harness;
  const content = (value?: Workflow) =>
    value
      ? JSON.stringify([
          value.revision,
          stages.map((stage) => [
            value.instructions[stage],
            value.execution?.[stage] ?? "parallel",
          ]),
          value.assignments.map((a) => [a.id, a.agentId, a.stage, a.required]),
        ])
      : "";
  const dirty = content(flow) !== content(project?.workflow);
  const flowIssues = project ? workflowIssues(snapshot, project, flow) : [];
  const [discard, setDiscard] = useState(false);
  const [resetDefault, setResetDefault] = useState(false);
  const editingProjects = snapshot.projects.filter((p) =>
    p.workflow?.assignments.some((a) => a.agentId === editing?.id),
  );
  const editingLocked =
    !!editing &&
    (snapshot.projects.some((p) =>
      Object.values(p.harness?.agents ?? {}).includes(editing.id),
    ) ||
      snapshot.runs.some(
        (r) =>
          editingProjects.some(
            (p) =>
              p.id ===
              snapshot.features.find((f) => f.id === r.featureId)?.projectId,
          ) &&
          (activeStatuses.includes(r.status) ||
            r.runtime?.terminationConfirmed === false),
      ));

  useEffect(() => {
    if (!projectId) return;
    try {
      localStorage.setItem(
        draftKey(projectId),
        JSON.stringify({ base: flowBase, flow }),
      );
    } catch {
      setError(
        "Your workflow draft could not be saved locally. Save the workflow before closing this window.",
      );
    }
  }, [flow, flowBase, projectId, snapshot.teamId]);
  const available = agents.filter(
    (a) => !a.archived && (!a.projectId || a.projectId === projectId),
  );
  useEffect(() => {
    void window.roopre
      ?.connections()
      .then(setConnections)
      .catch((e) => setError(e.message));
  }, []);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const selectProject = (id: string) => {
    const p = snapshot.projects.find((p) => p.id === id);
    setProjectId(id);
    onProjectChange?.(id);
    setFlow(
      readDraft(id)?.flow ??
        p?.workflow ?? {
          revision: 1,
          assignments: [],
          instructions: { ...instructions },
        },
    );
    setFlowBase(readDraft(id)?.base ?? p?.workflow?.revision ?? 0);
    setComposed("");
  };
  const fresh = (): AgentDefinition => ({
    id: crypto.randomUUID(),
    revision: 1,
    name: "",
    description: "",
    capability: "read-only",
    markdown: "# Role\n\n# Review criteria\n",
    archived: false,
  });
  const applyDefault = () =>
    act(async () => {
      if (locked) return;
      const definitions = stages.map((stage) => ({
        ...fresh(),
        name: `${stageNames[stage]} Agents`,
        projectId,
        capability:
          stage === "implementation"
            ? ("implementation" as const)
            : ("read-only" as const),
        description: `${stageNames[stage]} default stage role`,
        markdown:
          stage === "implementation"
            ? "Implement within the approved design. Do not change required checks or approval rules."
            : "Compare requirements, design and instructions with repository evidence. Never report an unverified check as passed.",
      }));
      for (const agent of definitions)
        await send({
          type: "save_agent",
          expectedRevision: 0,
          agent,
        });
      const next: Workflow = {
        revision: flowBase + 1,
        instructions: { ...instructions },
        assignments: definitions.map((a, i) => ({
          id: crypto.randomUUID(),
          agentId: a.id,
          stage: stages[i],
          required: true,
        })),
      };
      await send({
        type: "save_workflow",
        projectId,
        expectedRevision: flowBase,
        workflow: next,
      });
      setFlow(next);
      setFlowBase(next.revision);
      setNotice("Default workflow applied.");
      setResetDefault(false);
    });
  return (
    <div className="content-page harness-panel">
      <div className="page-heading">
        <div>
          <h1>Agents & workflow</h1>
          <p>Define agents in Markdown and assign them to workflow stages.</p>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setPendingStage(undefined);
            setEditing(fresh());
            setPreview(false);
          }}
        >
          Create agent
        </button>
      </div>
      {error && !editing && !resetDefault && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {editing && (
        <Dialog
          label="Edit agent"
          onClose={() => {
            if (!busy) {
              setEditing(undefined);
              setPendingStage(undefined);
            }
          }}
          className="command-dialog graph-picker"
        >
          <section
            className="runtime-card agent-editor"
            aria-label="Edit agent"
          >
            <h2>{editing.name || "New agent"}</h2>
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <AgentRefinement
              key={editing.id}
              stage={
                pendingStage ??
                (editing.capability === "implementation"
                  ? "implementation"
                  : "review")
              }
              connections={connections}
              onApply={(draft) =>
                setEditing((current) =>
                  current ? { ...current, ...draft } : current,
                )
              }
            />
            <div className="runtime-grid">
              <label className="field">
                Agent name
                <input
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </label>
              <label className="field">
                Scope
                <select
                  value={editing.projectId ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      projectId: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">Global</option>
                  {snapshot.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Permissions
                <select
                  value={editing.capability}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      capability: e.target
                        .value as AgentDefinition["capability"],
                    })
                  }
                >
                  <option value="read-only">
                    Read-only · planning, verification & review
                  </option>
                  <option value="implementation">
                    Write access · implementation
                  </option>
                </select>
              </label>
              <label className="field">
                Model connection
                <select
                  value={editing.connectionId ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      connectionId: e.target.value || undefined,
                      connectionVersion: connections.find(
                        (c) => c.id === e.target.value,
                      )?.version,
                    })
                  }
                >
                  <option value="">Inherit project connection</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.model}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              Description
              <input
                value={editing.description}
                onChange={(e) =>
                  setEditing({ ...editing, description: e.target.value })
                }
              />
            </label>
            <div className="button-row">
              <button onClick={() => setPreview(!preview)}>
                {preview ? "Source" : "Preview"}
              </button>
              {window.roopre?.readMarkdown && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const file = await window.roopre!.readMarkdown();
                      if (file) {
                        const parsed = importAgentMarkdown(file);
                        setEditing({ ...editing, ...parsed });
                      }
                    })
                  }
                >
                  Import Markdown
                </button>
              )}
            </div>
            {preview ? (
              <MarkdownPreview text={editing.markdown} />
            ) : (
              <label className="field">
                Markdown instructions
                <textarea
                  aria-label="Markdown instructions"
                  className="instruction-editor"
                  value={editing.markdown}
                  onChange={(e) =>
                    setEditing({ ...editing, markdown: e.target.value })
                  }
                />
              </label>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editing.archived}
                onChange={(e) =>
                  setEditing({ ...editing, archived: e.target.checked })
                }
              />
              Archive · preserve run history
            </label>
            {editingLocked && (
              <p className="error-banner">
                This agent is managed by a shared standard or is currently
                running. Edit the standard or wait for the run to finish.
              </p>
            )}
            <p className="muted">
              Changing an active definition invalidates affected approvals and
              interrupts execution.
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={
                  busy ||
                  editingLocked ||
                  !editing.name.trim() ||
                  !editing.markdown.trim()
                }
                onClick={() =>
                  void act(async () => {
                    const isNew = !agents.some((a) => a.id === editing.id);
                    const revision = isNew ? 0 : editing.revision;
                    await send({
                      type: "save_agent",
                      expectedRevision: revision,
                      agent: { ...editing, revision: revision + 1 },
                    });
                    if (
                      pendingStage &&
                      isNew &&
                      (!editing.projectId || editing.projectId === projectId) &&
                      (pendingStage === "implementation") ===
                        (editing.capability === "implementation")
                    ) {
                      setFlow((current) => ({
                        ...current,
                        assignments: [
                          ...current.assignments,
                          {
                            id: crypto.randomUUID(),
                            agentId: editing.id,
                            stage: pendingStage,
                            required: true,
                          },
                        ],
                      }));
                      setNotice(
                        "Agent saved and added to the draft. Save the workflow to apply it.",
                      );
                    } else setNotice("Agent version saved.");
                    setPendingStage(undefined);
                    setEditing(undefined);
                  })
                }
              >
                Save agent
              </button>
              <button
                onClick={() => {
                  setEditing(undefined);
                  setPendingStage(undefined);
                }}
              >
                Close editor
              </button>
            </div>
          </section>
        </Dialog>
      )}
      <section className="runtime-card workflow-settings">
        <div className="workflow-project-toolbar">
          <label className="field">
            Workflow project
            <select
              value={projectId}
              onChange={(e) => selectProject(e.target.value)}
              disabled={busy || !snapshot.projects.length}
            >
              {snapshot.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {project && (
            <button
              disabled={locked}
              onClick={() =>
                flow.assignments.length
                  ? setResetDefault(true)
                  : void applyDefault()
              }
            >
              Use default workflow
            </button>
          )}
        </div>
        {!project && (
          <p>Create a project first. Global agents can be defined now.</p>
        )}
        {project && (
          <>
            {activeProject && (
              <p className="error-banner">
                Workflow editing is locked while this project has an active run.
                Save a new version after execution ends.
              </p>
            )}
            {project.harness && (
              <p className="muted">
                This workflow is managed by a shared standard. Import or edit a
                new version in Harness settings.
              </p>
            )}
            <WorkflowEditor
              key={projectId}
              flow={flow}
              onChange={setFlow}
              agents={available}
              locked={locked}
              onCreate={(stage) => {
                setPendingStage(stage);
                setEditing({
                  ...fresh(),
                  projectId,
                  capability:
                    stage === "implementation" ? "implementation" : "read-only",
                });
                setPreview(false);
              }}
            />
            <details className="workflow-policy-hint">
              <summary>Parallel execution & approval gates</summary>{" "}
              <p className="muted">
                Each stage runs agents in parallel, up to{" "}
                {capacity.maxAgentsPerStage} at a time. The next stage waits for
                every agent. Use sequential execution when agents depend on
                earlier results. Conflicting implementation changes stop
                integration and preserve each result. Saving execution changes
                requires design approval again.
              </p>
            </details>
            <div className="workflow-savebar">
              <p className="muted">
                {dirty
                  ? "Unsaved draft · saved locally"
                  : "Matches saved workflow"}{" "}
                · Base v{flowBase}
              </p>
              {flowIssues.length > 0 && (
                <p className="muted" role="status">
                  Before saving: {flowIssues.join(" ")}
                </p>
              )}
              <div className="button-row">
                <button
                  className="primary"
                  disabled={locked || !dirty || flowIssues.length > 0}
                  onClick={() =>
                    void act(async () => {
                      const next = { ...flow, revision: flowBase + 1 };
                      await send({
                        type: "save_workflow",
                        projectId,
                        expectedRevision: flowBase,
                        workflow: next,
                      });
                      setFlow(next);
                      setFlowBase(next.revision);
                      setNotice("Workflow saved.");
                    })
                  }
                >
                  Save workflow
                </button>
                <button
                  onClick={() => {
                    try {
                      setComposed(
                        resolveHarness(snapshot, { ...project, workflow: flow })
                          ?.agents.map(
                            (a) => `## ${a.agent.name}\n${a.instructions}`,
                          )
                          .join("\n\n") ?? "",
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Inspect instructions
                </button>
                <button
                  onClick={() => {
                    if (dirty) setDiscard(true);
                    else {
                      localStorage.removeItem(draftKey(projectId));
                      selectProject(projectId);
                    }
                  }}
                >
                  Reload saved version
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      {resetDefault && (
        <Dialog
          label="Reset to default workflow"
          onClose={() => {
            if (!busy) setResetDefault(false);
          }}
          className="command-dialog graph-picker"
        >
          <h2>Replace this workflow with the five default roles?</h2>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <p>
            Stage assignments and instructions will be replaced, invalidating
            affected design approvals. Agent definitions and run history are
            preserved.
          </p>
          <div className="button-row">
            <button disabled={busy} onClick={() => setResetDefault(false)}>
              Keep editing
            </button>
            <button disabled={locked} onClick={() => void applyDefault()}>
              Reset to default workflow
            </button>
          </div>
        </Dialog>
      )}
      {discard && (
        <Dialog
          label="Discard workflow draft"
          onClose={() => setDiscard(false)}
          className="command-dialog graph-picker"
        >
          <h2>Discard unsaved workflow changes?</h2>
          <p>
            Remove this project's local draft and reload the saved workflow.
            Other project drafts are preserved.
          </p>
          <div className="button-row">
            <button onClick={() => setDiscard(false)}>Keep editing</button>
            <button
              onClick={() => {
                localStorage.removeItem(draftKey(projectId));
                selectProject(projectId);
                setDiscard(false);
              }}
            >
              Discard and reload
            </button>
          </div>
        </Dialog>
      )}
      <details className="agent-library-section">
        <summary>Agent library · {agents.length}</summary>
        <div className="agent-library">
          {agents.map((a) => (
            <article className="runtime-card" key={a.id}>
              <div className="button-row">
                <h3>{a.name}</h3>
                <small>
                  v{a.revision} ·{" "}
                  {a.projectId
                    ? snapshot.projects.find((p) => p.id === a.projectId)?.name
                    : "Global"}{" "}
                  ·{" "}
                  {a.archived
                    ? "Archived"
                    : a.capability === "implementation"
                      ? "Write access"
                      : "Read-only"}
                </small>
              </div>
              <p>{a.description}</p>
              <div className="button-row">
                <button
                  disabled={busy}
                  onClick={() => {
                    setPendingStage(undefined);
                    setEditing({ ...a });
                    setPreview(false);
                  }}
                >
                  Edit
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setPendingStage(undefined);
                    setEditing({
                      ...a,
                      id: crypto.randomUUID(),
                      revision: 1,
                      name: `${a.name} copy`,
                      archived: false,
                    });
                    setPreview(false);
                  }}
                >
                  Duplicate
                </button>
                {window.roopre?.exportAgent && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await window.roopre!.exportAgent(a.id);
                      })
                    }
                  >
                    Export Markdown
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        {!agents.length && (
          <p className="muted">
            No agents yet. Create one or apply the default workflow to a
            project.
          </p>
        )}
      </details>
      {composed && (
        <section className="runtime-card">
          <h2>Instructions for the workflow draft</h2>
          <MarkdownPreview text={composed} />
        </section>
      )}
    </div>
  );
}
